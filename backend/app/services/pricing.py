"""BL-136 P4: pure pricing computation -- turns raw latest-price rows
(app.repositories.pricing) into the API's PriceInfo/DisplayPrice shapes.
Definition_Pricing_2026-07-16.md §4's decided cheapest definition:
min(low) across ALL of a card's priced variants, any printing; standard
mode is the Standard-printing variant's market price. Kept DB-free (a
plain Row -> pydantic mapper plus a list-of-tuples aggregator) so it's
unit-testable without a database, mirroring this codebase's service-layer
split elsewhere (e.g. app.ingestion.swuapi_transform)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import NamedTuple

from sqlalchemy import Row

from app.schemas.base_card_detail_schema import DisplayPrice, PriceInfo

PRICING_SOURCE = "tcgplayer"
STANDARD_VARIANT_TYPE = "Standard"

# BL-276: tcgcsv's lowPrice is the literal cheapest CURRENT listing, so a
# single implausible listing (a $9,999 "Chopper Base // Shield (Hyperspace)"
# against a $0.63 market, 2026-10-25) inflates every "low" total that
# includes the card -- the owner's collection read 3x its market value.
# Owner rule (2026-10-25): a low at or above this multiple of market is not
# a price, and market stands in for it. Applied here, at the one Row ->
# PriceInfo seam every price consumer shares (catalog list/detail, deck
# check, the cheapest aggregate), so stored history stays raw and the
# threshold is tunable without a backfill.
LOW_OUTLIER_MULTIPLE = 10.0


def plausible_low(market: float | None, low: float | None) -> float | None:
    """BL-276: `low`, or `market` when `low` >= LOW_OUTLIER_MULTIPLE x market.
    Needs a positive market to judge against -- with market None (or 0) the
    low ships untouched, since there is nothing credible to compare it to."""
    if low is None or market is None or market <= 0:
        return low
    if low >= market * LOW_OUTLIER_MULTIPLE:
        return market
    return low


def to_price_info(row: Row | None) -> PriceInfo | None:
    if row is None:
        return None
    market = float(row.market) if row.market is not None else None
    low = float(row.low) if row.low is not None else None
    return PriceInfo(market=market, low=plausible_low(market, low), as_of=row.as_of)


class VariantTypePrice(NamedTuple):
    variant_type: str
    price: PriceInfo | None


def compute_display_price(
    variant_prices: list[VariantTypePrice], mode: str
) -> DisplayPrice | None:
    """mode="cheapest": min(low) across every priced variant, any tier.
    mode="standard" (default/fallback for any unrecognized value): the
    Standard-printing variant's market price, or None if that variant has
    no price (a card whose only priced variant happens to be, say,
    Hyperspace still shows no standard display_price -- 'standard' means
    the Standard printing specifically, per the decided definition, not
    'whatever's available')."""
    if mode == "cheapest":
        candidates = [
            (vtp.price.low, vtp.price.as_of)
            for vtp in variant_prices
            if vtp.price is not None and vtp.price.low is not None
        ]
        if not candidates:
            return None
        low, as_of = min(candidates, key=lambda c: c[0])
        return DisplayPrice(value=low, as_of=as_of)

    for vtp in variant_prices:
        if vtp.variant_type == STANDARD_VARIANT_TYPE and vtp.price is not None:
            if vtp.price.market is None:
                return None
            return DisplayPrice(value=vtp.price.market, as_of=vtp.price.as_of)
    return None


@dataclass
class PricingEnvelope:
    source: str
    as_of: date | None
    unpriced_count: int

    def as_headers(self) -> dict[str, str]:
        """List-level pricing envelope, shipped as response headers rather
        than an extra key on the response body -- GET /api/base-cards
        returns a bare JSON array today (BL-44/BL-101), and the live
        frontend (not touched in this arc; P5/UI wiring is separate,
        unbuilt) depends on that array shape. Wrapping it in an envelope
        object now would be a breaking change with nothing yet consuming
        the wrapper. Headers carry the same three fields additively."""
        headers = {
            "X-Pricing-Source": self.source,
            "X-Pricing-Unpriced-Count": str(self.unpriced_count),
        }
        if self.as_of is not None:
            headers["X-Pricing-As-Of"] = self.as_of.isoformat()
        return headers
