"""Pure unit tests for the §10.2-10.5 curated classification rules
(app/ingestion/swuapi_classify.py). DB-free."""

from app.ingestion.swuapi_classify import (
    CHANNEL_CONVENTION,
    CHANNEL_JUDGE,
    CHANNEL_MOVIE,
    CHANNEL_PRERELEASE,
    CHANNEL_PROMO_TOURNAMENT,
    CHANNEL_RETAIL,
    CHANNEL_WEEKLY_PLAY,
    FROZEN_FINISHES,
    classify_variant,
)


def test_frozen_finishes_classify_as_themselves():
    for variant_type in FROZEN_FINISHES:
        assert classify_variant(variant_type, "SOR").finish == variant_type


def test_non_finish_variant_types_have_no_finish():
    assert classify_variant("Convention Exclusive", "C26").finish is None
    assert classify_variant("PQ Champion", "P25").finish is None


def test_weekly_play_channel_by_container_set_code():
    assert classify_variant("Weekly Play", "JTLP").channel == CHANNEL_WEEKLY_PLAY
    assert classify_variant("Weekly Play Foil", "SORP").channel == CHANNEL_WEEKLY_PLAY


def test_weekly_play_channel_by_variant_type_in_base_set():
    """§10.4: early Weekly Play sits in the base set itself."""
    assert classify_variant("Weekly Play", "SOR").channel == CHANNEL_WEEKLY_PLAY
    assert classify_variant("Weekly Play Foil", "SHD").channel == CHANNEL_WEEKLY_PLAY


def test_judge_channel_by_set_code_or_label():
    assert classify_variant("Judge Program", "J25").channel == CHANNEL_JUDGE
    assert classify_variant("PQ Judge", "P25").channel == CHANNEL_JUDGE
    assert classify_variant("Prerelease Judge", "SOR").channel == CHANNEL_JUDGE


def test_convention_channel():
    assert classify_variant("Convention Exclusive", "C25").channel == CHANNEL_CONVENTION
    assert classify_variant("Convention Exclusive", "C26").channel == CHANNEL_CONVENTION


def test_promo_tournament_channel_by_set_code():
    assert classify_variant("PQ Champion", "P25").channel == CHANNEL_PROMO_TOURNAMENT
    assert classify_variant("RQ Top 4", "P26").channel == CHANNEL_PROMO_TOURNAMENT


def test_movie_and_prerelease_channels():
    assert classify_variant("Movie Promo", "MV26").channel == CHANNEL_MOVIE
    assert classify_variant("Prerelease Promo", "SOR").channel == CHANNEL_PRERELEASE


def test_retail_channel_is_the_fallback():
    """A finish variant in a base set, or a tournament-tier label that
    isn't sourced from P25/P26/a Judge set (e.g. SOR's own "PQ Champion"),
    falls through to Retail per the literal §10.4 rule order."""
    assert classify_variant("Standard", "SOR").channel == CHANNEL_RETAIL
    assert classify_variant("PQ Champion", "SOR").channel == CHANNEL_RETAIL


def test_prestige_foil_family_shares_stamp_family():
    foil = classify_variant("Foil Prestige", "SEC")
    serialized = classify_variant("Serialized Prestige", "SEC")
    assert foil.stamp_family == serialized.stamp_family == "prestige_foil"
    assert foil.stamped is False
    assert serialized.stamped is True


def test_standard_prestige_is_not_in_the_prestige_foil_family():
    classification = classify_variant("Standard Prestige", "SEC")
    assert classification.stamp_family is None


def test_tournament_tier_prefixes_share_a_family_per_prefix():
    pq_champion = classify_variant("PQ Champion", "P25")
    pq_judge = classify_variant("PQ Judge", "P25")
    rq_top4 = classify_variant("RQ Top 4", "P25")
    assert pq_champion.stamp_family == pq_judge.stamp_family == "pq_tier"
    assert rq_top4.stamp_family == "rq_tier"
    assert pq_champion.stamped is True


def test_judge_and_prerelease_default_ungrouped():
    """§10.5: Judge / Prerelease Judge / Prerelease Promo are deferred to
    BL-39 and default to no stamp_family."""
    assert classify_variant("Judge Program", "J25").stamp_family is None
    assert classify_variant("Prerelease Judge", "SOR").stamp_family is None
    assert classify_variant("Prerelease Promo", "SOR").stamp_family is None


# --- BL-29/S6: finish/channel/stamped, as exposed on the base-cards
# variant schemas (CardVariantCatalogResponse/CardVariantDetailResponse),
# for the representative variant_types named in the implementation brief.
# Same classify_variant() the API services call.


def test_standard_finish_channel_stamped():
    result = classify_variant("Standard", "SOR")
    assert result.finish == "Standard"
    assert result.channel == CHANNEL_RETAIL
    assert result.stamped is False


def test_standard_foil_finish_channel_stamped():
    result = classify_variant("Standard Foil", "SOR")
    assert result.finish == "Standard Foil"
    assert result.channel == CHANNEL_RETAIL
    assert result.stamped is False


def test_hyperspace_finish_channel_stamped():
    result = classify_variant("Hyperspace", "SOR")
    assert result.finish == "Hyperspace"
    assert result.channel == CHANNEL_RETAIL
    assert result.stamped is False


def test_weekly_play_case_finish_channel_stamped():
    """Weekly Play is a channel (provenance), not a finish -- §3.2."""
    result = classify_variant("Weekly Play", "SORP")
    assert result.finish is None
    assert result.channel == CHANNEL_WEEKLY_PLAY
    assert result.stamped is False


def test_tournament_tier_finish_channel_stamped():
    """RQ/SQ/PQ tiers are stamped promo finishes, channel Promo/Tournament
    when sourced from a P25/P26 container set."""
    result = classify_variant("RQ Top 4", "P25")
    assert result.finish is None
    assert result.channel == CHANNEL_PROMO_TOURNAMENT
    assert result.stamped is True


def test_serialized_prestige_finish_channel_stamped():
    result = classify_variant("Serialized Prestige", "SEC")
    assert result.finish == "Serialized Prestige"
    assert result.channel == CHANNEL_RETAIL
    assert result.stamped is True
