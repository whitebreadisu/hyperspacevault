"""stashes: queries. RLS (migration 0032) scopes every read and write
to the session's tenant; tenant_id is still stamped explicitly on inserts."""

from sqlalchemy import func, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.models.base_card import BaseCard
from app.models.card_variant import CardVariant
from app.models.inventory import Inventory
from app.models.stash import Stash, StashItem

STASH_LIMIT = 50


def is_invariant_violation(exc: DBAPIError) -> bool:
    """True for the stash_check_invariant() trigger's rejection (message
    prefix `stash_invariant`, migration 0032)."""
    return "stash_invariant" in str(exc.orig)


def pg_error(exc: DBAPIError) -> tuple[str | None, str | None]:
    """(SQLSTATE, constraint name) of the underlying psycopg2 error."""
    orig = exc.orig
    diag = getattr(orig, "diag", None)
    return getattr(orig, "pgcode", None), getattr(diag, "constraint_name", None)


def lock_tenant_stash_creation(db: Session) -> None:
    """Serialize stash creation per tenant for the rest of the transaction
    (advisory xact lock keyed (344, tenant_id)) so the 50 cap is checked and
    the row inserted atomically."""
    db.execute(
        text(
            "SELECT pg_advisory_xact_lock("
            "344, current_setting('app.current_tenant_id')::integer)"
        )
    )


def current_tenant_id(db: Session) -> int:
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar_one()


def list_stashes_with_copies(db: Session) -> list[tuple[Stash, int]]:
    rows = (
        db.query(Stash, func.coalesce(func.sum(StashItem.quantity), 0))
        .outerjoin(StashItem, StashItem.stash_id == Stash.id)
        .group_by(Stash.id)
        .order_by(Stash.created_at, Stash.id)
        .all()
    )
    return [(stash, int(copies)) for stash, copies in rows]


def get_stash(db: Session, stash_id: int) -> Stash | None:
    return db.query(Stash).filter(Stash.id == stash_id).first()


def count_stashes(db: Session) -> int:
    return db.query(func.count(Stash.id)).scalar() or 0


def name_taken(db: Session, name: str, *, excluding_id: int | None = None) -> bool:
    query = db.query(Stash.id).filter(func.lower(Stash.name) == name.lower())
    if excluding_id is not None:
        query = query.filter(Stash.id != excluding_id)
    return query.first() is not None


def copies_for(db: Session, stash_id: int) -> int:
    return int(
        db.query(func.coalesce(func.sum(StashItem.quantity), 0))
        .filter(StashItem.stash_id == stash_id)
        .scalar()
        or 0
    )


def add_stash(db: Session, name: str, description: str | None) -> Stash:
    stash = Stash(tenant_id=current_tenant_id(db), name=name, description=description)
    db.add(stash)
    db.flush()
    return stash


def delete_stash(db: Session, stash: Stash) -> None:
    # stash_items rows go with it (ON DELETE CASCADE): the copies return to
    # the Vault, owned is untouched.
    db.delete(stash)
    db.flush()


def list_items(db: Session) -> list[StashItem]:
    return db.query(StashItem).order_by(StashItem.stash_id, StashItem.variant_id).all()


def variant_exists(db: Session, variant_id: int) -> bool:
    return (
        db.query(CardVariant.id).filter(CardVariant.id == variant_id).first()
        is not None
    )


def existing_stash_ids(db: Session, stash_ids: list[int]) -> set[int]:
    if not stash_ids:
        return set()
    return {row.id for row in db.query(Stash.id).filter(Stash.id.in_(stash_ids)).all()}


def has_stash_items(db: Session) -> bool:
    return db.query(StashItem.stash_id).first() is not None


def lock_all_inventory(db: Session) -> None:
    """Lock every inventory row of the caller, ascending variant_id (import
    commit, when the tenant has stashes)."""
    db.query(Inventory.id).order_by(Inventory.variant_id).with_for_update().all()


def lock_owned(db: Session, variant_id: int) -> int:
    """The caller's owned quantity for one printing, with the inventory row
    locked FOR UPDATE so a concurrent decrement cannot interleave with a
    split write. A missing row is 0 (nothing to lock)."""
    qty = (
        db.query(Inventory.quantity)
        .filter(Inventory.variant_id == variant_id)
        .with_for_update()
        .scalar()
    )
    return int(qty) if qty is not None else 0


def replace_variant_split(
    db: Session, variant_id: int, allocations: dict[int, int]
) -> None:
    """Full replace of one printing's split: rows for every non-zero
    allocation, none for the rest. Does not commit."""
    db.query(StashItem).filter(StashItem.variant_id == variant_id).delete(
        synchronize_session=False
    )
    tenant_id = current_tenant_id(db)
    for stash_id, quantity in allocations.items():
        if quantity > 0:
            db.add(
                StashItem(
                    stash_id=stash_id,
                    tenant_id=tenant_id,
                    variant_id=variant_id,
                    quantity=quantity,
                )
            )
    db.flush()


def stashed_total(db: Session, variant_id: int) -> int:
    """Total stashed copies of one printing across the caller's stashes --
    the floor the owned quantity may not drop below."""
    return int(
        db.query(func.coalesce(func.sum(StashItem.quantity), 0))
        .filter(StashItem.variant_id == variant_id)
        .scalar()
        or 0
    )


def stash_rows_for_import(db: Session):
    """Every stash_items row of the caller with its stash's name and
    ordering key plus the printing's identity -- the import preview reads
    this once (a tenant holds at most 50 stashes) instead of an IN over
    every file variant. Newest stash first, then variant."""
    return (
        db.query(
            StashItem.stash_id,
            Stash.name.label("stash_name"),
            StashItem.variant_id,
            StashItem.quantity,
            BaseCard.name.label("card_name"),
            BaseCard.subtitle,
            CardVariant.variant_type,
            CardVariant.source_set_code,
            CardVariant.card_number,
        )
        .join(Stash, StashItem.stash_id == Stash.id)
        .join(CardVariant, StashItem.variant_id == CardVariant.id)
        .join(BaseCard, CardVariant.base_card_id == BaseCard.id)
        .order_by(Stash.created_at.desc(), Stash.id.desc(), StashItem.variant_id)
        .all()
    )


def apply_stash_cuts(db: Session, cuts: list[tuple[int, int, int]]) -> None:
    """Import commit: set each (stash_id, variant_id) to its after quantity
    (0 deletes the row). Does not commit."""
    for stash_id, variant_id, after in cuts:
        query = db.query(StashItem).filter(
            StashItem.stash_id == stash_id, StashItem.variant_id == variant_id
        )
        if after <= 0:
            query.delete(synchronize_session=False)
        else:
            query.update({StashItem.quantity: after}, synchronize_session=False)
    db.flush()


def lock_inventory_rows(db: Session, variant_ids: list[int]) -> dict[int, int]:
    """Lock the caller's inventory rows for these printings FOR UPDATE in
    ascending variant_id (the order every stash writer uses) and return
    {variant_id: owned}. A printing with no row is simply absent."""
    if not variant_ids:
        return {}
    rows = (
        db.query(Inventory.variant_id, Inventory.quantity)
        .filter(Inventory.variant_id.in_(variant_ids))
        .order_by(Inventory.variant_id)
        .with_for_update()
        .all()
    )
    return {r.variant_id: int(r.quantity) for r in rows}


def stash_quantities(
    db: Session, stash_id: int, variant_ids: list[int]
) -> dict[int, int]:
    """{variant_id: quantity} the stash holds for these printings."""
    rows = (
        db.query(StashItem.variant_id, StashItem.quantity)
        .filter(StashItem.stash_id == stash_id, StashItem.variant_id.in_(variant_ids))
        .all()
    )
    return {r.variant_id: int(r.quantity) for r in rows}


def stashed_totals(db: Session, variant_ids: list[int]) -> dict[int, int]:
    """{variant_id: copies across all the caller's stashes}."""
    rows = (
        db.query(StashItem.variant_id, func.sum(StashItem.quantity))
        .filter(StashItem.variant_id.in_(variant_ids))
        .group_by(StashItem.variant_id)
        .all()
    )
    return {vid: int(total) for vid, total in rows}


def set_stash_quantities(db: Session, stash_id: int, after: dict[int, int]) -> bool:
    """Set the stash's quantity for each printing (0 deletes the row,
    a missing row is inserted). Does not commit. Returns False when a row
    that was read a moment ago is gone (the stash was deleted meanwhile)."""
    tenant_id = current_tenant_id(db)
    existing = stash_quantities(db, stash_id, list(after))
    for variant_id, quantity in sorted(after.items()):
        row = db.query(StashItem).filter(
            StashItem.stash_id == stash_id, StashItem.variant_id == variant_id
        )
        if variant_id in existing:
            if quantity <= 0:
                changed = row.delete(synchronize_session=False)
            else:
                changed = row.update(
                    {StashItem.quantity: quantity}, synchronize_session=False
                )
            if changed != 1:
                return False
        elif quantity > 0:
            db.add(
                StashItem(
                    stash_id=stash_id,
                    tenant_id=tenant_id,
                    variant_id=variant_id,
                    quantity=quantity,
                )
            )
    db.flush()
    return True
