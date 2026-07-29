"""Census-flavored tests split out of test_swuapi_transform.py (BL-170
slice C), per specification_documents/analysis/
RepoPublic_CI_ForkSafety_2026-07-26.md's "Fixture strategy proposal".

These assert exact real-world counts against the captured 2026-06-21
swuapi export (base_card totals, the frozen token census, Zam Wesell's
specifics, the LAW_865/866 duplicate-image flag, and exceptions-doc
rendering against real data) -- a synthetic fixture can't stand in for
them without becoming circular (asserting our own fixture matches our own
transform). This file IS the evidence that the variant mapping spec's
structural assumptions hold in the wild.

Tier 2 (real-data contract tier): requires the real export fixture on
disk. Skips cleanly when it is absent (e.g. after BL-170 moves the export
to the private GCS bucket) -- run `pytest -m realdata` after fetching the
fixture (see the content runbook) to exercise this file.
"""

import json
import os
from pathlib import Path

import pytest

from app.ingestion.swuapi_transform import render_exceptions_doc, transform

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


@pytest.fixture(scope="module")
def export():
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def result(export):
    return transform(export)


def test_base_card_count_after_fallback_reanchoring(result):
    """2,319 structural roots (§10.1) minus the 13 non-token roots the §10.6
    fallback merges into an existing Standard root elsewhere (15 total
    non-Standard roots, minus the 1 true exception (Zam) and the 1 exempt
    token (GG_5) that both stay their own base_cards)."""
    assert len(result.base_cards) == 2319 - 13


def test_card_variant_count_equals_total_cards(export, result):
    assert len(result.card_variants) == len(export["cards"])


def test_zam_wesell_is_the_sole_exception(result):
    assert len(result.exceptions) == 1
    exc = result.exceptions[0]
    assert exc["name"] == "Zam Wesell"
    assert exc["subtitle"] == "Not What She Seems"
    assert exc["set_code"] == "C26"


def test_is_token_matches_the_frozen_census(result):
    """§10.7: type containing "Token" -- 21 Token Unit + 28 Token Upgrade +
    2 Credit Token + 2 Force Token = 53 token cards total (across both root
    and non-root rows); base_cards.is_token marks the 26 token roots."""
    token_base_cards = [bc for bc in result.base_cards if bc["is_token"]]
    assert len(token_base_cards) == 26


def test_identical_image_collisions_are_flagged(result):
    """§10.8: LAW_865/866 Serialized Prestige rows share an identical image
    hash across distinct uuids -- flagged, not silently merged."""
    flagged_urls = {w["front_image_url"] for w in result.duplicate_image_warnings}
    assert any("Highsinger" in url for url in flagged_urls)
    assert any("Hounds_Tooth" in url for url in flagged_urls)


def test_render_exceptions_doc_with_zam_only(result):
    doc = render_exceptions_doc(result.exceptions)
    assert "## Current exceptions (1)" in doc
    assert "Zam Wesell" in doc
