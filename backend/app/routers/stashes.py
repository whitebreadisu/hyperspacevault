"""stashes: named places for owned copies (App Spec stashes section).

Auth like /api/inventory: reads need a signed-in tenant, writes also need a
verified email (ADR-0034). Nothing here is reachable through a share token.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth import require_verified_email
from app.database import get_db
from app.http_cache import TENANT_CACHE_CONTROL, tenant_no_store
from app.schemas.stash_schema import (
    AllocationResponse,
    MoveRequest,
    MoveResponse,
    SplitConflictResponse,
    SplitRequest,
    SplitResponse,
    StashCreateRequest,
    StashItemResponse,
    StashPatchRequest,
    StashResponse,
)
from app.services import stashes as stash_service

router = APIRouter(
    prefix="/api/stashes",
    tags=["stashes"],
    dependencies=[Depends(tenant_no_store)],
)


def _not_found(what: str = "Stash") -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")


@router.get("", response_model=list[StashResponse])
def list_stashes(db: Session = Depends(get_db)):
    return stash_service.list_stashes(db)


@router.post(
    "",
    response_model=StashResponse,
    status_code=201,
    dependencies=[Depends(require_verified_email)],
)
def create_stash(body: StashCreateRequest, db: Session = Depends(get_db)):
    try:
        return stash_service.create_stash(db, body.name, body.description)
    except stash_service.DuplicateName:
        raise HTTPException(status_code=409, detail="duplicate_name") from None
    except stash_service.StashLimit:
        raise HTTPException(status_code=409, detail="stash_limit") from None


@router.get("/items", response_model=list[StashItemResponse])
def list_items(db: Session = Depends(get_db)):
    return stash_service.list_items(db)


@router.patch(
    "/{stash_id}",
    response_model=StashResponse,
    dependencies=[Depends(require_verified_email)],
)
def patch_stash(stash_id: int, body: StashPatchRequest, db: Session = Depends(get_db)):
    try:
        return stash_service.patch_stash(
            db, stash_id, body.model_dump(exclude_unset=True)
        )
    except stash_service.StashNotFound:
        raise _not_found() from None
    except stash_service.DuplicateName:
        raise HTTPException(status_code=409, detail="duplicate_name") from None


@router.delete(
    "/{stash_id}",
    status_code=204,
    dependencies=[Depends(require_verified_email)],
)
def delete_stash(stash_id: int, db: Session = Depends(get_db)):
    try:
        stash_service.delete_stash(db, stash_id)
    except stash_service.StashNotFound:
        raise _not_found() from None
    return Response(status_code=204)


@router.put(
    "/variants/{variant_id}",
    response_model=SplitResponse,
    dependencies=[Depends(require_verified_email)],
    responses={409: {"model": SplitConflictResponse}},
)
def set_variant_split(
    variant_id: int, body: SplitRequest, db: Session = Depends(get_db)
):
    allocations = {a.stash_id: a.quantity for a in body.allocations}
    expected = (
        None
        if body.expected is None
        else {a.stash_id: a.quantity for a in body.expected}
    )
    try:
        return stash_service.set_variant_split(db, variant_id, allocations, expected)
    except stash_service.SplitChanged as changed:
        return JSONResponse(
            status_code=409,
            content=SplitConflictResponse(
                detail="split_changed",
                variant_id=variant_id,
                owned=changed.owned,
                allocations=[
                    AllocationResponse(stash_id=s, quantity=q)
                    for s, q in sorted(changed.current.items())
                ],
            ).model_dump(),
            # A returned response skips the router's tenant_no_store header.
            headers={"Cache-Control": TENANT_CACHE_CONTROL},
        )
    except stash_service.VariantNotFound:
        raise _not_found("Card") from None
    except stash_service.StashNotFound:
        raise _not_found() from None
    except stash_service.ExceedsOwned:
        raise HTTPException(status_code=409, detail="exceeds_owned") from None


def _wanted(body: MoveRequest) -> dict[int, int]:
    return {i.variant_id: i.quantity for i in body.items}


@router.post(
    "/{stash_id}/return",
    response_model=MoveResponse,
    dependencies=[Depends(require_verified_email)],
)
def return_items(stash_id: int, body: MoveRequest, db: Session = Depends(get_db)):
    try:
        return stash_service.return_items(db, stash_id, _wanted(body))
    except stash_service.StashNotFound:
        raise _not_found() from None
    except stash_service.ExceedsStash:
        raise HTTPException(status_code=409, detail="exceeds_stash") from None


@router.post(
    "/{stash_id}/restore",
    response_model=MoveResponse,
    dependencies=[Depends(require_verified_email)],
)
def restore_items(stash_id: int, body: MoveRequest, db: Session = Depends(get_db)):
    try:
        return stash_service.restore_items(db, stash_id, _wanted(body))
    except stash_service.StashNotFound:
        raise _not_found() from None
    except stash_service.ExceedsOwned:
        raise HTTPException(status_code=409, detail="exceeds_owned") from None
