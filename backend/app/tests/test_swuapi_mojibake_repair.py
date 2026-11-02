"""BL-326 (ingestion side): conservative cp1252-mojibake repair in the
swuapi transform. TWI 15 General Grievous carried "can't" and "6 or" text
decoded as cp1252 (written below as \\u escapes so this file stays pure
ASCII and survives any editor round trip)."""

import pytest

from app.ingestion.swuapi_transform import repair_mojibake, transform
from app.tests.fixtures.synthetic_export import build_synthetic_export

# "can’t" after UTF-8 -> cp1252 mis-decoding: a-circumflex, euro, tm.
BROKEN_APOSTROPHE = "canâ€™t"
# "6<nbsp>or": the nbsp's UTF-8 lead byte decoded as A-circumflex.
BROKEN_NBSP = "6Â or more"


@pytest.mark.parametrize(
    "broken, fixed",
    [
        (BROKEN_APOSTROPHE, "can’t"),
        (BROKEN_NBSP, "6 or more"),
        ("naÃ¯ve", "naïve"),
    ],
)
def test_mojibake_is_repaired(broken, fixed):
    assert repair_mojibake(broken) == fixed


@pytest.mark.parametrize(
    "clean",
    [
        "plain ASCII text",
        "En dash – stays",
        "curly ’ quote already right",
        "café",
        "",
        None,
    ],
)
def test_clean_text_is_untouched(clean):
    assert repair_mojibake(clean) == clean


def test_unrepairable_text_is_kept():
    # Matches the pattern but is not valid UTF-8 once re-encoded as cp1252.
    stray = "Ã stray lead byte"
    assert repair_mojibake(stray) == stray
    # A character cp1252 cannot encode: keep the original.
    mixed = "Ã中"
    assert repair_mojibake(mixed) == mixed


def test_transform_repairs_base_card_text_fields():
    export = build_synthetic_export()
    target = next(c for c in export["cards"] if c["variant_of_uuid"] is None)
    target["front_text"] = "It " + BROKEN_APOSTROPHE + " be defeated"
    target["epic_action"] = "Epic Action: draw " + BROKEN_NBSP
    target["back_text"] = "Clean – text"
    result = transform(export)
    row = next(b for b in result.base_cards if b["swuapi_id"] == target["uuid"])
    assert row["front_text"] == "It can’t be defeated"
    assert row["epic_action"] == "Epic Action: draw 6 or more"
    assert row["back_text"] == "Clean – text"
