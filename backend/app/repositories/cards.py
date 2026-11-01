from collections.abc import Sequence
from typing import NamedTuple

from sqlalchemy import Row, select
from sqlalchemy.orm import Session, selectinload

from app.models.base_card import BaseCard
from app.models.card_aspect import CardAspect
from app.models.card_keyword import CardKeyword
from app.models.card_trait import CardTrait
from app.models.card_variant import CardVariant
from app.models.set_model import CardSet


def get_catalog_reference_rows(db: Session) -> Sequence[Row]:
    """One row per card_variants row for the public catalog reference CSV
    (App Spec §17.3) -- swuapi_id/set_code/card_number/variant_type/name/
    subtitle. The ORDER BY here is only a stable base; the file's final
    Vault-matching order (curated set groups, numeric card number) is
    applied by services/catalog.py via set_order.export_sort_key. No
    inventory join -- purely catalog data, callable from the tenant-less
    get_catalog_db session (ADR-0008), same posture as
    get_base_card_list_rows below."""
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
    the card popup (App Spec §5.3)."""
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
    """Raw Core rows backing GET /api/base-cards. The service
    layer groups the child rows by base_card_id and builds the nested
    BaseCardCatalogResponse shape."""

    base_rows: Sequence[Row]
    aspect_rows: Sequence[Row]  # (base_card_id, aspect)
    keyword_rows: Sequence[Row]  # (base_card_id, keyword)
    trait_rows: Sequence[Row]  # (base_card_id, trait)
    variant_rows: Sequence[Row]


def get_base_card_list_rows(
    db: Session,
    set_code: str | None = None,
    type: str | None = None,
    rarity: str | None = None,
) -> BaseCardListRows:
    """The base-card list query (ADR-0005), on Core rows rather than ORM
    objects: the response only needs plain column values, and ORM
    hydration of every mapped object dominated the endpoint's generation
    time when measured (ADR-0005 baseline table). This issues 5 Core
    SELECTs (base cards, aspects, keywords, traits, variants) and returns
    plain rows.

    set_code filters on the base card's own (base) set. Filters restrict
    the child queries via an id subquery so aspects/keywords/traits/variants
    stay aligned with the filtered base set.

    Catalog columns only -- no inventory join. Per-tenant quantities come
    from their own endpoint (GET /api/inventory/quantities,
    repositories/inventory.get_quantities), which is what makes this
    query's response publicly cacheable by construction.

    Ordering: base cards by base_card_number; variants by id, so the
    variant order is deterministic."""
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

    # Only the columns list consumers read (the slim list shape, App Spec
    # §12). Detail-only fields (type2/double_sided/is_unique/front_text/
    # back_text/epic_action/artist/set_name) are not selected: CardPopup,
    # their only reader, fetches its own detail row via
    # get_base_card_with_variants. CardSet is joined for set_code alone.
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

    # No stamp_group/source_set_name: no list consumer reads them (App Spec
    # §12), so this query needs no CardSet join.
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
