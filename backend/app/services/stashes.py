"""stashes: business rules over repositories/stashes.py.

The service layer produces the friendly errors; the deferred constraint
triggers in migration 0032 are the backstop (a violation they catch is
translated to the same `exceeds_owned`).
"""

from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.models.stash import Stash
from app.repositories import stashes as stash_repo
from app.schemas.stash_schema import (
    AllocationResponse,
    MoveResponse,
    RemainingItem,
    SplitResponse,
    StashItemResponse,
    StashResponse,
)


class StashNotFound(Exception):
    pass


class VariantNotFound(Exception):
    pass


class DuplicateName(Exception):
    pass


class StashLimit(Exception):
    pass


class ExceedsOwned(Exception):
    pass


def _response(stash: Stash, copies: int) -> StashResponse:
    return StashResponse(
        id=stash.id,
        name=stash.name,
        description=stash.description,
        created_at=stash.created_at,
        copies=copies,
    )


def _is_duplicate_name(exc: IntegrityError) -> bool:
    code, constraint = stash_repo.pg_error(exc)
    return code == "23505" and constraint == "uq_stashes_tenant_lower_name"


def list_stashes(db: Session) -> list[StashResponse]:
    return [
        _response(s, copies) for s, copies in stash_repo.list_stashes_with_copies(db)
    ]


def create_stash(db: Session, name: str, description: str | None) -> StashResponse:
    # Serialize per tenant before the checks so the cap holds under
    # concurrency (the lock lasts until the commit below).
    stash_repo.lock_tenant_stash_creation(db)
    if stash_repo.name_taken(db, name):
        db.rollback()
        raise DuplicateName
    if stash_repo.count_stashes(db) >= stash_repo.STASH_LIMIT:
        db.rollback()
        raise StashLimit
    try:
        stash = stash_repo.add_stash(db, name, description)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_duplicate_name(exc):
            raise DuplicateName from exc
        raise
    db.refresh(stash)
    return _response(stash, 0)


def patch_stash(db: Session, stash_id: int, changes: dict) -> StashResponse:
    stash = stash_repo.get_stash(db, stash_id)
    if stash is None:
        raise StashNotFound
    if "name" in changes:
        if stash_repo.name_taken(db, changes["name"], excluding_id=stash_id):
            raise DuplicateName
        stash.name = changes["name"]
    if "description" in changes:
        stash.description = changes["description"]
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_duplicate_name(exc):
            raise DuplicateName from exc
        raise
    db.refresh(stash)
    return _response(stash, stash_repo.copies_for(db, stash_id))


def delete_stash(db: Session, stash_id: int) -> None:
    """Delete a stash; its rows cascade, the copies return to the Vault.
    Same lock protocol as every stash writer: the inventory rows of the
    printings it holds first (ascending variant_id), then the stash row (the
    DELETE itself), so a split PUT, return or restore on one of those
    printings either finishes first or sees the stash gone."""
    stash = stash_repo.get_stash(db, stash_id)
    if stash is None:
        raise StashNotFound
    stash_repo.lock_inventory_rows(db, stash_repo.stash_variant_ids(db, stash_id))
    stash_repo.delete_stash(db, stash)
    db.commit()


def list_items(db: Session) -> list[StashItemResponse]:
    return [
        StashItemResponse(
            stash_id=i.stash_id,
            variant_id=i.variant_id,
            quantity=i.quantity,
            stashed_at=i.stashed_at,
        )
        for i in stash_repo.list_items(db)
    ]


class SplitChanged(Exception):
    """The stored split is not the one the client expected (nothing written)."""

    def __init__(self, owned: int, current: dict[int, int]):
        super().__init__("split_changed")
        self.owned = owned
        self.current = current


def set_variant_split(
    db: Session,
    variant_id: int,
    allocations: dict[int, int],
    expected: dict[int, int] | None = None,
) -> SplitResponse:
    """Replace the whole split for one printing (omitted stash = 0). With
    `expected`, only if the stored split equals it (zeros ignored): checked
    under the printing's inventory lock, which every stash write takes
    first, so a return, restore or import cannot slip in between."""
    if not stash_repo.variant_exists(db, variant_id):
        raise VariantNotFound
    # Every referenced stash must be the caller's, zero-quantity ones too.
    if stash_repo.existing_stash_ids(db, list(allocations)) != set(allocations):
        raise StashNotFound

    owned = stash_repo.lock_owned(db, variant_id)
    if expected is not None:
        current = stash_repo.variant_split(db, variant_id)
        if {s: q for s, q in expected.items() if q > 0} != current:
            db.rollback()
            raise SplitChanged(owned, current)
    if sum(allocations.values()) > owned:
        db.rollback()
        raise ExceedsOwned
    try:
        stash_repo.replace_variant_split(db, variant_id, allocations)
        db.commit()
    except DBAPIError as exc:
        db.rollback()
        if stash_repo.is_invariant_violation(exc):
            raise ExceedsOwned from exc
        # A stash deleted between the existence check and the insert breaks
        # the composite FK (23503): that stash is simply gone.
        if isinstance(exc, IntegrityError) and stash_repo.pg_error(exc)[0] == "23503":
            raise StashNotFound from exc
        raise
    return SplitResponse(
        variant_id=variant_id,
        owned=owned,
        allocations=[
            AllocationResponse(stash_id=sid, quantity=q)
            for sid, q in sorted(allocations.items())
            if q > 0
        ],
    )


class ExceedsStash(Exception):
    pass


def _move_response(db: Session, stash_id: int, after: dict[int, int]) -> MoveResponse:
    return MoveResponse(
        stash_id=stash_id,
        copies=stash_repo.copies_for(db, stash_id),
        items=[
            RemainingItem(variant_id=v, quantity=q) for v, q in sorted(after.items())
        ],
    )


def return_items(db: Session, stash_id: int, wanted: dict[int, int]) -> MoveResponse:
    """Move copies from a stash back to the Vault (owned is unchanged).
    All or nothing: any quantity above what the stash holds writes nothing."""
    if stash_repo.get_stash(db, stash_id) is None:
        raise StashNotFound
    ids = sorted(wanted)
    # Same lock order as the split PUT, so the two serialize per printing.
    stash_repo.lock_inventory_rows(db, ids)
    # Lock the stash itself (after the inventory rows): a concurrent DELETE
    # waits for this move, and one that already won makes this a 404.
    if not stash_repo.lock_stash(db, stash_id):
        db.rollback()
        raise StashNotFound
    held = stash_repo.stash_quantities(db, stash_id, ids)
    if any(wanted[v] > held.get(v, 0) for v in ids):
        db.rollback()
        raise ExceedsStash
    after = {v: held[v] - wanted[v] for v in ids}
    try:
        stash_repo.set_stash_quantities(db, stash_id, after)
        # Read the response while the locks are still held, then commit.
        response = _move_response(db, stash_id, after)
        db.commit()
    except DBAPIError:
        db.rollback()
        raise
    return response


def restore_items(db: Session, stash_id: int, wanted: dict[int, int]) -> MoveResponse:
    """Undo of a return: put copies back into the stash. All or nothing:
    the Vault must still hold enough unstashed copies of every printing."""
    if stash_repo.get_stash(db, stash_id) is None:
        raise StashNotFound
    ids = sorted(wanted)
    owned = stash_repo.lock_inventory_rows(db, ids)
    if not stash_repo.lock_stash(db, stash_id):
        db.rollback()
        raise StashNotFound
    totals = stash_repo.stashed_totals(db, ids)
    if any(wanted[v] > owned.get(v, 0) - totals.get(v, 0) for v in ids):
        db.rollback()
        raise ExceedsOwned
    held = stash_repo.stash_quantities(db, stash_id, ids)
    after = {v: held.get(v, 0) + wanted[v] for v in ids}
    try:
        stash_repo.set_stash_quantities(db, stash_id, after)
        response = _move_response(db, stash_id, after)
        db.commit()
    except DBAPIError as exc:
        db.rollback()
        if stash_repo.is_invariant_violation(exc):
            raise ExceedsOwned from exc
        if isinstance(exc, IntegrityError) and stash_repo.pg_error(exc)[0] == "23503":
            raise StashNotFound from exc
        raise
    return response
