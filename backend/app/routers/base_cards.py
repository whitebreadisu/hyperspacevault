from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database import get_catalog_db, get_optional_db
from app.http_cache import catalog_cache, tenant_no_store
from app.schemas.base_card_detail_schema import (
    BaseCardCatalogResponse,
    BaseCardDetailResponse,
    PriceHistoryResponse,
)
from app.services import cards as card_service

# BL-101: cache posture is per-route here, not router-level -- the list
# endpoint is catalog-only (publicly cacheable), while the detail endpoint
# carries per-tenant quantities (never cacheable). Router-level
# tenant_no_store would silently defeat the list's CDN caching; router-level
# catalog_cache would poison the CDN with tenant data. Keep them explicit.
router = APIRouter(prefix="/api/base-cards", tags=["base-cards"])


# NOTE: "" must be registered before "/{base_card_id}" -- mirrors the /lookup
# ordering note in app/routers/cards.py, kept here for the same reason even
# though "" and "/{id}" don't actually collide in FastAPI's router.
# BL-44 Slice A (ADR-0005): payload-shrink list endpoint -- the client fetches
# ~2,306 base cards with nested variants instead of ~8,353 flat variant rows
# from GET /api/cards, eliminating the per-variant duplication of base-card
# fields (name/subtitle/aspects/keywords/traits/cost/...) and the client-side
# grouping step.
@router.get(
    "",
    response_model=list[BaseCardCatalogResponse],
    dependencies=[Depends(catalog_cache)],
)
def list_base_cards(
    response: Response,
    set_code: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    rarity: Optional[str] = Query(None),
    pricing: Literal["standard", "cheapest"] = Query(
        "standard",
        description=(
            "BL-136: selects each base card's display_price aggregate -- "
            "'standard' (default) is the Standard printing's market price, "
            "'cheapest' is min(low) across all priced variants."
        ),
    ),
    db: Session = Depends(get_catalog_db),
):
    """BL-101 catalog/quantity split: this list is catalog data only -- no
    per-tenant quantity -- served from the tenant-less get_catalog_db and
    marked CDN-cacheable (http_cache.catalog_cache), satisfying the
    http_cache invariant *by construction*: the response bytes cannot vary
    by caller identity because nothing tenant-scoped is queried. Clients
    merge quantities from GET /api/inventory/quantities. (Pre-BL-101 this
    endpoint was optional-auth with per-variant quantities and was
    correctly no-store; the detail endpoint below still works that way.)

    Query params mirror GET /api/cards' catalog filters (set_code, type,
    rarity) so the frontend can narrow server-side if useful, though the
    client-side-filtering design (ADR-0005) expects most callers to fetch
    the whole list once and filter in memory. variant_type is intentionally
    not exposed here -- it's a per-variant filter and would defeat the
    point of returning whole base cards with their full variant tail.

    BL-136 P4: every variant carries `price`, every base card carries
    `display_price`. The list-level pricing envelope (source/as_of/
    unpriced_count, Definition_Pricing_2026-07-16.md §4) ships as response
    headers rather than wrapping this endpoint's historically-bare JSON
    array in an object -- see app.services.pricing.PricingEnvelope.
    """
    cards, envelope = card_service.get_base_cards(
        db, set_code=set_code, type=type, rarity=rarity, pricing=pricing
    )
    for header, value in envelope.as_headers().items():
        response.headers[header] = value
    return cards


@router.get(
    "/{base_card_id}",
    response_model=BaseCardDetailResponse,
    dependencies=[Depends(tenant_no_store)],
)
def get_base_card(base_card_id: int, db: Session = Depends(get_optional_db)):
    """Serves both the read-only card-detail popup and the editable
    card-inventory popup (SWU_Catalog_Redesign_Spec.md §5.3): one base card
    plus its full variant long tail, each variant carrying the curated
    finish/channel/stamped classification and the caller's tenant-scoped
    quantity (0 if none). Because of that quantity, this route stays
    private/no-store (RR-3: per-tenant data must never enter a shared
    cache) -- unlike the list route above since BL-101.

    BL-56 / ADR-0008 optional-auth: get_optional_db resolves a real tenant
    (real quantities) when a valid bearer token is present, opens a
    tenant-less session (quantity 0 everywhere, via RLS) when no
    Authorization header is sent, and raises 401 for a present-but-invalid
    token.
    """
    result = card_service.get_base_card_detail(db, base_card_id)
    if result is None:
        raise HTTPException(
            status_code=404, detail=f"Base card {base_card_id} not found"
        )
    return result


@router.get(
    "/{base_card_id}/price-history",
    response_model=PriceHistoryResponse,
    dependencies=[Depends(catalog_cache)],
)
def get_price_history(
    base_card_id: int,
    variant_id: int = Query(...),
    range: Literal["30d", "90d", "1y", "all"] = Query("90d"),
    db: Session = Depends(get_catalog_db),
):
    """BL-136 P4: daily market-price series for one variant of one base
    card (Definition_Pricing_2026-07-16.md §4). Anonymous and catalog-
    cacheable like the list endpoint above -- price history is the same
    for every caller, no tenant data involved. 404s if variant_id isn't
    actually a variant of base_card_id (not just "any variant_id that
    happens to exist anywhere")."""
    result = card_service.get_price_history(db, base_card_id, variant_id, range)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Variant {variant_id} not found on base card {base_card_id}",
        )
    return result
