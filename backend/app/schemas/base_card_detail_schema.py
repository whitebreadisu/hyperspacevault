from datetime import date

from pydantic import BaseModel


class PriceInfo(BaseModel):
    """One variant's current price (App Spec §16.2). Present (non-null on
    the parent field) only when `tcgplayer_products` has a mapping for this
    variant AND a `variant_latest_prices` row exists for it -- an unpriced
    variant (unmapped, or mapped but never synced) carries `price: null`
    on the parent, not a PriceInfo with every field null. market/low
    individually stay nullable even when the row exists: tcgcsv
    occasionally omits a tier for a given day (policy: the price still
    ships with its as_of, never blanks the whole thing). `low` is the
    served low after the outlier rule (app/services/pricing.py's
    plausible_low, App Spec §16.4)."""

    market: float | None
    low: float | None
    as_of: date


class DisplayPrice(BaseModel):
    """The one-price-per-card aggregate GET /api/base-cards computes per
    the `pricing` query param (`standard` -- default -- or `cheapest`), per
    App Spec §16.4's definitions. `standard` = the card's Standard-printing variant's
    market price; `cheapest` = min(low) across all of the card's priced
    variants, any printing. Null when the card has no priced variant at
    all under the selected mode."""

    value: float | None
    as_of: date | None


class ImageRenditions(BaseModel):
    """The 3 same-origin serving URLs for one side of a variant
    (ADR-0012) -- derived at read time from the corresponding
    `front_image_url`/`back_image_url` via
    app.services.image_paths.same_origin_renditions, never stored."""

    original: str
    w640: str
    w320: str


class CardVariantCatalogResponse(BaseModel):
    """One printing of a base card, SLIM catalog fields only -- the shape
    GET /api/base-cards (list) nests (App Spec §12: the list ships no
    front_images/back_images). Carries no per-tenant data by construction,
    which is what makes the list endpoint eligible for
    http_cache.catalog_cache. finish/channel are the same curated
    classification CardVariantDetailResponse exposes -- derived from
    variant_type + source_set_code via app.ingestion.swuapi_classify, not
    stored columns.

    `stamped`, `source_set_name`, `stamp_group`, `front_images` and
    `back_images` are list-absent: no frontend list consumer
    (filters/sort/table/gallery/Add Cards resolver) reads them, and every
    one ships on CardVariantDetailResponse below. `front_images`/
    `back_images` are derived client-side from `front_image_url`/
    `back_image_url` (frontend/src/utils/cardImages.ts's deriveRenditions,
    a line-for-line port of app.services.image_paths.same_origin_renditions)
    instead of server-constructed, saving ~18k nested ImageRenditions
    Pydantic constructions per request.

    `price` (optional, `= None`) is on the list because the Collection-value
    completion panel needs every owned variant's own market/low price
    across the WHOLE catalog to compute per-variant value with a
    Standard-price fallback -- data the list endpoint's per-card
    `display_price` aggregate can't supply (one picked price per card, not
    the full per-variant PriceInfo). The service computes this PriceInfo
    per variant on every list request anyway (see get_base_cards'
    docstring), so carrying it costs no extra query."""

    variant_id: int
    variant_type: str
    finish: str | None
    channel: str
    source_set_code: str
    card_number: str
    front_image_url: str | None
    back_image_url: str | None
    price: PriceInfo | None = None


class CardVariantDetailResponse(BaseModel):
    """Catalog variant (full field set -- see CardVariantCatalogResponse's
    docstring for what the list omits) plus the caller's tenant-scoped
    quantity -- the shape GET /api/base-cards/{id} (detail; card detail /
    card-inventory popups, App Spec §5.3) nests. Because quantity is
    per-tenant, any route returning this shape must stay private/no-store
    (http_cache.tenant_no_store).

    Re-declares every field directly instead of extending
    CardVariantCatalogResponse, which does not carry all of them."""

    variant_id: int
    variant_type: str
    finish: str | None
    channel: str
    stamped: bool
    source_set_code: str
    source_set_name: str
    card_number: str
    front_image_url: str | None
    back_image_url: str | None
    front_images: ImageRenditions | None = None
    back_images: ImageRenditions | None = None
    stamp_group: str | None
    price: PriceInfo | None = None
    quantity: int


class BaseCardCatalogResponse(BaseModel):
    """One base card with its nested variant long tail, SLIM catalog fields
    only -- the GET /api/base-cards (list) row shape. Per-tenant
    quantities are not here; they come from GET /api/inventory/quantities,
    merged client-side (App Spec §12).

    `display_price` is the one-price-per-card aggregate for list/gallery
    rendering, computed per the `?pricing=standard|cheapest` query param
    (default standard) -- see DisplayPrice above. It stays on the list as
    the per-card price contract even though no frontend view reads it
    (frontend/src/api/baseCards.ts declares it); per-variant prices ride on
    each variant's `price`.

    `set_name`, `type2`, `double_sided`, `is_unique`, `front_text`,
    `back_text`, `epic_action` and `artist` are list-absent -- no list
    consumer reads them (CardPopup, the only reader, is a detail-only
    fetch). They are served on BaseCardDetailResponse below."""

    id: int
    set_code: str
    base_card_number: str
    name: str
    subtitle: str | None
    type: str
    rarity: str
    cost: int | None
    power: int | None
    hp: int | None
    arena: str | None
    is_token: bool
    aspects: list[str]
    keywords: list[str]
    traits: list[str]
    variants: list[CardVariantCatalogResponse]
    display_price: DisplayPrice | None = None


class BaseCardDetailResponse(BaseModel):
    """Base card whose variants carry the caller's quantities -- the
    GET /api/base-cards/{id} detail shape (full field set, variant tail
    using CardVariantDetailResponse).

    Re-declares every field directly instead of extending
    BaseCardCatalogResponse, which does not carry all of them."""

    id: int
    set_code: str
    set_name: str
    base_card_number: str
    name: str
    subtitle: str | None
    type: str
    type2: str | None
    double_sided: bool
    rarity: str
    cost: int | None
    power: int | None
    hp: int | None
    arena: str | None
    is_unique: bool | None
    front_text: str | None
    back_text: str | None
    epic_action: str | None
    artist: str | None
    is_token: bool
    aspects: list[str]
    keywords: list[str]
    traits: list[str]
    variants: list[CardVariantDetailResponse]
    display_price: DisplayPrice | None = None


class PriceHistoryPoint(BaseModel):
    as_of: date
    market: float | None


class PriceHistoryResponse(BaseModel):
    """GET /api/base-cards/{base_card_id}/price-history -- daily market-
    price series for one variant (App Spec §5.10, §16.2).
    Anonymous, catalog data (no per-tenant variance), so this route is
    publicly cacheable like the list endpoint."""

    variant_id: int
    range: str
    series: list[PriceHistoryPoint]
