"""BL-137 D1: pure unit tests for app/services/deck_parse.py. DB-free."""

import pytest

from app.services.deck_parse import InvalidDeckJsonError, parse_deck_json

SWUBASE_FIXTURE = {
    "metadata": {"name": "Han Solo Starter Deck", "author": "silva367"},
    "deck": [
        {"id": "JTL_215", "count": 2},
        {"id": "SHD_095", "count": 3},
    ],
    "sideboard": [],
    "leader": {"id": "JTL_017", "count": 1},
    "base": {"id": "SOR_024", "count": 1},
}

SW_UNLIMITED_DB_FIXTURE = {
    "metadata": {"name": "karabast"},
    "leader": {"id": "SOR_008", "count": 1},
    "base": {"id": "SOR_024", "count": 1},
    "deck": [
        {"unit": "Unit", "id": "SOR_097", "count": 2},
        {"unit": "Event", "id": "SOR_200", "count": 2},
    ],
}


def test_parses_swubase_shape():
    deck = parse_deck_json(SWUBASE_FIXTURE)
    assert deck.name == "Han Solo Starter Deck"
    assert deck.author == "silva367"
    assert deck.leader.id == "JTL_017"
    assert deck.base.id == "SOR_024"
    assert deck.second_leader is None
    assert len(deck.main) == 2
    assert deck.sideboard == []


def test_parses_sw_unlimited_db_shape_ignoring_unknown_keys():
    """The extra per-card "unit" tag is ignored -- Karabast-convention
    tolerant parsing (BL-110 §2a)."""
    deck = parse_deck_json(SW_UNLIMITED_DB_FIXTURE)
    assert deck.name == "karabast"
    assert deck.author is None
    assert deck.leader.id == "SOR_008"
    assert len(deck.main) == 2
    assert deck.main[0].id == "SOR_097"
    assert deck.main[0].count == 2
    assert deck.sideboard == []  # absent entirely -- defaults to empty


def test_parses_secondleader_when_present():
    raw = {**SWUBASE_FIXTURE, "secondleader": {"id": "SOR_087", "count": 1}}
    deck = parse_deck_json(raw)
    assert deck.second_leader is not None
    assert deck.second_leader.id == "SOR_087"


def test_missing_leader_is_invalid():
    raw = {k: v for k, v in SWUBASE_FIXTURE.items() if k != "leader"}
    with pytest.raises(InvalidDeckJsonError, match="leader"):
        parse_deck_json(raw)


def test_missing_base_is_invalid():
    raw = {k: v for k, v in SWUBASE_FIXTURE.items() if k != "base"}
    with pytest.raises(InvalidDeckJsonError, match="base"):
        parse_deck_json(raw)


def test_missing_deck_is_invalid():
    raw = {k: v for k, v in SWUBASE_FIXTURE.items() if k != "deck"}
    with pytest.raises(InvalidDeckJsonError, match="deck"):
        parse_deck_json(raw)


def test_top_level_not_an_object_is_invalid():
    with pytest.raises(InvalidDeckJsonError):
        parse_deck_json(["not", "a", "dict"])


def test_leader_not_an_object_is_invalid():
    raw = {**SWUBASE_FIXTURE, "leader": "JTL_017"}
    with pytest.raises(InvalidDeckJsonError, match="leader"):
        parse_deck_json(raw)


def test_deck_entry_missing_id_is_invalid():
    raw = {**SWUBASE_FIXTURE, "deck": [{"count": 2}]}
    with pytest.raises(InvalidDeckJsonError, match=r"deck\[0\]"):
        parse_deck_json(raw)


def test_zero_count_is_invalid():
    raw = {**SWUBASE_FIXTURE, "leader": {"id": "JTL_017", "count": 0}}
    with pytest.raises(InvalidDeckJsonError, match="count"):
        parse_deck_json(raw)


def test_bool_count_is_invalid():
    """bool is a subclass of int in Python -- {"count": true} must not
    silently parse as count=1."""
    raw = {**SWUBASE_FIXTURE, "leader": {"id": "JTL_017", "count": True}}
    with pytest.raises(InvalidDeckJsonError, match="count"):
        parse_deck_json(raw)


def test_deck_not_a_list_is_invalid():
    raw = {**SWUBASE_FIXTURE, "deck": {"id": "JTL_215", "count": 2}}
    with pytest.raises(InvalidDeckJsonError, match="deck"):
        parse_deck_json(raw)


def test_missing_sideboard_defaults_to_empty_list():
    raw = {k: v for k, v in SWUBASE_FIXTURE.items() if k != "sideboard"}
    deck = parse_deck_json(raw)
    assert deck.sideboard == []


def test_missing_metadata_defaults_to_none_name_author():
    raw = {k: v for k, v in SWUBASE_FIXTURE.items() if k != "metadata"}
    deck = parse_deck_json(raw)
    assert deck.name is None
    assert deck.author is None
