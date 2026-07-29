from datetime import date

from pydantic import BaseModel


class PriceInfo(BaseModel):
    """BL-136 P4: one variant's current price
    (Definition_Pricing_2026-07-16.md §4). Present (non-null on the parent
    field) only when `tcgplayer_products` has a mapping for this variant
    AND at least one `variant_prices` row exists for it -- an unpriced
    variant (unmapped, or mapped but never synced) carries `price: null`
    on the parent, not a PriceInfo with every field null. market/low
    individually stay nullable even when the row exists: tcgcsv
    occasionally omits a tier for a given day (decided policy: the price
    still ships with its as_of, never blanks the whole thing)."""

    market: float | None
    low: float | None
    as_of: date


class DisplayPrice(BaseModel):
    """BL-136 P4: the one-price-per-card aggregate GET /api/base-cards
    computes per the `pricing` query param (`standard` -- default -- or
    `cheapest`), per Definition_Pricing_2026-07-16.md §4's decided
    definitions. `standard` = the card's Standard-printing variant's
    market price; `cheapest` = min(low) across all of the card's priced
    variants, any printing. Null when the card has no priced variant at
    all under the selected mode."""

    value: float | None
    as_of: date | None


class ImageRenditions(BaseModel):
    """The 3 same-origin serving URLs for one side of a variant (BL-76
    Phase 3, ADR-0012) -- derived at read time from the corresponding
    `front_image_url`/`back_image_url` via
    app.services.image_paths.same_origin_renditions, never stored."""

    original: str
    w640: str
    w320: str


class CardVariantCatalogResponse(BaseModel):
    """One printing of a base card, SLIM catalog fields only (BL-101, slimmed
    further by BL-146) -- the shape GET /api/base-cards (list) nests. Carries
    no per-tenant data by construction, which is what makes the list endpoint
    eligible for http_cache.catalog_cache. finish/channel are the same
    curated classification CardResponse exposes -- derived from variant_type
    + source_set_code via app.ingestion.swuapi_classify, not stored columns.

    BL-146 (Design_SparseList_2026-07-25.md §2/§5, issue #368): this list
    row dropped `stamped`, `source_set_name`, `stamp_group`, `price`,
    `front_images`, `back_images` -- a census of every frontend list
    consumer (filters/sort/table/gallery/Add Cards resolver) found zero
    reads of any of them; `front_images`/`back_images` specifically are now
    derived client-side from `front_image_url`/`back_image_url`
    (frontend/src/utils/cardImages.ts's deriveRenditions, a line-for-line
    port of app.services.image_paths.same_origin_renditions) instead of
    server-constructed, cutting ~18k nested ImageRenditions Pydantic
    constructions per request. `stamped`/`source_set_name`/`stamp_group`/
    `front_images`/`back_images` are still list-absent -- every one still
    ships on CardVariantDetailResponse below.

    BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): `price` is back,
    additive/optional (`= None`) so a stale pre-this-change cached list
    response still validates. The Collection-value completion-panel needs
    every owned variant's own market/low price across the WHOLE catalog to
    compute per-variant value with a Standard-price fallback -- data the
    list endpoint's per-card `display_price` aggregate can't supply (one
    picked price per card, not the full per-variant PriceInfo). The
    service already computed this exact PriceInfo per variant on every
    list request even after BL-146 dropped the field from the response
    (see get_base_cards' docstring) -- re-attaching it here is a
    response-shape change only, no new query."""

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
    """Catalog variant (full field set, pre-BL-146 shape -- see
    CardVariantCatalogResponse's docstring) plus the caller's tenant-scoped
    quantity -- the shape GET /api/base-cards/{id} (detail; card detail /
    card-inventory popups, SWU_Catalog_Redesign_Spec.md §5.3) nests. Because
    quantity is per-tenant, any route returning this shape must stay
    private/no-store (http_cache.tenant_no_store).

    BL-146: re-declares every field directly instead of extending
    CardVariantCatalogResponse (which no longer carries all of them) -- pure
    schema restructuring, the detail response's actual JSON shape is
    unchanged."""

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
    only -- the GET /api/base-cards (list) row shape since BL-101 split
    per-tenant quantities out to GET /api/inventory/quantities.

    `display_price` (BL-136 P4, additive) is the one-price-per-card
    aggregate for list/gallery rendering, computed per the `?pricing=
    standard|cheapest` query param (default standard) -- see
    schemas.base_card_detail_schema.DisplayPrice. Kept on the list despite
    being additive/unused-by-any-UI-today (BL-141's list/gallery price
    display is designed against it already) -- BL-146's sparse-list split
    (Design_SparseList_2026-07-25.md §2/§8-Q2) explicitly decided this field
    stays while the per-variant `price` field below moves to detail-only.

    BL-146: `set_name`, `type2`, `double_sided`, `is_unique`, `front_text`,
    `back_text`, `epic_action`, `artist` dropped -- zero list-consumer reads
    (CardPopup, the only reader, is a detail-only fetch). Still served on
    BaseCardDetailResponse below, unchanged."""

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
    GET /api/base-cards/{id} detail shape (full pre-BL-146 field set, variant
    tail using CardVariantDetailResponse).

    BL-146: re-declares every field directly instead of extending
    BaseCardCatalogResponse (which no longer carries all of them) -- pure
    schema restructuring, the detail response's actual JSON shape is
    unchanged."""

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
    price series for one variant (Definition_Pricing_2026-07-16.md §4).
    Anonymous, catalog data (no per-tenant variance), so this route is
    publicly cacheable like the list endpoint."""

    variant_id: int
    range: str
    series: list[PriceHistoryPoint]
