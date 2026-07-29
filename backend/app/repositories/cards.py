from typing import NamedTuple

from sqlalchemy import Row, select
from sqlalchemy.orm import Session, selectinload

from app.models.base_card import BaseCard
from app.models.card_aspect import CardAspect
from app.models.card_keyword import CardKeyword
from app.models.card_trait import CardTrait
from app.models.card_variant import CardVariant
from app.models.set_model import CardSet

# BL-102: get_variants/get_variant_by_id (the flat variant queries behind
# GET /api/cards*) retired -- runtime-dead since BL-56/BL-44 Slice B. Git
# history has them if a flat variant read API is ever wanted.


def get_catalog_reference_rows(db: Session) -> list[Row]:
    """BL-54 S1 (§6): one row per card_variants row for the public catalog
    reference CSV -- swuapi_id/set_code/card_number/variant_type/name/
    subtitle. The ORDER BY here is only a stable base; the file's final
    Vault-matching order (curated set groups, numeric card number) is
    applied by services/catalog.py via set_order.export_sort_key. No
    inventory join -- purely catalog data, callable from the tenant-less
    get_catalog_db session (ADR-0008), same posture as
    get_base_card_list_rows above."""
    cv = CardVariant.__table__.c
    bc = BaseCard.__table__.c
    return db.execute(
        select(
            cv.swuapi_id,
            cv.source_set_code,
            cv.card_number,
            cv.variant_type,
            bc.name,
            bc.subtitle,
        )
        .join(BaseCard, cv.base_card_id == bc.id)
        .order_by(cv.source_set_code, cv.card_number, cv.variant_type)
    ).all()


def get_base_card_with_variants(db: Session, base_card_id: int) -> BaseCard | None:
    """Loads one base card with its full variant long tail eager-loaded
    (each variant's source_set + tenant-scoped inventory row, per the RLS
    `db` session passed in), plus shared aspects/keywords/traits. Backs
    the card detail / card-inventory popups (redesign spec §5.3)."""
    return (
        db.query(BaseCard)
        .options(
            selectinload(BaseCard.set),
            selectinload(BaseCard.aspects),
            selectinload(BaseCard.keywords),
            selectinload(BaseCard.traits),
            selectinload(BaseCard.variants).selectinload(CardVariant.source_set),
            selectinload(BaseCard.variants).selectinload(CardVariant.inventory),
        )
        .filter(BaseCard.id == base_card_id)
        .first()
    )


class BaseCardListRows(NamedTuple):
    """Raw Core rows backing GET /api/base-cards (BL-100). The service
    layer groups the child rows by base_card_id and builds the nested
    BaseCardCatalogResponse shape."""

    base_rows: list[Row]
    aspect_rows: list[Row]  # (base_card_id, aspect)
    keyword_rows: list[Row]  # (base_card_id, keyword)
    trait_rows: list[Row]  # (base_card_id, trait)
    variant_rows: list[Row]


def get_base_card_list_rows(
    db: Session,
    set_code: str | None = None,
    type: str | None = None,
    rarity: str | None = None,
) -> BaseCardListRows:
    """BL-44 Slice A payload-shrink query, rebuilt on Core rows for BL-100.

    The original selectinload version already avoided N+1 (fixed query
    count), but profiling (BL-100, 2026-07-10) showed ORM hydration of the
    ~10.7k mapped objects was 62% of the endpoint's ~0.87 s local
    generation time -- the response only needs plain column values, so
    hydrating full ORM instances was pure overhead. This issues 5 Core
    SELECTs (vs 56 chunked selectinload queries) and returns plain rows,
    cutting generation ~2.8x (see ADR-0005 baseline table).

    Same filter semantics as get_variants: set_code filters on the base
    card's own (base) set. Filters restrict the child queries via an id
    subquery so aspects/keywords/traits/variants stay aligned with the
    filtered base set.

    BL-101: catalog columns only -- no inventory join. Per-tenant
    quantities moved to their own endpoint (GET /api/inventory/quantities,
    repositories/inventory.get_quantities), which is what makes this
    query's response publicly cacheable by construction.

    Ordering: base cards by base_card_number (unchanged); variants by id
    (the old relationship load had no ORDER BY -- heap order -- so id
    order is a determinism upgrade, not a contract change)."""
    bc = BaseCard.__table__.c

    id_q = select(bc.id)
    if set_code:
        id_q = id_q.join(CardSet, bc.set_id == CardSet.id).where(
            CardSet.code == set_code
        )
    if type:
        id_q = id_q.where(bc.type == type)
    if rarity:
        id_q = id_q.where(bc.rarity == rarity)
    filtered = bool(set_code or type or rarity)

    # BL-146 (Design_SparseList_2026-07-25.md §2/§5): type2/double_sided/
    # is_unique/front_text/back_text/epic_action/artist/set_name dropped --
    # zero list-consumer reads (CardPopup, the only reader, fetches its own
    # detail row via get_base_card_with_variants). CardSet stays joined for
    # set_code alone.
    base_q = (
        select(
            bc.id,
            bc.base_card_number,
            bc.name,
            bc.subtitle,
            bc.type,
            bc.rarity,
            bc.cost,
            bc.power,
            bc.hp,
            bc.arena,
            bc.is_token,
            CardSet.code.label("set_code"),
        )
        .join(CardSet, bc.set_id == CardSet.id)
        .order_by(bc.base_card_number)
    )
    if set_code:
        base_q = base_q.where(CardSet.code == set_code)
    if type:
        base_q = base_q.where(bc.type == type)
    if rarity:
        base_q = base_q.where(bc.rarity == rarity)

    aspect_q = select(CardAspect.base_card_id, CardAspect.aspect)
    keyword_q = select(CardKeyword.base_card_id, CardKeyword.keyword)
    trait_q = select(CardTrait.base_card_id, CardTrait.trait)

    # BL-146: stamp_group/source_set_name dropped -- zero list-consumer
    # reads (§1.8's census) -- which also drops the CardSet join here
    # entirely (it existed only to label source_set_name).
    cv = CardVariant.__table__.c
    variant_q = select(
        cv.id,
        cv.base_card_id,
        cv.variant_type,
        cv.source_set_code,
        cv.card_number,
        cv.front_image_url,
        cv.back_image_url,
    ).order_by(cv.id)

    if filtered:
        aspect_q = aspect_q.where(CardAspect.base_card_id.in_(id_q))
        keyword_q = keyword_q.where(CardKeyword.base_card_id.in_(id_q))
        trait_q = trait_q.where(CardTrait.base_card_id.in_(id_q))
        variant_q = variant_q.where(cv.base_card_id.in_(id_q))

    return BaseCardListRows(
        base_rows=db.execute(base_q).all(),
        aspect_rows=db.execute(aspect_q).all(),
        keyword_rows=db.execute(keyword_q).all(),
        trait_rows=db.execute(trait_q).all(),
        variant_rows=db.execute(variant_q).all(),
    )
