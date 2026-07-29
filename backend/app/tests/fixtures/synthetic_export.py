"""Synthetic swuapi export fixture (BL-170 slice C).

Builds a small, hand-authored export shaped exactly like a real swuapi
`/export/all` capture (`{"sets": [...], "cards": [...]}`) so
`app.ingestion.swuapi_transform.transform()` can run against it without
touching the real 13 MB fixture
(`app/ingestion/data/swuapi_export_2026-06-21.json`). Card shape mirrors the
proven in-repo pattern in `test_swuapi_ingestion_db.py:29 _synthetic_export`.

Every card name/subtitle/rules-text string here is invented for this test
fixture ("Test Leader Alpha", etc.) -- zero real FFG card text appears
anywhere in this module. **Set codes are the one exception**: six real
swuapi set codes (SOR, JTL, SORP, C25, JTLP, GG) are used as *containers*
only, because `swuapi_transform.BASE_SET_CODES` and
`swuapi_classify.py`'s curated set-code partitions (CONVENTION_SET_CODES,
JUDGE_SET_CODES, "ends with P" -> Weekly Play, ...) are keyed on literal,
real set codes -- a fictional code would silently skip that routing logic
instead of exercising it. Codes are not copyrightable text; card content is
what stays synthetic.

Scenario coverage (per specification_documents/analysis/
RepoPublic_CI_ForkSafety_2026-07-26.md, "Fixture strategy proposal",
lines 62-81):

  - 2 base-set analogs (SOR, JTL) + 1 Weekly Play container analog (SORP)
    + 1 convention-set analog (C25) + 1 promo-set analog (JTLP) + 1
    gift-set analog (GG) -- 6 sets total, enough to assert the curated
    base-set partition without the full 27.
  - A Standard root + Hyperspace + Foil variants (one-hop family), for a
    Leader-typed root (SOR_1) and a Base-typed root (JTL_1 and SOR_40).
  - A two-hop chain: promo/weekly-play card -> Hyperspace variant ->
    Standard root (SOR_1 -> SOR_201 -> SORP_1).
  - A cross-set reprint: same (name, subtitle), independent Standard roots
    in both base sets (SOR_50 / JTL_50) -- must NOT merge.
  - A non-Standard root with exactly one cross-set Standard match
    (C25_2 -> JTL_60, the re-anchor scenario), plus a second, independent
    non-Standard root matching that same Standard (JTLP_10 -> JTL_60, the
    collapse-to-one-base_card scenario).
  - A true orphan non-Standard root with no Standard match anywhere
    (C25_3, the sole-exception scenario).
  - A token duplicated per set matching multiple Standard roots
    (GG_5, the fallback-exemption scenario -- matches SOR_70 and JTL_70)
    + two ordinary token roots (GG_6, GG_7).
  - A Serialized Prestige triple: 3 rows sharing (set_code="SOR",
    card_number="180", variant_type="Serialized Prestige") with distinct
    uuids, rooted at SOR_80.
  - Two rows (SOR_191, SOR_192) sharing an identical front_image_url
    across distinct uuids/roots (SOR_91, SOR_92) -- the duplicate-image
    warning scenario.
  - No ambiguity trap here by design -- the inline synthetic export in
    `test_swuapi_transform.py` (`test_ambiguous_fallback_raises_instead_of_
    guessing`) already covers `AmbiguousFallbackError`.

The exact structural-root / base_card / exception counts below are
verified by running `transform()` against this fixture (see
`test_swuapi_transform.py`), not asserted blind -- the derivation comments
document *why* the numbers are what they are.
"""

from __future__ import annotations

# --- Set codes ---------------------------------------------------------
# Real swuapi set codes, used as containers only (see module docstring).
SOR = "SOR"  # base set analog #1 -- app.ingestion.swuapi_transform.BASE_SET_CODES
JTL = "JTL"  # base set analog #2 -- swuapi_transform.BASE_SET_CODES
SORP = (
    "SORP"  # Weekly Play container analog -- ends with "P" (classify.py channel rule)
)
C25 = "C25"  # convention set analog -- swuapi_classify.CONVENTION_SET_CODES
JTLP = "JTLP"  # promo set analog -- mirrors the real JTLP exception-key rows
GG = "GG"  # gift set analog -- mirrors the real GG token-exemption rows

SET_CODES = [SOR, JTL, SORP, C25, JTLP, GG]
BASE_SET_CODES_IN_FIXTURE = {SOR, JTL}

DUPLICATE_IMAGE_URL = "https://example.test/synthetic/duplicate-shared.png"


def _card(
    uuid: str,
    *,
    name: str,
    subtitle: str | None,
    type_: str,
    set_code: str,
    card_number: str,
    variant_type: str,
    variant_of_uuid: str | None = None,
    type2: str | None = None,
    rarity: str = "Common",
    aspects: list[str] | None = None,
    keywords: list[str] | None = None,
    traits: list[str] | None = None,
    front_image_url: str | None = None,
    back_image_url: str | None = None,
    double_sided: bool = False,
    unique_flag: bool = False,
    cost: int | None = None,
    power: int | None = None,
    hp: int | None = None,
    arena: str | None = None,
    front_text: str | None = None,
    back_text: str | None = None,
    epic_action: str | None = None,
    artist: str | None = "Synthetic Fixture",
) -> dict:
    return {
        "uuid": uuid,
        "name": name,
        "subtitle": subtitle,
        "type": type_,
        "type2": type2,
        "rarity": rarity,
        "set_code": set_code,
        "card_number": card_number,
        "variant_type": variant_type,
        "variant_of_uuid": variant_of_uuid,
        "aspects": aspects or [],
        "keywords": keywords or [],
        "traits": traits or [],
        "front_image_url": front_image_url
        or f"https://example.test/synthetic/{uuid}.png",
        "back_image_url": back_image_url,
        "double_sided": double_sided,
        "unique_flag": unique_flag,
        "cost": cost,
        "power": power,
        "hp": hp,
        "arena": arena,
        "front_text": front_text,
        "back_text": back_text,
        "epic_action": epic_action,
        "artist": artist,
    }


def _build_cards() -> list[dict]:
    cards: list[dict] = []

    # --- Family 1: Leader-typed Standard root + Hyperspace + Foil, plus a
    # two-hop chain (SORP weekly-play card -> Hyperspace -> root). ---------
    cards.append(
        _card(
            "syn-sor-leader-1",
            name="Test Leader Alpha",
            subtitle="First Synthetic",
            type_="Leader",
            set_code=SOR,
            card_number="1",
            variant_type="Standard",
            aspects=["Vigilance"],
            keywords=["Sentinel"],
            unique_flag=True,
        )
    )
    cards.append(
        _card(
            "syn-sor-leader-1-foil",
            name="Test Leader Alpha",
            subtitle="First Synthetic",
            type_="Leader",
            set_code=SOR,
            card_number="101",
            variant_type="Standard Foil",
            variant_of_uuid="syn-sor-leader-1",
        )
    )
    cards.append(
        _card(
            "syn-sor-leader-1-hyper",
            name="Test Leader Alpha",
            subtitle="First Synthetic",
            type_="Leader",
            set_code=SOR,
            card_number="201",
            variant_type="Hyperspace",
            variant_of_uuid="syn-sor-leader-1",
        )
    )
    # Two-hop chain: SORP weekly-play card -> Hyperspace variant -> root.
    cards.append(
        _card(
            "syn-sorp-leader-1-wp",
            name="Test Leader Alpha",
            subtitle="First Synthetic",
            type_="Leader",
            set_code=SORP,
            card_number="1",
            variant_type="Weekly Play",
            variant_of_uuid="syn-sor-leader-1-hyper",
        )
    )

    # --- Family 2: Base-typed Standard root + Hyperspace + Foil. -----------
    cards.append(
        _card(
            "syn-jtl-base-1",
            name="Test Base Bravo",
            subtitle="Second Synthetic",
            type_="Base",
            set_code=JTL,
            card_number="1",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-jtl-base-1-foil",
            name="Test Base Bravo",
            subtitle="Second Synthetic",
            type_="Base",
            set_code=JTL,
            card_number="101",
            variant_type="Standard Foil",
            variant_of_uuid="syn-jtl-base-1",
        )
    )
    cards.append(
        _card(
            "syn-jtl-base-1-hyper",
            name="Test Base Bravo",
            subtitle="Second Synthetic",
            type_="Base",
            set_code=JTL,
            card_number="201",
            variant_type="Hyperspace",
            variant_of_uuid="syn-jtl-base-1",
        )
    )

    # --- Cross-set reprint: same (name, subtitle), independent Standard
    # roots in SOR and JTL -- must NOT merge (Corellian Freighter scenario).
    cards.append(
        _card(
            "syn-sor-reprint-1",
            name="Test Reprint Card",
            subtitle="Same Subtitle",
            type_="Unit",
            set_code=SOR,
            card_number="50",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-jtl-reprint-1",
            name="Test Reprint Card",
            subtitle="Same Subtitle",
            type_="Unit",
            set_code=JTL,
            card_number="50",
            variant_type="Standard",
        )
    )

    # --- Re-anchor + collapse trio: two independent non-Standard roots
    # (C25_2, JTLP_10) both fallback-match the same Standard root (JTL_60)
    # and must collapse into ONE base_card, not two.
    cards.append(
        _card(
            "syn-jtl-reanchor-target",
            name="Test Reanchor Target",
            subtitle="Target Sub",
            type_="Unit",
            set_code=JTL,
            card_number="60",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-c25-reanchor-1",
            name="Test Reanchor Target",
            subtitle="Target Sub",
            type_="Unit",
            set_code=C25,
            card_number="2",
            variant_type="Convention Exclusive",
        )
    )
    cards.append(
        _card(
            "syn-jtlp-reanchor-2",
            name="Test Reanchor Target",
            subtitle="Target Sub",
            type_="Unit",
            set_code=JTLP,
            card_number="10",
            variant_type="Weekly Play",
        )
    )

    # --- True orphan: non-Standard root, no Standard match anywhere --
    # the sole exception (Zam Wesell analog).
    cards.append(
        _card(
            "syn-c25-orphan-1",
            name="Test True Orphan",
            subtitle="No Match Here",
            type_="Unit",
            set_code=C25,
            card_number="3",
            variant_type="Convention Exclusive",
        )
    )

    # --- Token duplicated per set, matching multiple Standard roots --
    # must stay its own base_card, exempt from fallback (GG_5 analog).
    cards.append(
        _card(
            "syn-gg-token-multi",
            name="Test Token Multi",
            subtitle=None,
            type_="Token Unit",
            set_code=GG,
            card_number="5",
            variant_type="Convention Exclusive",
        )
    )
    cards.append(
        _card(
            "syn-sor-tokenmulti-std1",
            name="Test Token Multi",
            subtitle=None,
            type_="Unit",
            set_code=SOR,
            card_number="70",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-jtl-tokenmulti-std2",
            name="Test Token Multi",
            subtitle=None,
            type_="Unit",
            set_code=JTL,
            card_number="70",
            variant_type="Standard",
        )
    )

    # --- Ordinary token roots (token-census shape, no exemption drama). ----
    cards.append(
        _card(
            "syn-gg-token-ord1",
            name="Test Ordinary Token One",
            subtitle=None,
            type_="Token Unit",
            set_code=GG,
            card_number="6",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-gg-token-ord2",
            name="Test Ordinary Token Two",
            subtitle=None,
            type_="Token Upgrade",
            set_code=GG,
            card_number="7",
            variant_type="Standard",
        )
    )

    # --- Serialized Prestige triple: 3 rows sharing (set_code, card_number,
    # variant_type) with distinct uuids -- kept distinct, not collapsed.
    cards.append(
        _card(
            "syn-sor-prestige-root",
            name="Test Prestige Senator",
            subtitle="Council Seat",
            type_="Unit",
            set_code=SOR,
            card_number="80",
            variant_type="Standard",
        )
    )
    for i in (1, 2, 3):
        cards.append(
            _card(
                f"syn-sor-prestige-{i}",
                name="Test Prestige Senator",
                subtitle="Council Seat",
                type_="Unit",
                set_code=SOR,
                card_number="180",
                variant_type="Serialized Prestige",
                variant_of_uuid="syn-sor-prestige-root",
                front_image_url=f"https://example.test/synthetic/prestige-{i}.png",
            )
        )

    # --- Duplicate-image pair: two distinct roots' Serialized Prestige
    # rows share an identical front_image_url (LAW_865/866 analog).
    cards.append(
        _card(
            "syn-sor-dupimg-root-c",
            name="Test Dup Image Card One",
            subtitle="Ship One",
            type_="Unit",
            set_code=SOR,
            card_number="91",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-sor-dupimg-c-sp",
            name="Test Dup Image Card One",
            subtitle="Ship One",
            type_="Unit",
            set_code=SOR,
            card_number="191",
            variant_type="Serialized Prestige",
            variant_of_uuid="syn-sor-dupimg-root-c",
            front_image_url=DUPLICATE_IMAGE_URL,
        )
    )
    cards.append(
        _card(
            "syn-sor-dupimg-root-d",
            name="Test Dup Image Card Two",
            subtitle="Ship Two",
            type_="Unit",
            set_code=SOR,
            card_number="92",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-sor-dupimg-d-sp",
            name="Test Dup Image Card Two",
            subtitle="Ship Two",
            type_="Unit",
            set_code=SOR,
            card_number="192",
            variant_type="Serialized Prestige",
            variant_of_uuid="syn-sor-dupimg-root-d",
            front_image_url=DUPLICATE_IMAGE_URL,
        )
    )

    # --- Filler: ordinary Standard-root families in every set, so the
    # fixture isn't 100% special-cases (census/shape realism). None of
    # these are non-Standard roots, so none can accidentally create an
    # extra exception.
    cards.append(
        _card(
            "syn-sor-plain-1",
            name="Test Plain Trooper",
            subtitle=None,
            type_="Unit",
            set_code=SOR,
            card_number="10",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-sor-plain-1-foil",
            name="Test Plain Trooper",
            subtitle=None,
            type_="Unit",
            set_code=SOR,
            card_number="110",
            variant_type="Standard Foil",
            variant_of_uuid="syn-sor-plain-1",
        )
    )
    cards.append(
        _card(
            "syn-jtl-plain-1",
            name="Test Plain Fighter",
            subtitle=None,
            type_="Unit",
            set_code=JTL,
            card_number="10",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-jtl-plain-1-hyper",
            name="Test Plain Fighter",
            subtitle=None,
            type_="Unit",
            set_code=JTL,
            card_number="210",
            variant_type="Hyperspace",
            variant_of_uuid="syn-jtl-plain-1",
        )
    )
    cards.append(
        _card(
            "syn-c25-plain-1",
            name="Test Con Plain Alpha",
            subtitle=None,
            type_="Unit",
            set_code=C25,
            card_number="20",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-jtlp-plain-1",
            name="Test Promo Plain Alpha",
            subtitle=None,
            type_="Unit",
            set_code=JTLP,
            card_number="20",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-sorp-plain-1",
            name="Test Weekly Plain Alpha",
            subtitle=None,
            type_="Unit",
            set_code=SORP,
            card_number="20",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-gg-plain-1",
            name="Test Gift Plain Alpha",
            subtitle=None,
            type_="Unit",
            set_code=GG,
            card_number="20",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-sor-upgrade-1",
            name="Test Upgrade Alpha",
            subtitle=None,
            type_="Upgrade",
            set_code=SOR,
            card_number="30",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-sor-upgrade-1-foil",
            name="Test Upgrade Alpha",
            subtitle=None,
            type_="Upgrade",
            set_code=SOR,
            card_number="130",
            variant_type="Standard Foil",
            variant_of_uuid="syn-sor-upgrade-1",
        )
    )
    cards.append(
        _card(
            "syn-jtl-event-1",
            name="Test Event Alpha",
            subtitle=None,
            type_="Event",
            set_code=JTL,
            card_number="30",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-jtl-event-1-foil",
            name="Test Event Alpha",
            subtitle=None,
            type_="Event",
            set_code=JTL,
            card_number="130",
            variant_type="Standard Foil",
            variant_of_uuid="syn-jtl-event-1",
        )
    )
    cards.append(
        _card(
            "syn-sor-base2",
            name="Test Base Charlie",
            subtitle=None,
            type_="Base",
            set_code=SOR,
            card_number="40",
            variant_type="Standard",
        )
    )
    cards.append(
        _card(
            "syn-sor-base2-foil",
            name="Test Base Charlie",
            subtitle=None,
            type_="Base",
            set_code=SOR,
            card_number="140",
            variant_type="Standard Foil",
            variant_of_uuid="syn-sor-base2",
        )
    )

    return cards


# Derivation, verified against a real transform() run (see
# test_swuapi_transform.py's module-scoped `result` fixture):
#
# Structural roots (variant_of_uuid is None) = 25:
#   SOR_1, JTL_1, SOR_50, JTL_50, JTL_60, C25_2, JTLP_10, C25_3, GG_5,
#   SOR_70, JTL_70, GG_6, GG_7, SOR_80, SOR_91, SOR_92, SOR_10, JTL_10,
#   C25_20, JTLP_20, SORP_20, GG_20, SOR_30, JTL_30, SOR_40.
# Fallback re-anchoring collapses C25_2 and JTLP_10 into JTL_60's
# base_card (both match it as their sole Standard fallback target) --
# net -2 structural roots.
EXPECTED_BASE_CARDS = 25 - 2  # = 23

EXPECTED_TOTAL_CARDS = 40  # len(cards) -- also len(card_variants) post-transform

# is_token base_cards: GG_5 (fallback-exempt token) + GG_6 + GG_7
# (ordinary tokens) = 3.
EXPECTED_TOKEN_BASE_CARDS = 3

# Sole exception: C25_3 "Test True Orphan" -- the only non-Standard,
# non-token root with zero Standard (name, subtitle) matches anywhere in
# the fixture.
EXPECTED_EXCEPTION_COUNT = 1


def build_synthetic_export() -> dict:
    """Export-shaped dict: {"sets": [...], "cards": [...]}, matching the
    real swuapi `/export/all` capture's shape (see
    app/ingestion/data/swuapi_export_2026-06-21.json)."""
    return {
        "sets": [{"code": code, "name": f"Test Set {code}"} for code in SET_CODES],
        "cards": _build_cards(),
    }
