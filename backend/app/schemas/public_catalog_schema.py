"""GET /api/public/cards -- the card-page generator's input document.

The contract is frontend/src/public/publicCatalog.ts (`PublicCatalog`): the
base-card detail shape WITHOUT the per-tenant `quantity`, so the document is
identical for every caller and safe behind a public CDN cache."""

from datetime import date

from pydantic import BaseModel

from app.schemas.base_card_detail_schema import ImageRenditions, PriceInfo


class PublicVariant(BaseModel):
    """CardVariantDetailResponse minus `quantity`."""

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


class PublicCard(BaseModel):
    """BaseCardDetailResponse with PublicVariant variants (and no
    display_price, which the card pages do not read)."""

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
    variants: list[PublicVariant]


class PublicSet(BaseModel):
    code: str
    name: str
    is_base_set: bool
    release_date: date | None


class PublicCatalogResponse(BaseModel):
    build_sha: str
    sets: list[PublicSet]
    counts: dict[str, int]
    cards: list[PublicCard]
