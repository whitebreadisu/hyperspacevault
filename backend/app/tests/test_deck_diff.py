"""BL-137 D3: pure unit tests for the three-scope diff engine
(app/services/deck_diff.py). DB-free -- the named sideboard-subtraction
acceptance case lives here as a plain function call."""

from app.services.deck_diff import diff_scopes, full_entries, remaining_after_main

CARD_X = 101
CARD_Y = 202


def test_named_sideboard_subtraction_case():
    """Definition_DeckCheck_2026-07-16.md §4's required acceptance case:
    deck runs 2 main + 1 side of card X, user owns 2 -> main buildable,
    side NOT (missing 1), together NOT."""
    main_diff, side_diff, together_diff = diff_scopes(
        main_needs={CARD_X: 2}, side_needs={CARD_X: 1}, owned={CARD_X: 2}
    )
    assert main_diff.buildable is True
    assert main_diff.missing == []

    assert side_diff.buildable is False
    assert len(side_diff.missing) == 1
    assert side_diff.missing[0].base_card_id == CARD_X
    assert side_diff.missing[0].need == 1
    assert side_diff.missing[0].have == 0

    assert together_diff.buildable is False
    assert together_diff.missing == side_diff.missing


def test_fully_buildable_both_scopes():
    main_diff, side_diff, together_diff = diff_scopes(
        main_needs={CARD_X: 3}, side_needs={CARD_X: 1}, owned={CARD_X: 4}
    )
    assert main_diff.buildable is True
    assert side_diff.buildable is True
    assert together_diff.buildable is True
    assert together_diff.missing == []


def test_main_missing_reserves_full_need_from_side_even_when_unmet():
    """A card missing from main doesn't free up phantom copies for side --
    remaining_owned subtracts the full main NEED, not the (capped) main
    HAVE."""
    main_diff, side_diff, together_diff = diff_scopes(
        main_needs={CARD_X: 3}, side_needs={CARD_X: 1}, owned={CARD_X: 1}
    )
    assert main_diff.buildable is False
    assert main_diff.missing[0].have == 1
    assert main_diff.missing[0].need == 3
    # remaining_owned = max(1 - 3, 0) = 0
    assert side_diff.buildable is False
    assert side_diff.missing[0].have == 0
    assert side_diff.missing[0].need == 1


def test_card_absent_from_owned_dict_treated_as_zero():
    main_diff, side_diff, together_diff = diff_scopes(
        main_needs={CARD_X: 1}, side_needs={}, owned={}
    )
    assert main_diff.buildable is False
    assert main_diff.missing[0].have == 0


def test_multiple_cards_independent():
    main_diff, side_diff, together_diff = diff_scopes(
        main_needs={CARD_X: 2, CARD_Y: 3},
        side_needs={CARD_Y: 1},
        owned={CARD_X: 2, CARD_Y: 4},
    )
    assert main_diff.buildable is True
    # side: remaining_owned[Y] = max(4-3,0) = 1, need 1 -> buildable
    assert side_diff.buildable is True
    assert together_diff.buildable is True


def test_empty_needs_are_trivially_buildable():
    main_diff, side_diff, together_diff = diff_scopes(
        main_needs={}, side_needs={}, owned={}
    )
    assert main_diff.buildable is True
    assert side_diff.buildable is True
    assert together_diff.buildable is True


# --- BL-142: full_entries / remaining_after_main (ALL CARDS toggle) -------


def test_full_entries_includes_fully_owned_and_missing_rows():
    """Unlike _diff_against, full_entries must return a row for EVERY card
    in the needs pool -- fully-owned cards included -- since the ALL CARDS
    toggle needs the complete deck list, not just what's missing."""
    entries = full_entries(needs={CARD_X: 2, CARD_Y: 3}, owned={CARD_X: 2, CARD_Y: 1})
    by_id = {e.base_card_id: e for e in entries}
    assert len(entries) == 2
    assert by_id[CARD_X].need == 2 and by_id[CARD_X].have == 2  # fully owned
    assert by_id[CARD_Y].need == 3 and by_id[CARD_Y].have == 1  # missing 2


def test_full_entries_card_absent_from_owned_is_zero_have():
    entries = full_entries(needs={CARD_X: 1}, owned={})
    assert len(entries) == 1
    assert entries[0].base_card_id == CARD_X
    assert entries[0].need == 1
    assert entries[0].have == 0


def test_full_entries_side_scope_uses_remaining_after_main_baseline():
    """The full list's side-scope 'have' must agree with diff_scopes'
    sequential math -- built from remaining_after_main, not raw owned."""
    main_needs = {CARD_X: 2}
    side_needs = {CARD_X: 1}
    owned = {CARD_X: 2}
    remaining = remaining_after_main(main_needs, owned)
    side_all = full_entries(side_needs, remaining)
    assert len(side_all) == 1
    assert side_all[0].need == 1
    assert side_all[0].have == 0  # matches the named acceptance case exactly

    _, side_diff, _ = diff_scopes(main_needs, side_needs, owned)
    assert side_all[0].have == side_diff.missing[0].have


def test_remaining_after_main_floors_at_zero():
    assert remaining_after_main({CARD_X: 5}, {CARD_X: 3}) == {CARD_X: 0}
    assert remaining_after_main({}, {CARD_X: 4}) == {CARD_X: 4}
    assert remaining_after_main({CARD_X: 1}, {}) == {}
