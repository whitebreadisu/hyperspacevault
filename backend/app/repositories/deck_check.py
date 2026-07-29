"""BL-137: DB access for the deck-check feature -- SET_NUM resolution
(D1), finish-agnostic ownership (D3), and per-base-card variant prices for
the cost join (D4). Reuses app.repositories.pricing.get_latest_prices (the
BL-136 P4 query, rewired in BL-146 to read the variant_latest_prices
snapshot table) rather than duplicating the latest-price lookup."""

from __future__ import annotations

from collections import defaultdict
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base_card import BaseCard
from app.models.card_variant import CardVariant
from app.models.inventory import Inventory
from app.models.set_model import CardSet
from app.repositories import pricing as pricing_repo
from app.services.pricing import VariantTypePrice, to_price_info


def get_known_set_codes(db: Session) -> frozenset[str]:
    """Every set code in the catalog, upper-cased -- the pool
    deck_resolution.parse_set_num matches a raw SET_NUM's prefix against."""
    rows = db.execute(select(CardSet.code)).scalars().all()
    return frozenset(code.upper() for code in rows)


def resolve_base_cards(
    db: Session, pairs: list[tuple[str, int]]
) -> dict[tuple[str, int], int]:
    """Batch-resolves (set_code, base_card_number) pairs to base_card_id,
    non-token roots only -- SWU_Application_Spec.md §15.3's confirmed rule.
    A pair absent from the returned dict means "no match"; callers must
    treat that as unresolved, never guess a nearest card."""
    if not pairs:
        return {}
    unique_set_codes = {code for code, _ in pairs}
    bc = BaseCard.__table__.c
    rows = db.execute(
        select(bc.id, CardSet.code, bc.base_card_number)
        .join(CardSet, bc.set_id == CardSet.id)
        .where(CardSet.code.in_(unique_set_codes), bc.is_token.is_(False))
    ).all()
    by_key: dict[tuple[str, int], int] = {}
    for row in rows:
        number = row.base_card_number
        if number.isdigit():
            by_key[(row.code, int(number))] = row.id
    return {pair: by_key[pair] for pair in pairs if pair in by_key}


def get_owned_quantities(db: Session, base_card_ids: list[int]) -> dict[int, int]:
    """Definition_DeckCheck §4: ownership is finish-agnostic -- sum of
    inventory.quantity across every variant of a base card, any printing.
    RLS scopes this to the calling session's own tenant (or zero rows for a
    tenant-less/anonymous session -- deck-check is auth-only so that case
    shouldn't reach here, but the query degrades safely regardless)."""
    if not base_card_ids:
        return {}
    cv = CardVariant.__table__.c
    inv = Inventory.__table__.c
    rows = db.execute(
        select(cv.base_card_id, func.sum(inv.quantity))
        .select_from(CardVariant)
        .join(Inventory, cv.id == inv.variant_id)
        .where(cv.base_card_id.in_(base_card_ids))
        .group_by(cv.base_card_id)
    ).all()
    return {row[0]: int(row[1]) for row in rows}


class BaseCardRef(NamedTuple):
    """Light display info for one base card -- enough for a deck-check
    response's leader/base/missing-card summaries without pulling the full
    variant long tail (app.repositories.cards.get_base_card_with_variants
    is the heavier, catalog-detail-popup version of this)."""

    id: int
    set_code: str
    base_card_number: str
    name: str
    subtitle: str | None
    type: str
    front_image_url: str | None


def get_base_card_refs(db: Session, base_card_ids: list[int]) -> dict[int, BaseCardRef]:
    if not base_card_ids:
        return {}
    bc = BaseCard.__table__.c
    cv = CardVariant.__table__.c
    rows = db.execute(
        select(
            bc.id,
            CardSet.code.label("set_code"),
            bc.base_card_number,
            bc.name,
            bc.subtitle,
            bc.type,
            cv.front_image_url,
        )
        .select_from(BaseCard)
        .join(CardSet, bc.set_id == CardSet.id)
        .outerjoin(
            CardVariant,
            (cv.base_card_id == bc.id) & (cv.variant_type == "Standard"),
        )
        .where(bc.id.in_(base_card_ids))
    ).all()
    return {
        row.id: BaseCardRef(
            id=row.id,
            set_code=row.set_code,
            base_card_number=row.base_card_number,
            name=row.name,
            subtitle=row.subtitle,
            type=row.type,
            front_image_url=row.front_image_url,
        )
        for row in rows
    }


def get_variant_type_prices(
    db: Session, base_card_ids: list[int]
) -> dict[int, list[VariantTypePrice]]:
    """Per base card, every variant's (variant_type, PriceInfo|None) pair --
    the shape app.services.pricing.compute_display_price already consumes,
    reused here for the deck-check cost join (D4)."""
    if not base_card_ids:
        return {}
    cv = CardVariant.__table__.c
    variant_rows = db.execute(
        select(cv.id, cv.base_card_id, cv.variant_type).where(
            cv.base_card_id.in_(base_card_ids)
        )
    ).all()
    variant_ids = [row.id for row in variant_rows]
    price_rows = pricing_repo.get_latest_prices(db, variant_ids)
    result: dict[int, list[VariantTypePrice]] = defaultdict(list)
    for row in variant_rows:
        price_info = to_price_info(price_rows.get(row.id))
        result[row.base_card_id].append(VariantTypePrice(row.variant_type, price_info))
    return dict(result)
