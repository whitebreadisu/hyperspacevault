"""Pure unit tests for deck_check.build_scope_result: pricing, cart lines,
totals and latest_as_of for one scope. DB-free -- inputs are plain
BaseCardRef / VariantTypePrice / MissingEntry values."""

from datetime import date

from app.repositories.deck_check import BaseCardRef
from app.schemas.base_card_detail_schema import PriceInfo
from app.services.deck_check import build_scope_result
from app.services.deck_diff import MissingEntry
from app.services.pricing import VariantTypePrice

OLD = date(2026, 7, 10)
NEW = date(2026, 7, 16)

PRICED, FALLBACK, UNPRICED, SUBTITLED, NO_REF = 1, 2, 3, 4, 5

CARD_REFS = {
    PRICED: BaseCardRef(PRICED, "SOR", "10", "Priced Card", None, "Unit", None),
    FALLBACK: BaseCardRef(FALLBACK, "SOR", "11", "Fallback Card", None, "Unit", None),
    UNPRICED: BaseCardRef(UNPRICED, "JTL", "12", "Unpriced Card", None, "Unit", None),
    SUBTITLED: BaseCardRef(
        SUBTITLED, "LAW", "13", "Han Solo", "Hibernation Sick", "Unit", "img.png"
    ),
}

VARIANT_PRICES = {
    # Standard market 5.0 / low 4.0; Hyperspace market 2.0 / low 1.0.
    PRICED: [
        VariantTypePrice("Standard", PriceInfo(market=5.0, low=4.0, as_of=OLD)),
        VariantTypePrice("Hyperspace", PriceInfo(market=2.0, low=1.0, as_of=OLD)),
    ],
    # Standard unpriced; only Hyperspace priced (standard mode falls back).
    FALLBACK: [
        VariantTypePrice("Standard", None),
        VariantTypePrice("Hyperspace", PriceInfo(market=7.5, low=6.0, as_of=NEW)),
    ],
    UNPRICED: [VariantTypePrice("Standard", None)],
    SUBTITLED: [
        VariantTypePrice("Standard", PriceInfo(market=3.0, low=2.5, as_of=NEW))
    ],
    NO_REF: [VariantTypePrice("Standard", PriceInfo(market=9.0, low=8.0, as_of=NEW))],
}


def _scope(missing, all_entries, mode, buildable=False, card_refs=CARD_REFS):
    return build_scope_result(
        missing,
        all_entries,
        buildable,
        card_refs=card_refs,
        variant_prices=VARIANT_PRICES,
        mode=mode,
    )


MISSING = [
    MissingEntry(PRICED, need=3, have=1),
    MissingEntry(FALLBACK, need=1, have=0),
    MissingEntry(UNPRICED, need=2, have=0),
]
ALL = MISSING + [MissingEntry(SUBTITLED, need=2, have=2)]


def test_standard_mode_totals_unpriced_and_latest_as_of():
    scope, as_of = _scope(MISSING, ALL, "standard")

    assert [m.card.name for m in scope.missing] == [
        "Priced Card",
        "Fallback Card",
        "Unpriced Card",
    ]
    priced, fallback, unpriced = scope.missing
    assert (priced.unit_price, priced.price_basis, priced.subtotal) == (
        5.0,
        "standard",
        10.0,
    )  # 2 missing * 5.0
    assert (fallback.unit_price, fallback.price_basis, fallback.subtotal) == (
        7.5,
        "fallback",
        7.5,
    )
    assert (unpriced.unit_price, unpriced.price_basis, unpriced.subtotal) == (
        None,
        None,
        None,
    )
    assert (priced.need, priced.have) == (3, 1)
    assert scope.missing_total == 17.5
    assert scope.unpriced_count == 1
    assert scope.buildable is False
    assert as_of == NEW  # fallback card's Hyperspace price is the newest


def test_cheapest_mode_uses_min_low_across_printings():
    scope, as_of = _scope(MISSING, ALL, "cheapest")

    priced, fallback, unpriced = scope.missing
    assert (priced.unit_price, priced.price_basis, priced.subtotal) == (
        1.0,
        "cheapest",
        2.0,
    )
    assert (fallback.unit_price, fallback.price_basis, fallback.subtotal) == (
        6.0,
        "cheapest",
        6.0,
    )
    assert unpriced.unit_price is None
    assert scope.missing_total == 8.0
    assert scope.unpriced_count == 1
    assert as_of == NEW


def test_full_card_list_values_at_need_and_counts_unpriced():
    scope, _ = _scope(MISSING, ALL, "standard")

    assert [c.card.name for c in scope.all_cards] == [
        "Priced Card",
        "Fallback Card",
        "Unpriced Card",
        "Han Solo",
    ]
    by_name = {c.card.name: c for c in scope.all_cards}
    assert by_name["Priced Card"].line_value == 15.0  # 3 needed * 5.0
    assert by_name["Fallback Card"].line_value == 7.5
    assert by_name["Unpriced Card"].line_value is None
    # Fully owned card still carries its value.
    assert by_name["Han Solo"].line_value == 6.0
    assert (by_name["Han Solo"].need, by_name["Han Solo"].have) == (2, 2)
    assert scope.deck_value == 28.5
    assert scope.unpriced_value_count == 1


def test_latest_as_of_is_the_newest_priced_date_not_the_last():
    old_only = [MissingEntry(PRICED, need=1, have=0)]
    _, as_of = _scope(old_only, old_only, "standard")
    assert as_of == OLD

    # Newest date first, older after: the maximum wins, not the last seen.
    _, as_of = _scope(
        [MissingEntry(FALLBACK, need=1, have=0), MissingEntry(PRICED, need=1, have=0)],
        [],
        "standard",
    )
    assert as_of == NEW


def test_latest_as_of_can_come_from_the_full_list_alone():
    _, as_of = _scope([], [MissingEntry(SUBTITLED, need=1, have=1)], "standard")
    assert as_of == NEW


def test_unpriced_only_scope_has_no_as_of_and_zero_totals():
    entries = [MissingEntry(UNPRICED, need=2, have=0)]
    scope, as_of = _scope(entries, entries, "standard")
    assert as_of is None
    assert scope.missing_total == 0.0
    assert scope.unpriced_count == 1
    assert scope.deck_value == 0.0
    assert scope.unpriced_value_count == 1
    assert scope.cart_url is not None  # unpriced cards are still purchasable


def test_cart_lines_join_subtitle_and_use_missing_quantity():
    entries = [
        MissingEntry(SUBTITLED, need=3, have=1),
        MissingEntry(PRICED, need=1, have=0),
    ]
    scope, _ = _scope(entries, [], "standard")
    assert scope.cart_url == (
        "https://www.tcgplayer.com/massentry?productline=Star%20Wars%20Unlimited"
        "&c=2+Han+Solo+-+Hibernation+Sick+%5BLAW%5D||1+Priced+Card+%5BSOR%5D||"
    )


def test_empty_scope_has_no_cart_and_zero_totals():
    scope, as_of = _scope([], [], "standard", buildable=True)
    assert scope.buildable is True
    assert scope.missing == []
    assert scope.all_cards == []
    assert scope.cart_url is None
    assert scope.missing_total == 0.0
    assert scope.deck_value == 0.0
    assert (scope.unpriced_count, scope.unpriced_value_count) == (0, 0)
    assert as_of is None


def test_card_without_ref_counts_in_totals_but_has_no_row_or_cart_line():
    entries = [MissingEntry(NO_REF, need=2, have=0)]
    scope, as_of = _scope(entries, entries, "standard")
    assert scope.missing == []
    assert scope.cart_url is None
    assert scope.missing_total == 18.0  # priced, so still summed
    assert as_of == NEW
    # The full list skips a ref-less card entirely.
    assert scope.all_cards == []
    assert scope.deck_value == 0.0
    assert scope.unpriced_value_count == 0


def test_card_with_no_price_rows_is_unpriced():
    refs = {9: BaseCardRef(9, "SOR", "99", "No Rows", None, "Unit", None)}
    entries = [MissingEntry(9, need=1, have=0)]
    scope, as_of = _scope(entries, entries, "standard", card_refs=refs)
    assert scope.unpriced_count == 1
    assert scope.missing[0].unit_price is None
    assert as_of is None


def test_unrecognised_mode_prices_like_standard():
    standard, _ = _scope(MISSING, ALL, "standard")
    other, _ = _scope(MISSING, ALL, "bogus")
    assert other == standard
