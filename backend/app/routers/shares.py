"""Share management (owner, authed) and the viewer-mode reads
(anonymous, token-scoped), App Spec §19.1.

Two routers on purpose -- they serve different audiences with different
security postures. /api/shares is a normal authed tenant surface
(get_db). /api/shared/{token} is the platform's first unauthenticated
tenant-data read: get_shared_db resolves the token on the RLS rails and
scopes the session to the share's owner tenant, so the vault routes
below reuse the exact service reads the owner's own Vault uses --
identical rows, zero share-specific query logic to review or drift.

Two scopes use this token family: the vault share ('inventory') and a
stash share ('stash', one stash). RLS isolates tenants, not stashes, so
the scope is enforced in app code by the two gates in app/database.py:
every vault route depends on get_shared_inventory_db and the stash route
on get_shared_stash; no route here depends on get_shared_db directly. A
token of the wrong scope gets the same 404 as an unknown token.

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

from app.database import (
    SharedStash,
    get_db,
    get_shared_inventory_db,
    get_shared_stash,
)
from app.models.share import Share
from app.repositories import stashes as stash_repo
from app.routers.inventory import VariantQuantityResponse
from app.schemas.settings_schema import LimitsResponse
from app.schemas.share_schema import (
    ShareCreateRequest,
    SharedResolveResponse,
    SharedStashInfo,
    SharedStashResponse,
    ShareNameRequest,
    ShareResponse,
)
from app.services import inventory as inventory_service
from app.services import settings as settings_service
from app.services import stashes as stash_service

router = APIRouter(prefix="/api/shares", tags=["shares"])
shared_router = APIRouter(prefix="/api/shared", tags=["shared"])


def _new_token() -> str:
    """256-bit URL-safe token (43 chars) -- the share's sole credential."""
    return secrets.token_urlsafe(32)


def _to_response(share: Share, stash_name: str | None = None) -> ShareResponse:
    return ShareResponse(
        id=share.id,
        name=share.name,
        scope=share.scope,
        token=share.token,
        created_at=share.created_at,
        revoked=share.revoked_at is not None,
        target_id=share.target_id,
        stash_name=stash_name,
    )


def _stash_name(db: Session, share: Share) -> str | None:
    """The current name of a stash share's stash (None for the vault share)."""
    if share.scope != "stash" or share.target_id is None:
        return None
    stash = stash_repo.get_stash(db, share.target_id)
    return stash.name if stash is not None else None


def _current_tenant_id(db: Session) -> int:
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar_one()


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
    """Create the tenant's vault share, or with `stash_id` that stash's
    share. One active share per scope target (App Spec §19.1, ADR-0019):
    the partial unique index is the authority; the pre-check just turns the
    common case into a clean 409 before the constraint has to say it.

    The stash must be the caller's own: RLS hides every other tenant's, so
    a foreign id and a missing one are the same 404. Its row stays locked
    until the commit, so a concurrent stash delete either runs first (404
    here) or waits and then revokes this share in its own transaction."""
    scope, target_id, stash_name = "inventory", None, None
    if payload.stash_id is not None:
        scope, target_id = "stash", payload.stash_id
        if not stash_repo.lock_stash(db, target_id):
            db.rollback()
            raise HTTPException(status_code=404, detail="Stash not found")
        stash = stash_repo.get_stash(db, target_id)
        stash_name = stash.name if stash is not None else None
    target_filter = (
        Share.target_id.is_(None) if target_id is None else Share.target_id == target_id
    )
    existing = (
        db.query(Share)
        .filter(Share.scope == scope, target_filter, Share.revoked_at.is_(None))
        .first()
    )
    if existing is not None:
        db.rollback()
        raise HTTPException(status_code=409, detail="An active share already exists")
    share = Share(
        tenant_id=_current_tenant_id(db),
        token=_new_token(),
        scope=scope,
        target_id=target_id,
        name=payload.name,
    )
    db.add(share)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="An active share already exists"
        ) from err
    db.refresh(share)
    return _to_response(share, stash_name)


@router.get("", response_model=list[ShareResponse])
def list_shares(db: Session = Depends(get_db)):
    """Every live link the caller owns, for the share window's "Your
    links" list and the stash marks: the vault share first, then each
    stash share in stash creation order, each with its stash's current
    name. Revoked rows are history, not management surface; a stash share
    whose stash is gone is not a live link and is left out."""
    shares = db.query(Share).filter(Share.revoked_at.is_(None)).all()
    stashes = stash_repo.stashes_by_id(
        db,
        [s.target_id for s in shares if s.scope == "stash" and s.target_id],
    )
    keyed: list[tuple[tuple, ShareResponse]] = []
    for s in shares:
        if s.scope != "stash":
            keyed.append(((0, s.created_at, s.id), _to_response(s)))
            continue
        stash = stashes.get(s.target_id) if s.target_id is not None else None
        if stash is not None:
            keyed.append(((1, stash.created_at, stash.id), _to_response(s, stash.name)))
    return [resp for _, resp in sorted(keyed, key=lambda pair: pair[0])]


@router.patch("/{share_id}", response_model=ShareResponse)
def rename_share(
    share_id: int, payload: ShareNameRequest, db: Session = Depends(get_db)
):
    """Rename the vault share. A stash share's name is fixed at creation
    (App Spec §19.1): 409 `share_name_fixed` and nothing changes. Renaming
    the stash itself is PATCH /api/stashes/{id}."""
    share = _owned_active_share(db, share_id)
    if share.scope == "stash":
        raise HTTPException(status_code=409, detail="share_name_fixed")
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
    return _to_response(share, _stash_name(db, share))


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
# Viewer-side reads (anonymous, token-scoped -- the scope gates over
# get_shared_db in app/database.py)
# ---------------------------------------------------------------------------


def _viewer_cache(response: Response) -> None:
    """Private (never a shared or CDN cache), but the viewer's own browser
    may reuse it for 30 s -- so a rotated or revoked link can show from
    that browser's cache for up to 30 s (App Spec §12 Shares)."""
    response.headers["Cache-Control"] = "private, max-age=30"


@shared_router.get("/{token}", response_model=SharedResolveResponse)
def resolve_share(
    response: Response,
    request: Request,
    db: Session = Depends(get_shared_inventory_db),
):
    """Vault token -> header label + scope. Everything an anonymous viewer
    ever learns about the share itself. A stash token is a 404 here: its
    label comes with the stash read below."""
    _viewer_cache(response)
    share = request.state.share
    return SharedResolveResponse(name=share.name, scope=share.scope)


@shared_router.get("/{token}/quantities", response_model=list[VariantQuantityResponse])
def shared_quantities(
    response: Response, db: Session = Depends(get_shared_inventory_db)
):
    """The owner's sparse quantities list -- the same service read the
    owner's own Vault makes, under the share-scoped session."""
    _viewer_cache(response)
    return inventory_service.get_quantities(db)


@shared_router.get("/{token}/limits", response_model=LimitsResponse)
def shared_limits(response: Response, db: Session = Depends(get_shared_inventory_db)):
    """The owner's effective keep-limit config -- the display input the
    Vault's playset math needs (§19.1: the display-affecting subset IS
    the effective-limits read)."""
    _viewer_cache(response)
    return settings_service.get_effective_limits(db)


@shared_router.get("/{token}/stash", response_model=SharedStashResponse)
def shared_stash(response: Response, shared: SharedStash = Depends(get_shared_stash)):
    """A stash share's whole viewer read: the share name, the stash's name
    and description, its printing rows (variant_id, count, stashed_at, unit
    Market / Low) and totals -- live, never another stash or any vault
    data. The stash id comes only from the share row (the gate); nothing in
    the URL or query can name another. The read-only card detail takes a
    printing's in-stash count from these rows, as the vault viewer's card
    detail takes its count from /quantities."""
    _viewer_cache(response)
    return stash_service.shared_view(
        shared.db,
        SharedStashInfo(name=shared.stash_name, description=shared.stash_description),
        shared.stash_id,
        shared.share_name,
    )
