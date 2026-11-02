"""BL-326 (ingestion side): cp1252-mojibake repair in the swuapi transform.
TWI 15 General Grievous carried apostrophe and non-breaking-space text
decoded as cp1252. Semantics mirror repairMojibake in
frontend/src/public/publicCatalog.ts. Non-ASCII test data is written as
unicode escapes so editors cannot silently normalise it."""

import pytest

from app.ingestion.swuapi_transform import repair_mojibake, transform
from app.tests.fixtures.synthetic_export import build_synthetic_export

# "can't" (right single quote) after UTF-8 -> cp1252 mis-decoding:
# a-circumflex, euro sign, trade mark.
BROKEN_APOSTROPHE = "can\u00e2\u20ac\u2122t"
FIXED_APOSTROPHE = "can\u2019t"
# "6<nbsp>or more": the nbsp's UTF-8 lead byte decoded as A-circumflex.
BROKEN_NBSP = "6\u00c2\u00a0or more"
FIXED_NBSP = "6\u00a0or more"


@pytest.mark.parametrize(
    "broken, fixed",
    [
        (BROKEN_APOSTROPHE, FIXED_APOSTROPHE),
        (BROKEN_NBSP, FIXED_NBSP),
        ("na\u00c3\u00afve", "na\u00efve"),
        # Right double quote: the third byte 0x9D is one of the five slots
        # cp1252 leaves undefined; it maps to itself (code point < 0x100).
        ("\u00e2\u20ac\x9dx", "\u201dx"),
        # Each of the five undefined slots (0x81, 0x8D, 0x8F, 0x90, 0x9D)
        # round-trips as a continuation byte. U+0141 is C5 81, U+014D is
        # C5 8D, U+014F is C5 8F, U+0150 is C5 90, U+015D is C5 9D.
        ("\u00c2\u00a0\u00c5\x81", "\u00a0\u0141"),
        ("\u00c2\u00a0\u00c5\x8d", "\u00a0\u014d"),
        ("\u00c2\u00a0\u00c5\x8f", "\u00a0\u014f"),
        ("\u00c2\u00a0\u00c5\x90", "\u00a0\u0150"),
        ("\u00c2\u00a0\u00c5\x9d", "\u00a0\u015d"),
    ],
)
def test_mojibake_is_repaired(broken, fixed):
    assert repair_mojibake(broken) == fixed


@pytest.mark.parametrize(
    "clean",
    [
        "plain ASCII text",
        "En dash \u2013 stays",
        "curly \u2019 quote already right",
        "caf\u00e9",
        "",
        None,
    ],
)
def test_clean_text_is_untouched(clean):
    assert repair_mojibake(clean) == clean


def test_unrepairable_text_is_kept():
    # Matches the pattern but is not valid UTF-8 as a byte sequence.
    stray = "\u00c3 stray lead byte"
    assert repair_mojibake(stray) == stray
    # A character outside both < 0x100 and the cp1252 table: keep original.
    mixed = "\u00c3\u4e2d"
    assert repair_mojibake(mixed) == mixed


def test_transform_repairs_base_card_text_fields():
    export = build_synthetic_export()
    target = next(c for c in export["cards"] if c["variant_of_uuid"] is None)
    target["front_text"] = "It " + BROKEN_APOSTROPHE + " be defeated"
    target["epic_action"] = "Epic Action: draw " + BROKEN_NBSP
    target["back_text"] = "Clean \u2013 text"
    target["keywords"] = ["Sentinel", "Rai" + BROKEN_APOSTROPHE]
    target["traits"] = ["Rebel", "Ma" + BROKEN_NBSP]
    result = transform(export)
    row = next(b for b in result.base_cards if b["swuapi_id"] == target["uuid"])
    assert row["front_text"] == "It " + FIXED_APOSTROPHE + " be defeated"
    assert row["epic_action"] == "Epic Action: draw " + FIXED_NBSP
    assert row["back_text"] == "Clean \u2013 text"
    assert result.keywords[target["uuid"]] == ["Sentinel", "Rai" + FIXED_APOSTROPHE]
    assert result.traits[target["uuid"]] == ["Rebel", "Ma" + FIXED_NBSP]
