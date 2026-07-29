from collections import defaultdict

from sqlalchemy import func, text, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.base_card import BaseCard
from app.models.card_variant import CardVariant
from app.models.inventory import Inventory

# BL-54 S2 (§4): a row of everything the resolution engine and report
# builder need about a matched variant -- avoids re-querying BaseCard for
# name/subtitle/type per row once a variant is found.
VariantMatch = tuple[
    CardVariant, str, str | None, str
]  # (variant, name, subtitle, base_card_type)


def _current_tenant_id(db: Session) -> int:
    """Mirrors repositories/inventory.py's helper of the same name --
    duplicated rather than imported so this module stays a self-contained
    repository leaf, matching the existing per-repository-module posture
    (tenant_card_limits.py and account.py each define their own copy too)."""
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar()


def get_variants_by_uuids(db: Session, uuids: list[str]) -> dict[str, VariantMatch]:
    """§4 step 1: bulk uuid lookup for every distinct swuapi_uuid the file's
    rows carry, keyed by swuapi_id -- one query regardless of file size."""
    if not uuids:
        return {}
    rows = (
        db.query(CardVariant, BaseCard.name, BaseCard.subtitle, BaseCard.type)
        .join(BaseCard, CardVariant.base_card_id == BaseCard.id)
        .filter(CardVariant.swuapi_id.in_(uuids))
        .all()
    )
    return {
        variant.swuapi_id: (variant, name, subtitle, base_card_type)
        for variant, name, subtitle, base_card_type in rows
    }


def get_variants_by_triples(
    db: Session, triples: list[tuple[str, str, str]]
) -> dict[tuple[str, str, str], list[VariantMatch]]:
    """§4 step 2: bulk triple lookup (set_code, card_number, variant_type)
    -> every matching variant (usually exactly one; the Serialized Prestige
    trio is the known ambiguous shape, §10 case 3). Composite IN via
    tuple_() -- one query for every distinct triple in the file."""
    if not triples:
        return {}
    rows = (
        db.query(CardVariant, BaseCard.name, BaseCard.subtitle, BaseCard.type)
        .join(BaseCard, CardVariant.base_card_id == BaseCard.id)
        .filter(
            tuple_(
                CardVariant.source_set_code,
                CardVariant.card_number,
                CardVariant.variant_type,
            ).in_(triples)
        )
        .all()
    )
    grouped: dict[tuple[str, str, str], list[VariantMatch]] = defaultdict(list)
    for variant, name, subtitle, base_card_type in rows:
        key = (variant.source_set_code, variant.card_number, variant.variant_type)
        grouped[key].append((variant, name, subtitle, base_card_type))
    return grouped


def get_current_quantities(db: Session, variant_ids: list[int]) -> dict[int, int]:
    """The caller's current quantity for each resolved variant_id -- RLS
    scopes rows to the request's tenant via `db`, same posture as
    repositories/inventory.py's get_quantities. A variant absent from the
    returned dict has no inventory row yet (current quantity 0)."""
    if not variant_ids:
        return {}
    return {
        row.variant_id: row.quantity
        for row in db.query(Inventory.variant_id, Inventory.quantity)
        .filter(Inventory.variant_id.in_(variant_ids))
        .all()
    }


def get_owned_rows_excluding(db: Session, excluded_variant_ids: set[int]):
    """§5/§7.3 `replace_all`: every currently-owned (quantity >= 1) row for
    the caller's tenant whose variant isn't among the file's resolved
    variants -- the removal itemization (`totals.removed_by_replace_all` +
    the `removed` list). RLS scopes to the caller's tenant via `db`."""
    query = (
        db.query(
            Inventory.variant_id,
            Inventory.quantity,
            CardVariant.swuapi_id,
            CardVariant.source_set_code,
            CardVariant.card_number,
            CardVariant.variant_type,
            BaseCard.name,
            BaseCard.subtitle,
        )
        .join(CardVariant, Inventory.variant_id == CardVariant.id)
        .join(BaseCard, CardVariant.base_card_id == BaseCard.id)
        .filter(Inventory.quantity >= 1)
    )
    if excluded_variant_ids:
        query = query.filter(~Inventory.variant_id.in_(excluded_variant_ids))
    return query.order_by(
        CardVariant.source_set_code,
        CardVariant.card_number,
        CardVariant.variant_type,
    ).all()


def apply_quantities(db: Session, updates: dict[int, int]) -> None:
    """§7.2 commit stage: writes each resolved row's target quantity.
    Deliberately does NOT call db.commit() -- the whole import (this
    function plus any replace_all removals) is applied inside the single
    request-scoped transaction the router commits exactly once, so a
    mid-way failure rolls back everything (unlike upsert_increment/
    upsert_decrement in repositories/inventory.py, which each commit their
    own single-row change)."""
    if not updates:
        return
    tenant_id = _current_tenant_id(db)
    table = Inventory.__table__
    for variant_id, quantity in updates.items():
        stmt = (
            pg_insert(table)
            .values(tenant_id=tenant_id, variant_id=variant_id, quantity=quantity)
            .on_conflict_do_update(
                index_elements=["tenant_id", "variant_id"],
                set_={"quantity": quantity, "updated_at": func.now()},
            )
        )
        db.execute(stmt)
