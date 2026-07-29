"""BL-136 P4: pure unit tests for app/services/pricing.py's display-price
aggregation (Definition_Pricing_2026-07-16.md §4's decided definitions).
DB-free."""

from datetime import date

from app.schemas.base_card_detail_schema import PriceInfo
from app.services.pricing import (
    PricingEnvelope,
    VariantTypePrice,
    compute_display_price,
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
