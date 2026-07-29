"""Curated classification of swuapi's raw `variant_type` values.

SWU_Catalog_Redesign_Spec.md §10.2-10.5: `variant_type` is stored raw
(verbatim) on `card_variants`; this module is the curated interpretation
layer that derives `finish` (the 8 frozen values, §10.3), `channel`
(provenance, §10.4), and stamp metadata (§10.5) from it. Only the
`stamp_group` it feeds is an actual `card_variants` column today -- finish/
channel/stamped/stamp_family are not persisted, just computed on demand --
so this is the single place those rules live; other code (ingestion,
future settings/UI work) should import it rather than re-deriving them.
"""

from dataclasses import dataclass

FROZEN_FINISHES = {
    "Standard",
    "Standard Foil",
    "Hyperspace",
    "Hyperspace Foil",
    "Standard Prestige",
    "Foil Prestige",
    "Serialized Prestige",
    "Showcase",
}

WEEKLY_PLAY_VARIANT_TYPES = {"Weekly Play", "Weekly Play Foil"}
JUDGE_SET_CODES = {"J24", "J25"}
CONVENTION_SET_CODES = {"C24", "C25", "C26"}
PROMO_SET_CODES = {"P25", "P26"}

PRESTIGE_FOIL_FAMILY = {"Foil Prestige", "Serialized Prestige"}
TOURNAMENT_TIER_PREFIXES = ("PQ", "RQ", "SQ", "GC", "SS")

CHANNEL_WEEKLY_PLAY = "Weekly Play"
CHANNEL_JUDGE = "Judge"
CHANNEL_CONVENTION = "Convention"
CHANNEL_PROMO_TOURNAMENT = "Promo / Tournament-tier"
CHANNEL_MOVIE = "Movie"
CHANNEL_PRERELEASE = "Prerelease"
CHANNEL_RETAIL = "Retail"

ALL_CHANNELS = (
    CHANNEL_WEEKLY_PLAY,
    CHANNEL_JUDGE,
    CHANNEL_CONVENTION,
    CHANNEL_PROMO_TOURNAMENT,
    CHANNEL_MOVIE,
    CHANNEL_PRERELEASE,
    CHANNEL_RETAIL,
)

# BL-24: the canonical vocabulary for a "limit bucket" (see limit_bucket()
# below) -- the 8 frozen finishes plus the 7 channels above. Used both to
# enumerate the full effective-limits matrix (GET /api/settings/limits) and
# to validate incoming override rows (PUT /api/settings/limits rejects any
# limit_bucket outside this set with 422).
ALL_LIMIT_BUCKETS = frozenset(FROZEN_FINISHES) | set(ALL_CHANNELS)


@dataclass(frozen=True)
class VariantClassification:
    finish: str | None
    channel: str
    stamped: bool
    stamp_family: str | None


def _tournament_tier_prefix(variant_type: str) -> str | None:
    for prefix in TOURNAMENT_TIER_PREFIXES:
        if variant_type.startswith(prefix + " "):
            return prefix
    return None


def classify_variant(variant_type: str, source_set_code: str) -> VariantClassification:
    """§10.2-10.5, applied literally in the order the spec states them.

    Channel and stamp_family are independent derivations: channel rules
    are about provenance (which checks a variant_type *or* a source-set
    signal per rule), stamp_family is purely about variant_type-driven
    visual-stamp grouping. A variant can therefore land in one channel
    while still sharing a stamp_family with siblings in another (e.g. "PQ
    Judge" classifies as channel=Judge per the " Judge" suffix rule, but
    still groups with the rest of its PQ tier family for stamp_group).
    """
    finish = variant_type if variant_type in FROZEN_FINISHES else None

    if source_set_code.endswith("P") or variant_type in WEEKLY_PLAY_VARIANT_TYPES:
        channel = CHANNEL_WEEKLY_PLAY
    elif (
        source_set_code in JUDGE_SET_CODES
        or variant_type == "Judge Program"
        or variant_type.endswith(" Judge")
    ):
        channel = CHANNEL_JUDGE
    elif (
        source_set_code in CONVENTION_SET_CODES
        or variant_type == "Convention Exclusive"
    ):
        channel = CHANNEL_CONVENTION
    elif source_set_code in PROMO_SET_CODES:
        channel = CHANNEL_PROMO_TOURNAMENT
    elif source_set_code == "MV26" or variant_type == "Movie Promo":
        channel = CHANNEL_MOVIE
    elif variant_type.startswith("Prerelease"):
        channel = CHANNEL_PRERELEASE
    else:
        channel = CHANNEL_RETAIL

    tier_prefix = _tournament_tier_prefix(variant_type)
    if variant_type in PRESTIGE_FOIL_FAMILY:
        stamp_family = "prestige_foil"
        stamped = variant_type == "Serialized Prestige"
    elif tier_prefix is not None:
        stamp_family = f"{tier_prefix.lower()}_tier"
        stamped = True
    else:
        stamp_family = None
        stamped = False

    return VariantClassification(
        finish=finish, channel=channel, stamped=stamped, stamp_family=stamp_family
    )


def limit_bucket(variant_type: str, source_set_code: str) -> str:
    """BL-24: the tenant-configurable inventory-limit "bucket" a variant
    belongs to -- its `finish` if it has one (a known retail printing), else
    its `channel` (provenance-based bucket for variant_types with no frozen
    finish, e.g. tournament tiers, Weekly Play). Always one of
    ALL_LIMIT_BUCKETS. Keyed together with type_category
    (app/services/limits.py) against `tenant_card_limits`."""
    classification = classify_variant(variant_type, source_set_code)
    return (
        classification.finish
        if classification.finish is not None
        else classification.channel
    )
