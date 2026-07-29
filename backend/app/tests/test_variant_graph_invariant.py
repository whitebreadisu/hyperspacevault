"""variant_of_uuid graph-invariant test (BL-34 / mapping spec §8).

Pure-Python, DB-free: validates the structural assumption the entire
base_cards/card_variants schema (BL-33) rests on, against a captured live
swuapi export — not against our own (not-yet-built) tables.

Fixture: app/tests/fixtures/swuapi_export_2026-06-21.json, captured via
paginated /cards (offset-based; the cursor-based pagination documented in
the backlog silently truncates past ~3,857 records and must not be used for
bulk capture) plus /export/all for sets/meta. 8,353 cards, 27 sets.

Written test-first, before the base_cards/card_variants migration exists,
per SWU_Catalog_Redesign_Spec.md §8.4.
"""

import json
import os
from pathlib import Path

import pytest

FIXTURE_PATH = Path(
    os.environ.get(
        "SWUAPI_FIXTURE_PATH",
        str(
            Path(__file__).parent.parent
            / "ingestion"
            / "data"
            / "swuapi_export_2026-06-21.json"
        ),
    )
)

# BL-170 slice C: this file is real-data census/contract coverage in full
# (see specification_documents/analysis/RepoPublic_CI_ForkSafety_2026-07-26.md
# "Fixture strategy proposal") -- skip cleanly when the real export isn't on
# disk (e.g. after the export moves to the private GCS bucket) rather than
# erroring; run `pytest -m realdata` after fetching the fixture per the
# content runbook.
pytestmark = [
    pytest.mark.realdata,
    pytest.mark.skipif(
        not FIXTURE_PATH.exists(),
        reason=(
            f"real swuapi export fixture not present at {FIXTURE_PATH} -- "
            "set SWUAPI_FIXTURE_PATH or fetch the frozen 2026-06-21 capture "
            "per the content runbook to run this tier"
        ),
    ),
]

MAX_HOPS = 2  # confirmed depth in the captured export — see mapping spec §3/§5I

# Mirrors specification_documents/swuapi_standard_variant_exceptions.md as of
# the 2026-06-21 full census. The backend container doesn't mount
# specification_documents/, so this list is duplicated here rather than
# parsed at test time; keep both in sync until BL-29's ingestion script
# regenerates the doc from a live run (at which point this becomes a query
# against the catalog instead of a hardcoded list).
EXCEPTION_KEYS = {
    ("C25", "2"),
    ("C25", "3"),
    ("C26", "3"),
    ("GG", "1"),
    ("GG", "2"),
    ("GG", "3"),
    ("GG", "4"),
    ("GG", "5"),
    ("J25", "4"),
    ("J25", "6"),
    ("JTLP", "10"),
    ("JTLP", "16"),
    ("JTLP", "4"),
    ("LOFP", "4"),
    ("MV26", "1"),
}


@pytest.fixture(scope="module")
def export():
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def cards(export):
    return export["cards"]


@pytest.fixture(scope="module")
def by_uuid(cards):
    return {c["uuid"]: c for c in cards}


def _resolve_root(card, by_uuid, max_hops=MAX_HOPS):
    """Walk variant_of_uuid until a root is found. Returns (root, hop_count)."""
    seen = {card["uuid"]}
    current = card
    hops = 0
    while current["variant_of_uuid"] is not None:
        parent = by_uuid.get(current["variant_of_uuid"])
        assert parent is not None, (
            f"{current['set_code']}_{current['card_number']} ({current['uuid']}) "
            f"points to a variant_of_uuid not present in the export"
        )
        assert parent["uuid"] not in seen, (
            f"cycle detected resolving {card['set_code']}_{card['card_number']}"
        )
        seen.add(parent["uuid"])
        current = parent
        hops += 1
        assert hops <= max_hops, (
            f"{card['set_code']}_{card['card_number']} did not resolve to a root "
            f"within {max_hops} hops"
        )
    return current, hops


def test_fixture_size_matches_meta(export, cards):
    assert export["meta"]["totalCards"] == 8353
    assert len(cards) == 8353
    assert len(export["sets"]) == 27


def test_every_card_resolves_to_exactly_one_root(cards, by_uuid):
    """Mapping spec §3/§8 assertion 1 (corrected): every card is a root, or
    walking variant_of_uuid terminates at exactly one root, within MAX_HOPS."""
    for card in cards:
        root, _ = _resolve_root(card, by_uuid)
        assert root["variant_of_uuid"] is None


def test_root_resolution_stays_within_originating_set_or_anchors_cross_set(
    cards, by_uuid
):
    """Within-set families (Scenario A) and cross-set container anchors
    (Scenario C, e.g. SORP -> SOR) are both valid; this just confirms every
    card resolves to *some* set's root without erroring (covered by the
    resolver itself raising on dangling refs/cycles/depth)."""
    for card in cards:
        root, hops = _resolve_root(card, by_uuid)
        assert isinstance(root["set_code"], str) and root["set_code"]
        if hops == 0:
            assert root["uuid"] == card["uuid"]


def test_multi_hop_chains_are_exactly_the_confirmed_143(cards, by_uuid):
    """Regression guard for the 2026-06-21 correction: exactly 143 two-hop
    chains, all in the 6 named Weekly Play/Promo container sets."""
    multi_hop = []
    for card in cards:
        if card["variant_of_uuid"] is None:
            continue
        parent = by_uuid[card["variant_of_uuid"]]
        if parent["variant_of_uuid"] is not None:
            multi_hop.append(card)

    assert len(multi_hop) == 143
    expected_sets = {"P25", "P26", "LAWP", "SECP", "LOFP", "JTLP"}
    assert {c["set_code"] for c in multi_hop} <= expected_sets


def test_cross_set_reprints_are_not_merged(cards):
    """Scenario B: Corellian Freighter has independent roots in SOR and JTL."""
    freighters = [c for c in cards if c["name"] == "Corellian Freighter"]
    roots = [c for c in freighters if c["variant_of_uuid"] is None]
    assert len(roots) == 2
    assert {r["set_code"] for r in roots} == {"SOR", "JTL"}


def test_container_set_variant_anchors_into_base_set(cards, by_uuid):
    """Scenario C: SORP (Weekly Play) cards anchor into SOR, not into SORP."""
    sorp_cards = [c for c in cards if c["set_code"] == "SORP"]
    assert sorp_cards, "fixture should contain SORP cards"
    for card in sorp_cards:
        root, _ = _resolve_root(card, by_uuid)
        assert root["set_code"] == "SOR"


def test_every_non_standard_root_is_in_the_exceptions_file(cards):
    """Mapping spec §6/§8 assertion 3: every root with variant_type != Standard
    must be present in swuapi_standard_variant_exceptions.md (currently 15)."""
    non_standard_roots = [
        c
        for c in cards
        if c["variant_of_uuid"] is None and c["variant_type"] != "Standard"
    ]
    assert len(non_standard_roots) == 15

    for root in non_standard_roots:
        key = (root["set_code"], str(root["card_number"]))
        assert key in EXCEPTION_KEYS, (
            f"{root['set_code']}_{root['card_number']} is a non-Standard root "
            f"not recorded in swuapi_standard_variant_exceptions.md"
        )


def test_zam_wesell_is_the_sole_true_orphan(cards):
    """Scenario H: of the 15 non-Standard roots, only Zam Wesell has no
    cross-set (name, subtitle) match to any Standard-typed card."""
    non_standard_roots = [
        c
        for c in cards
        if c["variant_of_uuid"] is None and c["variant_type"] != "Standard"
    ]
    orphans = []
    for root in non_standard_roots:
        name = (root["name"] or "").strip().lower()
        sub = (root.get("subtitle") or "").strip().lower()
        match = any(
            (c["name"] or "").strip().lower() == name
            and (c.get("subtitle") or "").strip().lower() == sub
            and c["variant_type"] == "Standard"
            for c in cards
        )
        if not match:
            orphans.append(root)

    assert len(orphans) == 1
    assert orphans[0]["name"] == "Zam Wesell"
    assert orphans[0]["subtitle"] == "Not What She Seems"


def test_serialized_prestige_triple_finish_not_unique_on_card_number_and_type(cards):
    """Scenario F: SEC Serialized Prestige senator cards share
    (set_code, card_number, variant_type) across 3 distinct uuids/finishes —
    (base_card_id, variant_type) must not be assumed unique downstream."""
    serialized = [
        c
        for c in cards
        if c["set_code"] == "SEC" and c["variant_type"] == "Serialized Prestige"
    ]
    assert len(serialized) >= 3

    from collections import Counter

    counts = Counter((c["card_number"]) for c in serialized)
    assert any(count >= 3 for count in counts.values()), (
        "expected at least one SEC card_number with 3+ Serialized Prestige rows"
    )
