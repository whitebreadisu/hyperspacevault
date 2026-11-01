from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session

from app.ingestion.swuapi_classify import classify_variant
from app.models.base_card import BaseCard
from app.models.card_variant import CardVariant
from app.repositories import cards as card_repo
from app.repositories import pricing as pricing_repo
from app.schemas.base_card_detail_schema import (
    BaseCardCatalogResponse,
    BaseCardDetailResponse,
    CardVariantCatalogResponse,
    CardVariantDetailResponse,
    ImageRenditions,
    PriceHistoryPoint,
    PriceHistoryResponse,
)
from app.services.image_paths import same_origin_renditions
from app.services.pricing import (
    PricingEnvelope,
    VariantTypePrice,
    compute_display_price,
    to_price_info,
)


def _renditions(url: str | None) -> ImageRenditions | None:
    """Derive the additive srcset field from a stored CDN
    URL, or None when this side has no image at all (e.g. most
    non-double-sided cards have no back_image_url)."""
    return ImageRenditions(**same_origin_renditions(url)) if url else None


def _to_variant_detail(
    variant: CardVariant, price_rows: dict
) -> CardVariantDetailResponse:
    classification = classify_variant(variant.variant_type, variant.source_set_code)
    qty = variant.inventory.quantity if variant.inventory else 0
    return CardVariantDetailResponse(
        variant_id=variant.id,
        variant_type=variant.variant_type,
        finish=classification.finish,
        channel=classification.channel,
        stamped=classification.stamped,
        source_set_code=variant.source_set_code,
        source_set_name=variant.source_set.name,
        card_number=variant.card_number,
        front_image_url=variant.front_image_url,
        back_image_url=variant.back_image_url,
        front_images=_renditions(variant.front_image_url),
        back_images=_renditions(variant.back_image_url),
        stamp_group=variant.stamp_group,
        quantity=qty,
        price=to_price_info(price_rows.get(variant.id)),
    )


def _to_base_card_detail(
    base_card: BaseCard, price_rows: dict
) -> BaseCardDetailResponse:
    return BaseCardDetailResponse(
        id=base_card.id,
        set_code=base_card.set.code,
        set_name=base_card.set.name,
        base_card_number=base_card.base_card_number,
        name=base_card.name,
        subtitle=base_card.subtitle,
        type=base_card.type,
        type2=base_card.type2,
        double_sided=base_card.double_sided,
        rarity=base_card.rarity,
        cost=base_card.cost,
        power=base_card.power,
        hp=base_card.hp,
        arena=base_card.arena,
        is_unique=base_card.is_unique,
        front_text=base_card.front_text,
        back_text=base_card.back_text,
        epic_action=base_card.epic_action,
        artist=base_card.artist,
        is_token=base_card.is_token,
        aspects=[a.aspect for a in base_card.aspects],
        keywords=[k.keyword for k in base_card.keywords],
        traits=[t.trait for t in base_card.traits],
        variants=[_to_variant_detail(v, price_rows) for v in base_card.variants],
    )


def get_base_card_detail(
    db: Session, base_card_id: int
) -> BaseCardDetailResponse | None:
    base_card = card_repo.get_base_card_with_variants(db, base_card_id)
    if base_card is None:
        return None
    variant_ids = [v.id for v in base_card.variants]
    price_rows = pricing_repo.get_latest_prices(db, variant_ids)
    return _to_base_card_detail(base_card, price_rows)


def get_base_cards(
    db: Session,
    set_code: str | None = None,
    type: str | None = None,
    rarity: str | None = None,
    pricing: str = "standard",
) -> tuple[list[BaseCardCatalogResponse], PricingEnvelope]:
    """The catalog list: every base card with its nested variant long tail
    (ADR-0005; App Spec §12, Base cards).

    Built from plain Core rows instead of hydrated ORM objects -- the list
    endpoint materializes thousands of base cards and variants per request,
    and ORM hydration at that volume is a large share of its generation
    time. The single-card detail path above keeps the ORM version (one
    card's worth of objects is negligible).

    Catalog shape only (no per-tenant quantity) -- quantities come from
    GET /api/inventory/quantities and are merged client-side, which is what
    lets this endpoint be publicly cached.

    Also returns a PricingEnvelope (list-level source/as_of/unpriced_count
    -- the router ships it as response headers, see
    app.services.pricing.PricingEnvelope.as_headers). `pricing` selects
    each card's display_price aggregate ("standard" or "cheapest"); an
    unrecognized value falls back to "standard" rather than erroring, same
    posture as other tolerant query-param handling in this codebase.

    One un-joined pricing_repo.get_latest_prices(db) call reads every
    priced variant's latest price. Each variant's PriceInfo feeds both the
    card-level display_price aggregate (variant_type_prices below) and the
    per-variant `price` on CardVariantCatalogResponse -- the completion
    panel's Collection value needs per-variant PriceInfo (market + low)
    across the whole catalog to value owned copies with a Standard-price
    fallback, which display_price's one-pick-per-card aggregate can't
    supply (App Spec §5.13, §12)."""
    rows = card_repo.get_base_card_list_rows(
        db, set_code=set_code, type=type, rarity=rarity
    )

    aspects: dict[int, list[str]] = defaultdict(list)
    for base_card_id, aspect in rows.aspect_rows:
        aspects[base_card_id].append(aspect)
    keywords: dict[int, list[str]] = defaultdict(list)
    for base_card_id, keyword in rows.keyword_rows:
        keywords[base_card_id].append(keyword)
    traits: dict[int, list[str]] = defaultdict(list)
    for base_card_id, trait in rows.trait_rows:
        traits[base_card_id].append(trait)

    price_rows = pricing_repo.get_latest_prices(db)
    overall_as_of: date | None = None
    for row in price_rows.values():
        if overall_as_of is None or row.as_of > overall_as_of:
            overall_as_of = row.as_of

    variants: dict[int, list[CardVariantCatalogResponse]] = defaultdict(list)
    variant_type_prices: dict[int, list[VariantTypePrice]] = defaultdict(list)
    for v in rows.variant_rows:
        classification = classify_variant(v.variant_type, v.source_set_code)
        # One PriceInfo per variant, from the single get_latest_prices read
        # above: it goes on the variant's response `price` and into
        # variant_type_prices for the card-level display_price aggregate.
        price_info = to_price_info(price_rows.get(v.id))
        variants[v.base_card_id].append(
            CardVariantCatalogResponse(
                variant_id=v.id,
                variant_type=v.variant_type,
                finish=classification.finish,
                channel=classification.channel,
                source_set_code=v.source_set_code,
                card_number=v.card_number,
                front_image_url=v.front_image_url,
                back_image_url=v.back_image_url,
                price=price_info,
            )
        )
        variant_type_prices[v.base_card_id].append(
            VariantTypePrice(v.variant_type, price_info)
        )

    unpriced_count = 0
    base_cards = []
    for r in rows.base_rows:
        display_price = compute_display_price(
            variant_type_prices.get(r.id, []), pricing
        )
        if display_price is None:
            unpriced_count += 1
        base_cards.append(
            BaseCardCatalogResponse(
                id=r.id,
                set_code=r.set_code,
                base_card_number=r.base_card_number,
                name=r.name,
                subtitle=r.subtitle,
                type=r.type,
                rarity=r.rarity,
                cost=r.cost,
                power=r.power,
                hp=r.hp,
                arena=r.arena,
                is_token=r.is_token,
                aspects=aspects.get(r.id, []),
                keywords=keywords.get(r.id, []),
                traits=traits.get(r.id, []),
                variants=variants.get(r.id, []),
                display_price=display_price,
            )
        )

    envelope = PricingEnvelope(
        source="tcgplayer", as_of=overall_as_of, unpriced_count=unpriced_count
    )
    return base_cards, envelope


VALID_HISTORY_RANGES = frozenset(("30d", "90d", "1y", "all"))


def get_price_history(
    db: Session, base_card_id: int, variant_id: int, range_: str
) -> PriceHistoryResponse | None:
    """None means "no such (base_card_id, variant_id) pairing" -- the
    router turns that into a 404. An empty `series` (variant is real but
    has no priced days, or none in the requested window) is a normal 200,
    not an error -- the price-history chart's own empty state is the
    frontend's job to render, not this endpoint's to fail over."""
    if not pricing_repo.variant_belongs_to_base_card(db, variant_id, base_card_id):
        return None
    rows = pricing_repo.get_price_history(db, variant_id, range_)
    return PriceHistoryResponse(
        variant_id=variant_id,
        range=range_,
        series=[
            PriceHistoryPoint(
                as_of=row.as_of,
                market=float(row.market) if row.market is not None else None,
            )
            for row in rows
        ],
    )
