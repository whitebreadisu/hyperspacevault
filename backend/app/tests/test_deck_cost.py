"""BL-137 D4: pure unit tests for app/services/deck_cost.py (price mode
math + Mass Entry cart URL generation). DB-free."""

from datetime import date

from app.schemas.base_card_detail_schema import PriceInfo
from app.services.deck_cost import (
    CartLine,
    build_cart_url,
    price_missing_card,
)
from app.services.pricing import VariantTypePrice

TODAY = date(2026, 7, 16)


def test_standard_mode_uses_standard_market_price():
    prices = [
        VariantTypePrice("Standard", PriceInfo(market=10.0, low=8.0, as_of=TODAY)),
        VariantTypePrice("Hyperspace", PriceInfo(market=25.0, low=20.0, as_of=TODAY)),
    ]
    result = price_missing_card(prices, "standard")
    assert result.unit_price == 10.0
    assert result.price_basis == "standard"
    assert result.as_of == TODAY


def test_standard_mode_falls_back_to_lowest_market_when_standard_unpriced():
    """Definition_DeckCheck §5's deck-check-specific fallback: Standard
    printing unpriced, but Hyperspace IS -- falls back to Hyperspace's
    market, flagged 'fallback'. This is deliberately NOT what
    compute_display_price does for the catalog grid (BL-136 P4)."""
    prices = [
        VariantTypePrice("Standard", None),
        VariantTypePrice("Hyperspace", PriceInfo(market=25.0, low=20.0, as_of=TODAY)),
    ]
    result = price_missing_card(prices, "standard")
    assert result.unit_price == 25.0
    assert result.price_basis == "fallback"
    assert result.as_of == TODAY


def test_standard_mode_fallback_picks_lowest_market_among_several():
    prices = [
        VariantTypePrice("Standard", None),
        VariantTypePrice("Hyperspace", PriceInfo(market=25.0, low=20.0, as_of=TODAY)),
        VariantTypePrice("Showcase", PriceInfo(market=15.0, low=12.0, as_of=TODAY)),
    ]
    result = price_missing_card(prices, "standard")
    assert result.unit_price == 15.0
    assert result.price_basis == "fallback"


def test_standard_mode_unpriced_when_nothing_priced_anywhere():
    prices = [VariantTypePrice("Standard", None), VariantTypePrice("Hyperspace", None)]
    result = price_missing_card(prices, "standard")
    assert result.unit_price is None
    assert result.price_basis is None
    assert result.as_of is None


def test_cheapest_mode_picks_min_low_regardless_of_printing():
    prices = [
        VariantTypePrice("Standard", PriceInfo(market=10.0, low=8.0, as_of=TODAY)),
        VariantTypePrice("Hyperspace", PriceInfo(market=5.0, low=3.0, as_of=TODAY)),
    ]
    result = price_missing_card(prices, "cheapest")
    assert result.unit_price == 3.0
    assert result.price_basis == "cheapest"


def test_cheapest_mode_unpriced_when_nothing_priced():
    prices = [VariantTypePrice("Standard", None)]
    result = price_missing_card(prices, "cheapest")
    assert result.unit_price is None
    assert result.price_basis is None


def test_unrecognized_mode_falls_back_to_standard_behavior():
    prices = [
        VariantTypePrice("Standard", PriceInfo(market=10.0, low=8.0, as_of=TODAY))
    ]
    result = price_missing_card(prices, "bogus-mode")
    assert result.unit_price == 10.0
    assert result.price_basis == "standard"


def test_cart_url_empty_list_returns_none():
    assert build_cart_url([]) is None


def test_cart_url_format_matches_spec_and_is_urlencoded():
    """REPLACES the pre-round-2 version of this test, which asserted the
    "||" line separator and spaces were percent-encoded (`%7C%7C`, `%20`).
    Owner dev-review round 2 (2026-07-21) browser-verified that shape made
    every card in the cart get "passed over" by Mass Entry: TCGplayer's
    two independently-verified working real-world examples
    (Spike_TCGplayer_Landscape_2026-07-16.md §3) use a LITERAL, unencoded
    "||" between lines and form-encoding (`+` for space) within each line
    -- the old blanket `quote(c_param, safe="")` over the whole value
    escaped the separator away, collapsing the cart into one unparseable
    blob. This test now asserts the corrected, spec/example-matching
    shape: literal "||" separators, "+" for spaces, and per-segment
    form-encoding for everything else (commas, brackets)."""
    url = build_cart_url(
        [
            CartLine(qty=1, name="Boba Fett, Beast Rider", set_code="SOR"),
            CartLine(
                qty=2, name="Grand Admiral Thrawn, Master Strategist", set_code="SHD"
            ),
        ]
    )
    assert url is not None
    assert url.startswith("https://www.tcgplayer.com/massentry?")
    # The internal product-line *name* ("Star Wars Unlimited"), %20-encoded --
    # NOT the URL slug ("star-wars-unlimited"), which Mass Entry's
    # case-insensitive name match rejects, leaving no product line selected
    # (owner-repro'd 2026-07-21; value verified against
    # mpapi.tcgplayer.com/v2/massentry/productlines).
    assert "productline=Star%20Wars%20Unlimited" in url
    assert "star-wars-unlimited" not in url  # regression guard: slug is wrong
    assert "c=1+Boba+Fett%2C+Beast+Rider+%5BSOR%5D" in url
    assert "||" in url  # the line separator, LITERAL -- not percent-encoded
    assert "%7C%7C" not in url  # regression guard for the round-2 bug
    assert url.endswith("||")  # trailing separator per the spec format


def test_cart_url_single_card():
    url = build_cart_url([CartLine(qty=1, name="Echo Base", set_code="SOR")])
    assert url is not None
    assert "c=1+Echo+Base+%5BSOR%5D||" in url
