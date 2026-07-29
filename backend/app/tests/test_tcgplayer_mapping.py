"""BL-136 P1: unit tests for the pure era-aware tcgcsv join
(app/ingestion/tcgplayer_mapping.py). Fixture data only -- no live tcgcsv
calls, no DB -- covering both set-era conventions the spike found
(Spike_TCGCSV_Pricing_2026-07-16.md §4.2) plus the two residual gap classes
(Base compound products, Unicode/quote normalization) and token exclusion.
"""

from app.ingestion.tcgplayer_mapping import (
    CatalogVariant,
    build_mapping,
    normalize_name,
    parse_tier_suffix,
    resolve_variant_type,
    resolve_weekly_play_variant_type,
)

WEEKLY_PLAY_TARGET_TYPES = {"Weekly Play", "Weekly Play Foil"}

GROUP_ID = 99999


def price_row(product_id: int, sub_type: str, market: float = 1.0) -> dict:
    return {
        "productId": product_id,
        "subTypeName": sub_type,
        "lowPrice": market * 0.8,
        "midPrice": market,
        "highPrice": market * 1.5,
        "marketPrice": market,
        "directLowPrice": None,
    }


def product_row(product_id: int, name: str) -> dict:
    return {"productId": product_id, "name": name, "extendedData": []}


def four_core_variants(base_name: str, start_id: int, is_token: bool = False):
    return [
        CatalogVariant(start_id, base_name, "Standard", is_token),
        CatalogVariant(start_id + 1, base_name, "Standard Foil", is_token),
        CatalogVariant(start_id + 2, base_name, "Hyperspace", is_token),
        CatalogVariant(start_id + 3, base_name, "Hyperspace Foil", is_token),
    ]


# --- normalize_name / parse_tier_suffix / resolve_variant_type -----------


def test_normalize_name_strips_diacritics_and_curly_quotes():
    assert normalize_name("Chirrut Îmwe") == normalize_name("Chirrut Imwe")
    assert normalize_name("Staccato Lightning”") == normalize_name(
        'Staccato Lightning"'
    )
    assert normalize_name("R2-D2’s Loyalty") == normalize_name("r2-d2's loyalty")


def test_parse_tier_suffix_longest_alternative_first():
    assert parse_tier_suffix("colossus (hyperspace foil)") == (
        "colossus",
        "hyperspace foil",
    )
    assert parse_tier_suffix("colossus (hyperspace)") == ("colossus", "hyperspace")
    assert parse_tier_suffix("colossus (foil)") == ("colossus", "foil")
    assert parse_tier_suffix("colossus") == ("colossus", None)


def test_resolve_variant_type_old_era_shared_product():
    assert resolve_variant_type(None, "Normal") == "Standard"
    assert resolve_variant_type(None, "Foil") == "Standard Foil"
    assert resolve_variant_type("hyperspace", "Normal") == "Hyperspace"
    assert resolve_variant_type("hyperspace", "Foil") == "Hyperspace Foil"


def test_resolve_variant_type_new_era_separate_products():
    assert resolve_variant_type("foil", "Normal") == "Standard Foil"
    assert resolve_variant_type("hyperspace foil", "Normal") == "Hyperspace Foil"


# --- SOR/SHD-era convention: shared productId, split by subTypeName ------


def test_old_era_shared_product_all_four_tiers_match():
    catalog = four_core_variants("Security Complex", 1)
    products = [
        product_row(100, "Security Complex"),
        product_row(101, "Security Complex (Hyperspace)"),
    ]
    prices = [
        price_row(100, "Normal"),
        price_row(100, "Foil"),
        price_row(101, "Normal"),
        price_row(101, "Foil"),
    ]
    result = build_mapping("SOR", catalog, products, prices, GROUP_ID)

    assert result.stats.matched == 4
    assert result.stats.catalog_core_variants == 4
    assert result.stats.match_rate == 1.0
    assert result.exceptions == []

    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[1].tcg_product_id == 100 and by_variant[1].sub_type == "Normal"
    assert by_variant[2].tcg_product_id == 100 and by_variant[2].sub_type == "Foil"
    assert by_variant[3].tcg_product_id == 101 and by_variant[3].sub_type == "Normal"
    assert by_variant[4].tcg_product_id == 101 and by_variant[4].sub_type == "Foil"
    assert all(m.match_method == "name_tier_exact" for m in result.matches)


# --- JTL+-era convention: four separate productIds, disambiguated by name -


def test_new_era_four_separate_products_all_match():
    catalog = four_core_variants("Colossus", 10)
    products = [
        product_row(200, "Colossus"),
        product_row(201, "Colossus (Foil)"),
        product_row(202, "Colossus (Hyperspace)"),
        product_row(203, "Colossus (Hyperspace Foil)"),
    ]
    prices = [
        price_row(200, "Normal"),
        price_row(201, "Normal"),
        price_row(202, "Normal"),
        price_row(203, "Normal"),
    ]
    result = build_mapping("JTL", catalog, products, prices, GROUP_ID)

    assert result.stats.matched == 4
    assert result.stats.match_rate == 1.0
    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[10].tcg_product_id == 200
    assert by_variant[11].tcg_product_id == 201
    assert by_variant[12].tcg_product_id == 202
    assert by_variant[13].tcg_product_id == 203
    assert all(m.match_method == "name_tier_exact" for m in result.matches)


# --- Base compound products (spike §4.3 finding #2) -----------------------


def test_base_prefix_prefers_shield_side_over_experience():
    catalog = [
        CatalogVariant(20, "Capital City", "Standard"),
        CatalogVariant(21, "Capital City", "Hyperspace"),
    ]
    products = [
        product_row(300, "Capital City // Shield"),
        product_row(301, "Capital City // Experience"),
        product_row(302, "Capital City // Shield (Hyperspace)"),
        product_row(303, "Capital City // Experience (Hyperspace)"),
    ]
    prices = [
        price_row(300, "Normal"),
        price_row(301, "Normal"),
        price_row(302, "Normal"),
        price_row(303, "Normal"),
    ]
    result = build_mapping("SOR", catalog, products, prices, GROUP_ID)

    assert result.stats.matched == 2
    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[20].tcg_product_id == 300  # Shield, not Experience
    assert by_variant[20].match_method == "base_prefix"
    assert by_variant[21].tcg_product_id == 302


def test_base_prefix_falls_back_to_experience_when_no_shield():
    catalog = [CatalogVariant(30, "Some Base", "Standard")]
    products = [product_row(400, "Some Base // Experience")]
    prices = [price_row(400, "Normal")]
    result = build_mapping("SOR", catalog, products, prices, GROUP_ID)

    assert result.stats.matched == 1
    assert result.matches[0].tcg_product_id == 400
    assert result.matches[0].match_method == "base_prefix"


# --- Unicode/quote normalization (spike §4.3 finding #3) ------------------


def test_unicode_diacritic_and_quote_normalization_matches():
    catalog = [CatalogVariant(40, "Chirrut Îmwe", "Standard")]
    products = [product_row(500, "Chirrut Imwe")]
    prices = [price_row(500, "Normal")]
    result = build_mapping("LAW", catalog, products, prices, GROUP_ID)

    assert result.stats.matched == 1
    assert result.matches[0].tcg_product_id == 500


# --- Tokens excluded, not counted as exceptions ----------------------------


def test_tokens_are_excluded_from_core_denominator_not_exceptions():
    catalog = [
        CatalogVariant(50, "Experience Token", "Standard", is_token=True),
    ]
    result = build_mapping("SOR", catalog, [], [], GROUP_ID)

    assert result.stats.catalog_core_variants == 0
    assert result.stats.tokens_excluded == 1
    assert result.exceptions == []
    assert result.stats.match_rate == 1.0  # 0/0 defined as 1.0, not a divide error


# --- No matching product -> a real exception -------------------------------


def test_unmatched_variant_becomes_an_exception():
    catalog = [CatalogVariant(60, "Unmapped Card", "Standard")]
    result = build_mapping("SOR", catalog, [], [], GROUP_ID)

    assert result.stats.matched == 0
    assert result.stats.catalog_core_variants == 1
    assert len(result.exceptions) == 1
    assert result.exceptions[0].base_card_name == "Unmapped Card"
    assert result.exceptions[0].reason == "no_matching_product"
    assert result.stats.match_rate == 0.0


def test_non_target_variant_types_are_ignored_entirely():
    """BL-174 disposition: REPLACES the old
    test_non_core_variant_types_are_ignored_entirely, which asserted
    Showcase was out of scope (spike §4.4) -- BL-174 deliberately widened
    CORE_VARIANT_TYPES to include Showcase (Pricing_Coverage_NonCore_
    Finishes_2026-07-27.md), so that assertion is now testing the OLD,
    superseded behavior. Promo/tournament tiers remain genuinely out of
    scope (no suffix/finish for them exists at all), so this re-expresses
    the same "still out of scope" intent against "PQ Judge" instead."""
    catalog = [
        CatalogVariant(70, "Some Card", "PQ Judge"),
        CatalogVariant(71, "Some Card", "Standard"),
    ]
    products = [product_row(600, "Some Card")]
    prices = [price_row(600, "Normal")]
    result = build_mapping("SOR", catalog, products, prices, GROUP_ID)

    assert result.stats.catalog_core_variants == 1  # PQ Judge not counted
    assert result.stats.matched == 1
    assert result.exceptions == []


def test_showcase_and_prestige_family_are_now_in_scope():
    """BL-174: Showcase/Standard Prestige/Foil Prestige/Serialized Prestige
    widen CORE_VARIANT_TYPES -- unlike PQ Judge above, these DO match and
    DO count toward the denominator now."""
    catalog = [
        CatalogVariant(80, "Some Card", "Showcase"),
        CatalogVariant(81, "Some Card", "Standard Prestige"),
        CatalogVariant(82, "Some Card", "Foil Prestige"),
        CatalogVariant(83, "Some Card", "Serialized Prestige"),
    ]
    products = [
        product_row(601, "Some Card (Showcase)"),
        product_row(602, "Some Card (Prestige)"),
        product_row(603, "Some Card (Prestige Foil)"),
        product_row(604, "Some Card (Serialized)"),
    ]
    prices = [
        price_row(601, "Foil"),
        price_row(602, "Normal"),
        price_row(603, "Foil"),
        price_row(604, "Foil"),
    ]
    result = build_mapping("LOF", catalog, products, prices, GROUP_ID)

    assert result.stats.catalog_core_variants == 4
    assert result.stats.matched == 4
    assert result.exceptions == []
    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[80].tcg_product_id == 601
    assert by_variant[81].tcg_product_id == 602
    assert by_variant[82].tcg_product_id == 603
    assert by_variant[83].tcg_product_id == 604


def test_sec_triple_finish_ambiguity_resolves_distinctly():
    """SEC's real "Senator Chuchi - Voice for the Voiceless" carries all
    three Prestige-family tiers as three DISTINCT productIds (live-
    verified 2026-07-27, tcgcsv_files/SecretsofPowerProductsAndPrices.csv:
    661708 "(Prestige)"/Normal, 661751 "(Prestige Foil)"/Foil, 661808
    "(Serialized)"/Foil) -- the exact ambiguity flagged in
    VariantScope_Finish_Chase_Feasibility_2026-07-26.md. Standard Prestige
    must not cross-match Foil Prestige or Serialized Prestige despite all
    three sharing the same stripped base name."""
    catalog = [
        CatalogVariant(
            90, "Senator Chuchi - Voice for the Voiceless", "Standard Prestige"
        ),
        CatalogVariant(91, "Senator Chuchi - Voice for the Voiceless", "Foil Prestige"),
        CatalogVariant(
            92, "Senator Chuchi - Voice for the Voiceless", "Serialized Prestige"
        ),
    ]
    products = [
        product_row(661708, "Senator Chuchi - Voice for the Voiceless (Prestige)"),
        product_row(661751, "Senator Chuchi - Voice for the Voiceless (Prestige Foil)"),
        product_row(661808, "Senator Chuchi - Voice for the Voiceless (Serialized)"),
    ]
    prices = [
        price_row(661708, "Normal"),
        price_row(661751, "Foil"),
        price_row(661808, "Foil"),
    ]
    result = build_mapping("SEC", catalog, products, prices, GROUP_ID)

    assert result.stats.matched == 3
    assert result.exceptions == []
    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[90].tcg_product_id == 661708
    assert by_variant[91].tcg_product_id == 661751
    assert by_variant[92].tcg_product_id == 661808


def test_prestige_suffix_defensively_handles_a_foil_subtype_row():
    """No observed "(Prestige)" product has ever carried a Foil subTypeName
    row (Foil Prestige is confirmed to always be a separate "(Prestige
    Foil)" product) -- but resolve_variant_type mirrors Hyperspace's
    handling defensively in case a future set's data ever does. See
    resolve_variant_type's docstring."""
    assert resolve_variant_type("prestige", "Normal") == "Standard Prestige"
    assert resolve_variant_type("prestige", "Foil") == "Foil Prestige"
    assert resolve_variant_type("prestige", "Something Weird") is None


def test_single_tier_prestige_family_suffixes_ignore_subtype():
    """Showcase/Serialized/Prestige Foil are each a single tcgcsv product
    per card -- the suffix alone resolves the finish regardless of what
    subTypeName happens to be on that product's one price row (observed
    "Foil" or blank across every live sample)."""
    assert resolve_variant_type("showcase", "Foil") == "Showcase"
    assert resolve_variant_type("showcase", "") == "Showcase"
    assert resolve_variant_type("serialized", "Foil") == "Serialized Prestige"
    assert resolve_variant_type("serialized", "") == "Serialized Prestige"
    assert resolve_variant_type("prestige foil", "Foil") == "Foil Prestige"
    assert resolve_variant_type("prestige foil", "Normal") == "Foil Prestige"


def test_unknown_suffix_subtype_combination_is_reported_unmapped():
    """A product whose (suffix, subTypeName) resolves to no known tier
    (e.g. a Hyperspace product with a stray Foil-ish subType tcgcsv never
    actually emits) is surfaced via unmapped_products, not silently
    dropped or mis-matched."""
    catalog: list[CatalogVariant] = []
    products = [product_row(700, "Something (Hyperspace)")]
    prices = [price_row(700, "Something Weird")]
    result = build_mapping("SOR", catalog, products, prices, GROUP_ID)

    assert result.unmapped_products == ["Something (Hyperspace)"]


# --- BL-174 Part B: Weekly Play resolve_fn/target_variant_types ------------


def test_resolve_weekly_play_variant_type_ignores_suffix():
    """Unlike resolve_variant_type, the suffix argument is accepted for
    call-shape parity but never consulted -- only subTypeName decides."""
    assert resolve_weekly_play_variant_type(None, "Normal") == "Weekly Play"
    assert resolve_weekly_play_variant_type(None, "Foil") == "Weekly Play Foil"
    assert resolve_weekly_play_variant_type("hyperspace", "Normal") == "Weekly Play"
    assert resolve_weekly_play_variant_type("hyperspace", "Foil") == "Weekly Play Foil"
    assert resolve_weekly_play_variant_type("foil", "Normal") == "Weekly Play"
    assert resolve_weekly_play_variant_type("foil", "Foil") == "Weekly Play Foil"
    assert resolve_weekly_play_variant_type(None, "Something Weird") is None


def test_wp_sor_era_rare_both_subtypes_one_product_no_suffix():
    """SOR-era WP Rares: one productId, both subTypeName rows, no suffix
    (SOR's real "General Veers - Blizzard Force Commander", productId
    540613, live-verified 2026-07-27)."""
    catalog = [
        CatalogVariant(100, "General Veers - Blizzard Force Commander", "Weekly Play"),
        CatalogVariant(
            101, "General Veers - Blizzard Force Commander", "Weekly Play Foil"
        ),
    ]
    products = [product_row(540613, "General Veers - Blizzard Force Commander")]
    prices = [price_row(540613, "Normal"), price_row(540613, "Foil")]
    result = build_mapping(
        "SORP",
        catalog,
        products,
        prices,
        GROUP_ID,
        target_variant_types=WEEKLY_PLAY_TARGET_TYPES,
        resolve_fn=resolve_weekly_play_variant_type,
    )

    assert result.stats.matched == 2
    assert result.exceptions == []
    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[100].sub_type == "Normal"
    assert by_variant[101].sub_type == "Foil"


def test_wp_sor_era_hyperspace_suffixed_common_is_not_a_distinct_finish():
    """SOR-era WP Commons: some carry a "(Hyperspace)" name suffix (SOR's
    real "R2-D2 - Ignoring Protocol (Hyperspace)", productId 542143,
    Normal subType only, live-verified 2026-07-27) -- this must resolve to
    plain Weekly Play, NOT be treated as a distinct "Weekly Play
    Hyperspace" finish (our vocabulary has no such thing) and must not be
    confused with a root-set Hyperspace product."""
    catalog = [
        CatalogVariant(102, "R2-D2 - Ignoring Protocol", "Weekly Play"),
    ]
    products = [product_row(542143, "R2-D2 - Ignoring Protocol (Hyperspace)")]
    prices = [price_row(542143, "Normal")]
    result = build_mapping(
        "SORP",
        catalog,
        products,
        prices,
        GROUP_ID,
        target_variant_types=WEEKLY_PLAY_TARGET_TYPES,
        resolve_fn=resolve_weekly_play_variant_type,
    )

    assert result.stats.matched == 1
    assert result.matches[0].tcg_product_id == 542143


def test_wp_jtl_era_foil_suffix_pair_two_productids():
    """JTL+-era WP groups instead split into two productIds per card via a
    "(Foil)" name suffix (LOF's real "Graceful Purrgil" / "Graceful
    Purrgil (Foil)" pair, productIds 643570/641415, live-verified
    2026-07-27) -- subTypeName alone (not the suffix) still resolves both
    correctly since the suffix is redundant with subTypeName here."""
    catalog = [
        CatalogVariant(103, "Graceful Purrgil", "Weekly Play"),
        CatalogVariant(104, "Graceful Purrgil", "Weekly Play Foil"),
    ]
    products = [
        product_row(643570, "Graceful Purrgil"),
        product_row(641415, "Graceful Purrgil (Foil)"),
    ]
    prices = [price_row(643570, "Normal"), price_row(641415, "Foil")]
    result = build_mapping(
        "LOFP",
        catalog,
        products,
        prices,
        GROUP_ID,
        target_variant_types=WEEKLY_PLAY_TARGET_TYPES,
        resolve_fn=resolve_weekly_play_variant_type,
    )

    assert result.stats.matched == 2
    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[103].tcg_product_id == 643570
    assert by_variant[104].tcg_product_id == 641415


def test_wp_redundant_subtype_anomaly_does_not_shadow_genuine_product():
    """Regression for a real one-off tcgcsv data anomaly (LOF's "Luthen
    Rael - Masquerading Antiquarian", live-verified 2026-07-27): the
    genuine non-foil product (643589, plain name, Normal subType) AND the
    "(Foil)"-suffixed product (643590) BOTH carry a Normal subTypeName
    price row -- 643590 carries Normal AND Foil, when every other card's
    "(Foil)"-suffixed product carries only Foil. Weekly Play (non-foil)
    must still resolve to the genuine product 643589, not the anomalous
    643590 -- build_mapping's exact_index "first candidate wins" resolves
    this correctly as long as candidates are built in productId order
    (643589 before 643590), which is how both the CSV snapshot and a
    typical productId-ascending API response order them."""
    catalog = [
        CatalogVariant(105, "Luthen Rael - Masquerading Antiquarian", "Weekly Play"),
        CatalogVariant(
            106, "Luthen Rael - Masquerading Antiquarian", "Weekly Play Foil"
        ),
    ]
    products = [
        product_row(643589, "Luthen Rael - Masquerading Antiquarian"),
        product_row(643590, "Luthen Rael - Masquerading Antiquarian (Foil)"),
    ]
    prices = [
        price_row(643589, "Normal"),
        price_row(643590, "Normal"),  # the anomalous redundant row
        price_row(643590, "Foil"),
    ]
    result = build_mapping(
        "LOFP",
        catalog,
        products,
        prices,
        GROUP_ID,
        target_variant_types=WEEKLY_PLAY_TARGET_TYPES,
        resolve_fn=resolve_weekly_play_variant_type,
    )

    assert result.stats.matched == 2
    by_variant = {m.variant_id: m for m in result.matches}
    assert by_variant[105].tcg_product_id == 643589  # genuine product, not 643590
    assert by_variant[106].tcg_product_id == 643590


def test_wp_variant_types_stay_excluded_from_the_default_core_pass():
    """Weekly Play catalog variants must not accidentally count toward a
    root-set mapping call that uses build_mapping's DEFAULT
    target_variant_types (CORE_VARIANT_TYPES) -- they're a separate pass
    with their own resolve_fn, not folded into the core widening."""
    catalog = [
        CatalogVariant(107, "Some WP Card", "Weekly Play"),
        CatalogVariant(108, "Some WP Card", "Standard"),
    ]
    products = [product_row(800, "Some WP Card")]
    prices = [price_row(800, "Normal")]
    result = build_mapping("SOR", catalog, products, prices, GROUP_ID)

    assert result.stats.catalog_core_variants == 1  # Weekly Play not counted
    assert result.stats.matched == 1
    assert result.exceptions == []
