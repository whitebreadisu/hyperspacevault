from collections import defaultdict

from sqlalchemy import func, text, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.base_card import BaseCard
from app.models.card_variant import CardVariant
from app.models.inventory import Inventory
from app.models.set_model import CardSet

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


def get_variants_by_set_and_number(
    db: Session, pairs: list[tuple[str, str]]
) -> dict[tuple[str, str], list[VariantMatch]]:
    """BL-185 §6 step 3: bulk (set_code, card_number) lookup for the SWUDB
    import adapter -- mirrors get_variants_by_triples above, but without
    the variant_type leg of the triple, since SWUDB's own raw identity
    (Set, CardNumber, IsFoil, Stamp) never carries a variant_type at all.
    IsFoil/Stamp disambiguate the returned candidate list in app/services/
    swudb_import.py, not here -- this is a plain bulk lookup, same shape as
    get_variants_by_triples (usually one candidate; multiple is the
    expected-collision case, §5)."""
    if not pairs:
        return {}
    rows = (
        db.query(CardVariant, BaseCard.name, BaseCard.subtitle, BaseCard.type)
        .join(BaseCard, CardVariant.base_card_id == BaseCard.id)
        .filter(tuple_(CardVariant.source_set_code, CardVariant.card_number).in_(pairs))
        .all()
    )
    grouped: dict[tuple[str, str], list[VariantMatch]] = defaultdict(list)
    for variant, name, subtitle, base_card_type in rows:
        key = (variant.source_set_code, variant.card_number)
        grouped[key].append((variant, name, subtitle, base_card_type))
    return grouped


def get_base_card_variants_by_set_and_number(
    db: Session, pairs: list[tuple[str, str]]
) -> dict[tuple[str, str], list[VariantMatch]]:
    """BL-186 §5/§10 step 1: bulk (mapped_set_code, base_card_number) ->
    EVERY variant belonging to that base card, regardless of each
    variant's OWN source_set_code/card_number -- the base-card-first
    lookup the sw-unlimited-db adapter needs (app/services/
    swunlimiteddb_import.py). This is deliberately NOT the same shape as
    get_variants_by_set_and_number above (BL-185's lookup keys on a
    VARIANT's own (source_set_code, card_number)) -- sw-unlimited-db's
    row identity is the BASE card, and a promo/prerelease/Weekly-Play
    variant on that base card can live at a completely different own-
    number in a different source_set_code (the BL-186 definition doc's
    §10 finding: the Vader prerelease printing lands on the base sor/010
    row, not on its own SOR/1 identity). The adapter filters this
    per-base-card variant list down to a column's family and disambiguates
    (home-set preference, then ambiguous) itself -- this function only
    does the bulk fetch, mirroring the split between get_variants_by_
    set_and_number and swudb_import._resolve_candidates."""
    if not pairs:
        return {}
    rows = (
        db.query(
            CardVariant,
            BaseCard.name,
            BaseCard.subtitle,
            BaseCard.type,
            CardSet.code,
            BaseCard.base_card_number,
        )
        .join(BaseCard, CardVariant.base_card_id == BaseCard.id)
        .join(CardSet, BaseCard.set_id == CardSet.id)
        .filter(tuple_(CardSet.code, BaseCard.base_card_number).in_(pairs))
        .all()
    )
    grouped: dict[tuple[str, str], list[VariantMatch]] = defaultdict(list)
    for variant, name, subtitle, base_card_type, set_code, base_card_number in rows:
        key = (set_code, base_card_number)
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
