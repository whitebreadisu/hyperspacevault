"""BL-205 (App Spec §19.1): share management (owner, authed) and the
viewer-mode reads (anonymous, token-scoped).

Two routers on purpose -- they serve different audiences with different
security postures. /api/shares is a normal authed tenant surface
(get_db). /api/shared/{token} is the platform's first unauthenticated
tenant-data read: get_shared_db resolves the token on the RLS rails and
scopes the session to the share's owner tenant, so the two data routes
below reuse the exact service reads the owner's own Vault uses --
identical rows, zero share-specific query logic to review or drift.

Viewer responses carry `Cache-Control: private, max-age=30`: shares are
live views (§19.1 -- snapshots deliberately out), so the browser may
smooth a viewer's own navigation but nothing shared/CDN-cached may
persist the payload.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db, get_shared_db
from app.models.share import Share
from app.routers.inventory import VariantQuantityResponse
from app.schemas.settings_schema import LimitsResponse
from app.schemas.share_schema import (
    ShareCreateRequest,
    SharedResolveResponse,
    ShareResponse,
)
from app.services import inventory as inventory_service
from app.services import settings as settings_service

router = APIRouter(prefix="/api/shares", tags=["shares"])
shared_router = APIRouter(prefix="/api/shared", tags=["shared"])


def _new_token() -> str:
    """256-bit URL-safe token (43 chars) -- the share's sole credential."""
    return secrets.token_urlsafe(32)


def _to_response(share: Share) -> ShareResponse:
    return ShareResponse(
        id=share.id,
        name=share.name,
        scope=share.scope,
        token=share.token,
        created_at=share.created_at,
        revoked=share.revoked_at is not None,
    )


def _current_tenant_id(db: Session) -> int:
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar()


def _owned_active_share(db: Session, share_id: int) -> Share:
    """The caller's own unrevoked share or 404 -- RLS already scopes the
    query to the caller's tenant, so a foreign share_id and a nonexistent
    one are indistinguishable, matching the token route's posture."""
    share = (
        db.query(Share).filter(Share.id == share_id, Share.revoked_at.is_(None)).first()
    )
    if share is None:
        raise HTTPException(status_code=404, detail="Share not found")
    return share


# ---------------------------------------------------------------------------
# Owner-side management (authed)
# ---------------------------------------------------------------------------


@router.post("", response_model=ShareResponse, status_code=201)
def create_share(payload: ShareCreateRequest, db: Session = Depends(get_db)):
    """Create the tenant's inventory share. One active share per scope
    target (owner ruling, §19.4): the partial unique index is the
    authority; the pre-check just turns the common case into a clean 409
    before the constraint has to say it."""
    existing = (
        db.query(Share)
        .filter(Share.scope == "inventory", Share.revoked_at.is_(None))
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="An active share already exists")
    share = Share(
        tenant_id=_current_tenant_id(db),
        token=_new_token(),
        scope="inventory",
        name=payload.name,
    )
    db.add(share)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An active share already exists")
    db.refresh(share)
    return _to_response(share)


@router.get("", response_model=list[ShareResponse])
def list_shares(db: Session = Depends(get_db)):
    """Every unrevoked share the caller owns (revoked rows are history,
    not management surface)."""
    shares = (
        db.query(Share)
        .filter(Share.revoked_at.is_(None))
        .order_by(Share.created_at)
        .all()
    )
    return [_to_response(s) for s in shares]


@router.patch("/{share_id}", response_model=ShareResponse)
def rename_share(
    share_id: int, payload: ShareCreateRequest, db: Session = Depends(get_db)
):
    share = _owned_active_share(db, share_id)
    share.name = payload.name
    db.commit()
    db.refresh(share)
    return _to_response(share)


@router.post("/{share_id}/rotate", response_model=ShareResponse)
def rotate_share_token(share_id: int, db: Session = Depends(get_db)):
    """Replace the token in place: the old link dies the moment this
    commits, the share's name and identity survive."""
    share = _owned_active_share(db, share_id)
    share.token = _new_token()
    db.commit()
    db.refresh(share)
    return _to_response(share)


@router.delete("/{share_id}", status_code=204)
def revoke_share(share_id: int, db: Session = Depends(get_db)):
    """Soft revoke (revoked_at) -- a once-issued token is never silently
    re-activated; re-sharing mints a fresh row and token."""
    share = _owned_active_share(db, share_id)
    db.execute(
        text("UPDATE shares SET revoked_at = NOW() WHERE id = :id"),
        {"id": share.id},
    )
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Viewer-side reads (anonymous, token-scoped -- get_shared_db)
# ---------------------------------------------------------------------------


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, max-age=30"


@shared_router.get("/{token}", response_model=SharedResolveResponse)
def resolve_share(
    response: Response, request: Request, db: Session = Depends(get_shared_db)
):
    """Token -> header label + scope. Everything an anonymous viewer ever
    learns about the share itself."""
    _no_store(response)
    share = request.state.share
    return SharedResolveResponse(name=share.name, scope=share.scope)


@shared_router.get("/{token}/quantities", response_model=list[VariantQuantityResponse])
def shared_quantities(response: Response, db: Session = Depends(get_shared_db)):
    """The owner's sparse quantities list -- the same service read the
    owner's own Vault makes, under the share-scoped session."""
    _no_store(response)
    return inventory_service.get_quantities(db)


@shared_router.get("/{token}/limits", response_model=LimitsResponse)
def shared_limits(response: Response, db: Session = Depends(get_shared_db)):
    """The owner's effective keep-limit config -- the display input the
    Vault's playset math needs (§19.1: the display-affecting subset IS
    the effective-limits read)."""
    _no_store(response)
    return settings_service.get_effective_limits(db)
