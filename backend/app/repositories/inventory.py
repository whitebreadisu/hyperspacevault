from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload

from app.models.base_card import BaseCard
from app.models.card_variant import CardVariant
from app.models.inventory import Inventory


def _current_tenant_id(db: Session) -> int:
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar()


def get_quantities(db: Session) -> list[tuple[int, int]]:
    """BL-101: the caller's sparse (variant_id, quantity) rows -- the
    per-tenant half of the catalog/quantity split. RLS scopes the rows to
    the session's tenant; the frontend merges these onto the (publicly
    cached) catalog list and treats every missing variant_id as 0."""
    return [
        (row.variant_id, row.quantity)
        for row in db.query(Inventory.variant_id, Inventory.quantity)
        .order_by(Inventory.variant_id)
        .all()
    ]


# BL-102: get_variants_with_inventory (the whole-catalog join behind
# GET /api/inventory) retired -- runtime-dead since BL-56; get_quantities
# above is its designed replacement (BL-101).


def get_variant_with_inventory(db: Session, variant_id: int) -> CardVariant | None:
    return (
        db.query(CardVariant)
        .options(
            selectinload(CardVariant.base_card).selectinload(BaseCard.set),
            selectinload(CardVariant.base_card).selectinload(BaseCard.aspects),
            selectinload(CardVariant.base_card).selectinload(BaseCard.keywords),
            selectinload(CardVariant.base_card).selectinload(BaseCard.traits),
            selectinload(CardVariant.inventory),
        )
        .filter(CardVariant.id == variant_id)
        .first()
    )


def get_base_card_total(db: Session, base_card_id: int) -> int:
    """Sum of inventory.quantity across every variant of one base card.

    BL-24: no longer used for blocking (each variant's own quantity is
    compared to its own effective limit instead -- see
    services/inventory.py's increment_card) -- this now backs only
    "playset_complete", which stays "3 total copies across every variant of
    this base card" regardless of the effective per-variant limit."""
    result = (
        db.query(func.sum(func.coalesce(Inventory.quantity, 0)))
        .select_from(CardVariant)
        .outerjoin(Inventory, CardVariant.id == Inventory.variant_id)
        .filter(CardVariant.base_card_id == base_card_id)
        .scalar()
    )
    return int(result) if result is not None else 0


def upsert_increment(db: Session, variant_id: int) -> Inventory:
    """Atomically insert-or-increment the (tenant_id, variant_id) row in a
    single statement, relying on uq_inventory_tenant_id_variant_id so
    concurrent increments for the same variant can't lose an update."""
    tenant_id = _current_tenant_id(db)
    table = Inventory.__table__
    stmt = (
        pg_insert(table)
        .values(tenant_id=tenant_id, variant_id=variant_id, quantity=1)
        .on_conflict_do_update(
            index_elements=["tenant_id", "variant_id"],
            set_={"quantity": table.c.quantity + 1, "updated_at": func.now()},
        )
        .returning(table)
    )
    row = db.execute(stmt).one()
    db.commit()
    return Inventory(**row._mapping)


def upsert_adjust(db: Session, variant_id: int, delta: int) -> Inventory:
    """BL-219: atomically insert-or-adjust the (tenant_id, variant_id) row
    by an arbitrary signed `delta` in a single statement -- extends
    upsert_increment/upsert_decrement's ON CONFLICT pattern (still one
    atomic write, no lost updates under concurrent adjusts) to a caller-
    resolved delta instead of a fixed +-1, floor/ceiling clamped in the same
    SQL expression via GREATEST/LEAST (mirrors upsert_decrement's floor
    clamp, extended with a ceiling too).

    `delta` here is the SERVICE layer's already-resolved `applied` amount
    (services/inventory.py's adjust_card/_resolve_adjust already clamped it
    against the effective limit/999 ceiling using a quantity read moments
    earlier) -- this statement's own [0, 999] clamp is a defensive re-clamp
    against the *actual* stored value at write time, not a re-decision: if a
    concurrent write raced the earlier read, the write below still can never
    push the stored quantity out of bounds, but the limit/ceiling *decision*
    that produced `delta` can be marginally stale under that race -- the
    same tolerated posture increment_card's existing pre-read-then-atomic-
    write already has today (BL-219's spec explicitly notes this: the ON
    CONFLICT write is already atomic, so cross-call serialization isn't
    needed for correctness)."""
    tenant_id = _current_tenant_id(db)
    table = Inventory.__table__
    stmt = (
        pg_insert(table)
        .values(
            tenant_id=tenant_id, variant_id=variant_id, quantity=max(min(delta, 999), 0)
        )
        .on_conflict_do_update(
            index_elements=["tenant_id", "variant_id"],
            set_={
                "quantity": func.least(func.greatest(table.c.quantity + delta, 0), 999),
                "updated_at": func.now(),
            },
        )
        .returning(table)
    )
    row = db.execute(stmt).one()
    db.commit()
    return Inventory(**row._mapping)


def get_export_rows(db: Session):
    """BL-54 S1 (§7.1): every inventory row with quantity >= 1, joined to
    its variant + base card. The ORDER BY here is only a stable base; the
    export's final Vault-matching order (curated set groups, numeric card
    number) is applied by services/inventory.py via
    set_order.export_sort_key. RLS scopes rows to the caller's tenant via
    the `db` session passed in (get_db) -- no explicit tenant_id filter
    needed here, same posture as get_quantities above."""
    return (
        db.query(
            Inventory.quantity,
            CardVariant.swuapi_id,
            CardVariant.variant_type,
            CardVariant.source_set_code,
            CardVariant.card_number,
            BaseCard.name,
            BaseCard.subtitle,
        )
        .join(CardVariant, Inventory.variant_id == CardVariant.id)
        .join(BaseCard, CardVariant.base_card_id == BaseCard.id)
        .filter(Inventory.quantity >= 1)
        .order_by(
            CardVariant.source_set_code,
            CardVariant.card_number,
            CardVariant.variant_type,
        )
        .all()
    )


def upsert_decrement(db: Session, variant_id: int) -> Inventory:
    """Atomically insert-or-decrement (clamped at 0) the (tenant_id,
    variant_id) row in a single statement, mirroring upsert_increment."""
    tenant_id = _current_tenant_id(db)
    table = Inventory.__table__
    stmt = (
        pg_insert(table)
        .values(tenant_id=tenant_id, variant_id=variant_id, quantity=0)
        .on_conflict_do_update(
            index_elements=["tenant_id", "variant_id"],
            set_={
                "quantity": func.greatest(table.c.quantity - 1, 0),
                "updated_at": func.now(),
            },
        )
        .returning(table)
    )
    row = db.execute(stmt).one()
    db.commit()
    return Inventory(**row._mapping)
