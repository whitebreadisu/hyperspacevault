"""BL-136 P4: pure unit tests for app/services/pricing.py's display-price
aggregation (Definition_Pricing_2026-07-16.md §4's decided definitions).
DB-free."""

from datetime import date

from app.schemas.base_card_detail_schema import PriceInfo
from app.services.pricing import (
    LOW_OUTLIER_MULTIPLE,
    PricingEnvelope,
    VariantTypePrice,
    compute_display_price,
    plausible_low,
    to_price_info,
)

TODAY = date(2026, 7, 16)


def test_standard_mode_uses_standard_variant_market():
    prices = [
        VariantTypePrice("Standard", PriceInfo(market=10.0, low=8.0, as_of=TODAY)),
        VariantTypePrice("Hyperspace", PriceInfo(market=25.0, low=20.0, as_of=TODAY)),
    ]
    result = compute_display_price(prices, "standard")
    assert result.value == 10.0
    assert result.as_of == TODAY


def test_cheapest_mode_picks_min_low_regardless_of_printing():
    prices = [
        VariantTypePrice("Standard", PriceInfo(market=10.0, low=8.0, as_of=TODAY)),
        VariantTypePrice("Hyperspace", PriceInfo(market=5.0, low=3.0, as_of=TODAY)),
    ]
    result = compute_display_price(prices, "cheapest")
    assert result.value == 3.0  # Hyperspace's low undercuts Standard's


def test_standard_mode_none_when_standard_variant_unpriced():
    prices = [
        VariantTypePrice("Standard", None),
        VariantTypePrice("Hyperspace", PriceInfo(market=25.0, low=20.0, as_of=TODAY)),
    ]
    assert compute_display_price(prices, "standard") is None


def test_standard_mode_none_when_no_standard_variant_at_all():
    prices = [
        VariantTypePrice("Hyperspace", PriceInfo(market=25.0, low=20.0, as_of=TODAY))
    ]
    assert compute_display_price(prices, "standard") is None


def test_cheapest_mode_none_when_nothing_priced():
    prices = [VariantTypePrice("Standard", None), VariantTypePrice("Hyperspace", None)]
    assert compute_display_price(prices, "cheapest") is None


def test_unrecognized_mode_falls_back_to_standard():
    prices = [
        VariantTypePrice("Standard", PriceInfo(market=10.0, low=8.0, as_of=TODAY))
    ]
    assert compute_display_price(prices, "bogus").value == 10.0


def test_pricing_envelope_headers_shape():
    envelope = PricingEnvelope(source="tcgplayer", as_of=TODAY, unpriced_count=3)
    headers = envelope.as_headers()
    assert headers["X-Pricing-Source"] == "tcgplayer"
    assert headers["X-Pricing-As-Of"] == "2026-07-16"
    assert headers["X-Pricing-Unpriced-Count"] == "3"


def test_pricing_envelope_omits_as_of_header_when_none():
    envelope = PricingEnvelope(source="tcgplayer", as_of=None, unpriced_count=0)
    headers = envelope.as_headers()
    assert "X-Pricing-As-Of" not in headers


# --- BL-276: low-price outlier rule (owner rule 2026-10-25) -----------------
# tcgcsv's lowPrice is the cheapest current listing; one $9,999 troll listing
# (Chopper Base // Shield (Hyperspace), market $0.63) tripled a collection's
# "low" total. A low >= 10x market is replaced by market at the PriceInfo seam.


class _Row:
    def __init__(self, market, low, as_of=TODAY):
        self.market = market
        self.low = low
        self.as_of = as_of


def test_plausible_low_passes_ordinary_low_through():
    assert plausible_low(10.0, 8.0) == 8.0
    # a genuinely thin market (Showcase: cheapest listing above recent sales)
    # is still a real price -- under the multiple, untouched
    assert plausible_low(99.13, 195.0) == 195.0


def test_plausible_low_substitutes_market_at_or_above_the_multiple():
    assert LOW_OUTLIER_MULTIPLE == 10.0
    assert plausible_low(0.63, 9999.0) == 0.63  # the Chopper Base case
    assert plausible_low(1.0, 10.0) == 1.0  # boundary: exactly 10x counts
    assert plausible_low(1.0, 9.99) == 9.99  # just under: real low stands


def test_plausible_low_leaves_low_alone_without_a_positive_market():
    assert plausible_low(None, 9999.0) == 9999.0
    assert plausible_low(0.0, 5.0) == 5.0
    assert plausible_low(10.0, None) is None


def test_to_price_info_applies_the_outlier_rule():
    info = to_price_info(_Row(market=0.63, low=9999.0))
    assert info.market == 0.63
    assert info.low == 0.63
    assert info.as_of == TODAY
    untouched = to_price_info(_Row(market=10.0, low=8.0))
    assert untouched.low == 8.0


def test_cheapest_aggregate_sees_the_corrected_low():
    # the list's cheapest display_price is min(low) over to_price_info output,
    # so the troll listing can no longer win (or lose) the aggregate
    prices = [
        VariantTypePrice("Standard", to_price_info(_Row(market=0.09, low=0.01))),
        VariantTypePrice("Hyperspace", to_price_info(_Row(market=0.63, low=9999.0))),
    ]
    result = compute_display_price(prices, "cheapest")
    assert result.value == 0.01
