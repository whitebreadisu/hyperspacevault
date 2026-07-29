"""Pure transform tests (app/ingestion/swuapi_transform.py) against the
synthetic fixture (BL-170 slice C) -- DB-free, behavioral coverage only.

Split from the original real-data-backed file per
specification_documents/analysis/RepoPublic_CI_ForkSafety_2026-07-26.md's
"Fixture strategy proposal": behavioral tests (base_card anchoring,
fallback re-anchoring, is_token/is_base_set, Serialized Prestige keying)
port to the synthetic fixture below; census-flavored tests (exact
real-world counts, Zam Wesell specifics, frozen census comparisons,
exceptions-doc rendering against real data) moved to
test_swuapi_realdata_census.py, gated on the real export being present.

Disposition of every test that was in this file before the split:
  - test_base_card_count_after_fallback_reanchoring        -> moved (census)
  - test_card_variant_count_equals_total_cards              -> moved (census)
  - test_zam_wesell_is_the_sole_exception                   -> moved (census)
  - test_token_root_with_non_standard_variant_type_is_exempt_from_fallback
    -> ported as test_token_root_is_exempt_from_fallback (GG_5 analog)
  - test_non_token_non_standard_roots_are_reanchored_to_their_standard_match
    -> ported as test_non_token_non_standard_root_reanchors_to_standard_match
  - test_reanchored_siblings_collapse_into_the_same_base_card
    -> ported unchanged in spirit (synthetic uuids)
  - test_is_token_matches_the_frozen_census                 -> moved (census)
  - test_is_base_set_matches_the_curated_ten
    -> ported (adapted) as test_is_base_set_matches_the_fixtures_base_sets
  - test_serialized_prestige_collision_retained_as_distinct_variants
    -> ported unchanged in spirit
  - test_identical_image_collisions_are_flagged             -> moved (census)
  - test_card_variants_keyed_on_swuapi_id_not_base_card_and_variant_type
    -> ported unchanged in spirit
  - test_ambiguous_fallback_raises_instead_of_guessing       -> unchanged
    (already synthetic)
  - test_render_exceptions_doc_with_zam_only                -> moved (census)
  - test_render_exceptions_doc_with_no_exceptions            -> unchanged
    (already synthetic)
"""

from collections import Counter

import pytest

from app.ingestion.swuapi_transform import (
    BASE_SET_CODES,
    AmbiguousFallbackError,
    render_exceptions_doc,
    transform,
)
from app.tests.fixtures.synthetic_export import (
    BASE_SET_CODES_IN_FIXTURE,
    EXPECTED_BASE_CARDS,
    EXPECTED_EXCEPTION_COUNT,
    EXPECTED_TOKEN_BASE_CARDS,
    EXPECTED_TOTAL_CARDS,
    build_synthetic_export,
)


@pytest.fixture(scope="module")
def export():
    return build_synthetic_export()


@pytest.fixture(scope="module")
def result(export):
    return transform(export)


def test_fixture_shape_sanity(export, result):
    """Guard rail for the fixture itself, so a future edit that breaks the
    hand-derived counts fails loudly here instead of surfacing as a
    confusing failure in one of the scenario tests below."""
    assert len(export["cards"]) == EXPECTED_TOTAL_CARDS
    assert len(result.card_variants) == EXPECTED_TOTAL_CARDS
    assert len(result.base_cards) == EXPECTED_BASE_CARDS
    assert len(result.exceptions) == EXPECTED_EXCEPTION_COUNT
    assert (
        sum(1 for bc in result.base_cards if bc["is_token"])
        == EXPECTED_TOKEN_BASE_CARDS
    )


def test_token_root_is_exempt_from_fallback(result):
    """GG_5 analog "Test Token Multi" matches 2 Standard roots (SOR_70,
    JTL_70 -- a duplicate-per-set token) but must stay its own base_card,
    not be flagged as an exception or force-matched (mapping spec §3.4)."""
    gg5_uuid = next(
        bc["swuapi_id"]
        for bc in result.base_cards
        if bc["set_code"] == "GG" and bc["base_card_number"] == "5"
    )
    base_card = next(bc for bc in result.base_cards if bc["swuapi_id"] == gg5_uuid)
    assert base_card["is_token"] is True
    assert base_card["name"] == "Test Token Multi"
    assert not any(exc["name"] == "Test Token Multi" for exc in result.exceptions)


def test_non_token_non_standard_root_reanchors_to_standard_match(result):
    """C25_2 analog "Test Reanchor Target" (Convention Exclusive root)
    re-anchors to the JTL_60 Standard base card rather than staying its own
    (mapping spec §6)."""
    variant = next(
        cv
        for cv in result.card_variants
        if cv["source_set_code"] == "C25" and cv["card_number"] == "2"
    )
    base_card = next(
        bc
        for bc in result.base_cards
        if bc["swuapi_id"] == variant["base_card_swuapi_id"]
    )
    assert base_card["set_code"] == "JTL"
    assert base_card["base_card_number"] == "60"
    assert base_card["name"] == "Test Reanchor Target"


def test_reanchored_siblings_collapse_into_the_same_base_card(result):
    """C25_2 and JTLP_10 analogs are two independent non-Standard "Test
    Reanchor Target" roots that both fallback-match the same JTL_60
    Standard root -- they must collapse into one base_card, not two."""
    c25_2 = next(
        cv
        for cv in result.card_variants
        if cv["source_set_code"] == "C25" and cv["card_number"] == "2"
    )
    jtlp_10 = next(
        cv
        for cv in result.card_variants
        if cv["source_set_code"] == "JTLP" and cv["card_number"] == "10"
    )
    assert c25_2["base_card_swuapi_id"] == jtlp_10["base_card_swuapi_id"]


def test_is_base_set_matches_the_fixtures_base_sets(result):
    """Adapted from the real-data "curated ten" census test: with only 6
    sets in the fixture, assert the mechanism (BASE_SET_CODES membership
    drives is_base_set) rather than the full real-world count of 10."""
    base_sets = {s["code"] for s in result.sets if s["is_base_set"]}
    assert base_sets == BASE_SET_CODES_IN_FIXTURE
    assert base_sets <= BASE_SET_CODES
    non_base_sets = {s["code"] for s in result.sets if not s["is_base_set"]}
    assert non_base_sets.isdisjoint(BASE_SET_CODES)


def test_serialized_prestige_collision_retained_as_distinct_variants(result):
    """Scenario F / §10.8 analog: the SOR_180 Serialized Prestige triple
    keeps all 3 finish rows distinct, keyed by swuapi_id, not collapsed."""
    prestige_variants = [
        cv
        for cv in result.card_variants
        if cv["source_set_code"] == "SOR"
        and cv["card_number"] == "180"
        and cv["variant_type"] == "Serialized Prestige"
    ]
    assert len(prestige_variants) == 3
    swuapi_ids = {cv["swuapi_id"] for cv in prestige_variants}
    assert len(swuapi_ids) == len(prestige_variants)


def test_card_variants_keyed_on_swuapi_id_not_base_card_and_variant_type(result):
    """§4.3/§10.8: (base_card_id, variant_type) must not be unique -- the
    SOR_180 Serialized Prestige triple all share one such tuple."""
    keys = [
        (cv["base_card_swuapi_id"], cv["variant_type"]) for cv in result.card_variants
    ]
    assert len(keys) != len(set(keys))
    counts = Counter(keys)
    assert any(count >= 3 for count in counts.values())


def test_ambiguous_fallback_raises_instead_of_guessing():
    """If a future card's fallback ever returns >1 non-token Standard
    match, ingestion must stop rather than pick one (mapping spec §6)."""
    export = {
        "sets": [{"code": "XX1", "name": "Test Set"}],
        "cards": [
            {
                "uuid": "root-1",
                "name": "Ambiguous Card",
                "subtitle": "Sub",
                "type": "Unit",
                "rarity": "Common",
                "set_code": "XX1",
                "card_number": "1",
                "variant_type": "Convention Exclusive",
                "variant_of_uuid": None,
            },
            {
                "uuid": "standard-a",
                "name": "Ambiguous Card",
                "subtitle": "Sub",
                "type": "Unit",
                "rarity": "Common",
                "set_code": "XX1",
                "card_number": "2",
                "variant_type": "Standard",
                "variant_of_uuid": None,
            },
            {
                "uuid": "standard-b",
                "name": "Ambiguous Card",
                "subtitle": "Sub",
                "type": "Unit",
                "rarity": "Common",
                "set_code": "XX1",
                "card_number": "3",
                "variant_type": "Standard",
                "variant_of_uuid": None,
            },
        ],
    }
    with pytest.raises(AmbiguousFallbackError):
        transform(export)


def test_render_exceptions_doc_with_no_exceptions():
    doc = render_exceptions_doc([])
    assert "## Current exceptions (0)" in doc
    assert "None" in doc
