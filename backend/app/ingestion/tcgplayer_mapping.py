"""BL-136 P1: the era-aware name+tier join between our catalog's card_
variants and tcgcsv's (productId, subTypeName) price keys --
Spike_TCGCSV_Pricing_2026-07-16.md §4.2/§4.3, decided in
Definition_Pricing_2026-07-16.md §2/§6.

Pure/DB-free (mirrors app.ingestion.swuapi_transform's split: this module
does the join logic against plain dicts; run_tcgplayer_mapping.py is the
DB+HTTP entrypoint). Original scope was the 4 "core" finishes (Standard,
Standard Foil, Hyperspace, Hyperspace Foil) on the 10 root sets in
tcgcsv_client.ROOT_SET_GROUP_IDS -- Showcase/Prestige/Weekly Play/promo-tier
variant_types and the 19 non-root set codes were explicitly out of scope
(spike §4.4/§1.3), matching what the spike measured match rates against.

Key finding this reimplements (spike §4.2): tcgcsv's per-tier numbering is
NOT a stable join key across set eras (SOR/SHD-era Hyperspace/Foil share a
productId with Standard via subTypeName; JTL+-era gives all four tiers
separate productIds disambiguated only by a name suffix). The join key here
is normalized card name + a tier suffix parsed from the tcgcsv product
name, cross-checked against subTypeName -- robust to both conventions
without needing to know which era a given set belongs to.

BL-174 (2026-07-27) widens the scope in two ways, per
specification_documents/analysis/Pricing_Coverage_NonCore_Finishes_2026-07-27.md:
(1) the suffix vocabulary and CORE_VARIANT_TYPES now also resolve Showcase/
Standard Prestige/Foil Prestige/Serialized Prestige products -- these are
fetched from the SAME 10 root-set groups as the original four finishes, no
new fetches required, just previously unparsed by parse_tier_suffix/
resolve_variant_type. (2) a parallel Weekly Play resolution path
(resolve_weekly_play_variant_type, threaded through build_mapping's new
resolve_fn/target_variant_types parameters) covers the 8 "P"-coded
container-set groups in tcgcsv_client.WEEKLY_PLAY_GROUP_IDS, which use a
DIFFERENT (suffix-ignoring) precedence rule than the root-set path -- see
that function's docstring. Promo/tournament tiers (Judge/Convention/PQ-RQ-
SQ-GC-SS stamp tiers) remain out of scope.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field

# Finishes this mapping builder targets -- FROZEN_FINISHES' retail subset
# (app.ingestion.swuapi_classify) minus nothing: the original 4 finishes
# the spike measured (Standard/Standard Foil/Hyperspace/Hyperspace Foil)
# plus BL-174's Prestige/Showcase widening (Standard Prestige/Foil
# Prestige/Serialized Prestige/Showcase). This is the default
# target_variant_types for build_mapping -- the root-set pass. Weekly Play
# ("Weekly Play"/"Weekly Play Foil", not in FROZEN_FINISHES -- they're a
# channel, not a retail finish) is a SEPARATE pass with its own target set,
# passed explicitly by run_tcgplayer_mapping.run() rather than folded in
# here, since it also needs the different resolve_weekly_play_variant_type
# resolver below.
CORE_VARIANT_TYPES = {
    "Standard",
    "Standard Foil",
    "Hyperspace",
    "Hyperspace Foil",
    "Standard Prestige",
    "Foil Prestige",
    "Serialized Prestige",
    "Showcase",
}

# Longest-alternative-first so "(Hyperspace Foil)"/"(Prestige Foil)" aren't
# mistakenly parsed as "(Hyperspace)"/"(Prestige)" plus leftover text (the
# trailing `\)` anchor actually makes this order-independent for
# correctness -- see parse_tier_suffix's docstring -- kept longest-first
# anyway for readability, matching the convention this pattern started with).
_SUFFIX_RE = re.compile(
    r"\s*\("
    r"(hyperspace foil|prestige foil|hyperspace|serialized|showcase|prestige|foil)"
    r"\)\s*$",
    re.IGNORECASE,
)

# Base-card compound products (spike §4.2/4.3): tcgcsv represents a
# double-sided Base as two-to-four "<name> // <side>" products (one per
# side, each optionally Hyperspace-suffixed). Our catalog has only ONE
# variant row per tier (no separate Shield/Experience variant), so a
# prefix match must pick one side as canonical. "Shield" is preferred
# (arbitrary but consistent -- documented decision, no strong signal either
# way in the source data) with "Experience" as a fallback when a set's
# Base product only has an Experience-side listing.
BASE_SIDE_PREFERENCE = ("shield", "experience")


def normalize_name(name: str) -> str:
    """Unicode-normalize a card/product name for comparison: strip
    diacritics (NFKD decompose + drop combining marks) and fold curly
    quotes to straight ones (spike §4.3's finding #3 -- the catalog
    preserves "Chirrut Imwe"'s circumflex and curly quotes, tcgcsv strips/
    straightens them), collapse whitespace, lowercase."""
    folded = (
        name.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    )
    decomposed = unicodedata.normalize("NFKD", folded)
    without_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(without_marks.split()).strip().lower()


def parse_tier_suffix(normalized_name: str) -> tuple[str, str | None]:
    """Splits a normalized tcgcsv product name into (base_name, suffix),
    where suffix is one of "hyperspace foil" | "hyperspace" | "foil" |
    "prestige foil" | "prestige" | "serialized" | "showcase" | None.
    Longest-alternative-first regex so "(Hyperspace Foil)" isn't mistakenly
    parsed as "(Hyperspace)" plus leftover text (and likewise "(Prestige
    Foil)" vs "(Prestige)", BL-174)."""
    match = _SUFFIX_RE.search(normalized_name)
    if match is None:
        return normalized_name, None
    return normalized_name[: match.start()].rstrip(), match.group(1).lower()


def resolve_variant_type(suffix: str | None, sub_type_name: str) -> str | None:
    """(name-suffix, subTypeName) -> our variant_type vocabulary, per spike
    §4.2's two conventions:

    - SOR/SHD-era: Standard's two finishes share one productId, split only
      by subTypeName (no name suffix); Hyperspace is a separate productId
      with a "(Hyperspace)" suffix, itself carrying both subTypeName rows.
    - JTL+-era: all four tiers get separate productIds, each disambiguated
      by name suffix alone -- a "(Foil)"/"(Hyperspace Foil)" product's own
      subTypeName is not a reliable second signal (tcgcsv has been observed
      labeling it either way), so the name suffix wins outright once it
      names foil explicitly.

    BL-174 extends the same two conventions to the four "chase" finishes,
    live-verified 2026-07-27 against the root-set CSVs
    (tcgcsv_files/*ProductsAndPrices.csv):

    - "(Showcase)" and "(Serialized)" are each a SINGLE tcgcsv product per
      card with no sibling foil/non-foil split (every sample's subTypeName
      was "Foil" or blank, never both) -- the suffix alone resolves the
      finish and subTypeName is ignored, exactly mirroring how
      "(Hyperspace Foil)" ignores subTypeName above.
    - "(Prestige)" mirrors the SOR/SHD-era Hyperspace shape: every sample
      carried ONLY a Normal subTypeName row (no Foil sibling row) --
      Normal resolves to Standard Prestige. A Foil subTypeName row on a
      "(Prestige)" product has never been observed (confirmed: "(Prestige
      Foil)" is a wholly SEPARATE product, own productId, own name suffix
      -- SEC's "Senator Chuchi - Voice for the Voiceless" carries all
      three tiers as three distinct productIds, none sharing one), but is
      handled the same defensive way Hyperspace's Foil row is (-> Foil
      Prestige) rather than silently dropped, in case a future set's data
      ever does carry it.
    - "(Prestige Foil)" -- like "(Hyperspace Foil)" -- always resolves to
      Foil Prestige regardless of subTypeName.

    Returns None for a (suffix, sub_type_name) combination that names no
    known tier (defensive -- becomes an "unmapped product" in the mapping
    report rather than a silent wrong match).
    """
    if suffix is None:
        if sub_type_name == "Normal":
            return "Standard"
        if sub_type_name == "Foil":
            return "Standard Foil"
        return None
    if suffix == "foil":
        return "Standard Foil"
    if suffix == "hyperspace":
        if sub_type_name == "Normal":
            return "Hyperspace"
        if sub_type_name == "Foil":
            return "Hyperspace Foil"
        return None
    if suffix == "hyperspace foil":
        return "Hyperspace Foil"
    if suffix == "showcase":
        return "Showcase"
    if suffix == "serialized":
        return "Serialized Prestige"
    if suffix == "prestige foil":
        return "Foil Prestige"
    if suffix == "prestige":
        if sub_type_name == "Normal":
            return "Standard Prestige"
        if sub_type_name == "Foil":
            return "Foil Prestige"
        return None
    return None


def resolve_weekly_play_variant_type(
    suffix: str | None, sub_type_name: str
) -> str | None:
    """BL-174 Part B: the (name-suffix, subTypeName) -> variant_type
    resolver for Weekly Play promo groups -- a DELIBERATELY DIFFERENT
    precedence rule from resolve_variant_type above. `suffix` is accepted
    (same call shape as resolve_variant_type, so both can be passed
    interchangeably as build_mapping's resolve_fn) but IGNORED: resolution
    is purely subTypeName -> Normal is "Weekly Play", Foil is "Weekly Play
    Foil".

    Grounded in the local WP snapshots
    (tcgcsv_files/*WeeklyPlayPromos*.csv, verified 2026-07-27), which show
    two different tcgcsv conventions across eras, neither of which the
    name suffix can be trusted to disambiguate:

    - SOR/SHD/TWI-era WP groups mix suffix-free Rares (one productId, both
      subTypeName rows) with Commons that are EITHER suffix-free OR
      "(Hyperspace)"-suffixed (one subTypeName row each) -- e.g. SOR's
      "R2-D2 - Ignoring Protocol (Hyperspace)" carries only a Normal row.
      The "(Hyperspace)" here documents the promo's physical foil
      treatment, not a distinct catalog finish -- our vocabulary has no
      "Weekly Play Hyperspace" -- so letting the suffix drive resolution
      the way it does for root-set Hyperspace would be wrong.
    - JTL+-era WP groups instead split into two productIds per card via a
      "(Foil)" name suffix (mirroring the root-set core convention), but
      that suffix is always redundant with subTypeName in every sample
      checked ("(Foil)"-suffixed products carry subTypeName "Foil") --
      EXCEPT one one-off tcgcsv data anomaly: LOF's "Luthen Rael -
      Masquerading Antiquarian (Foil)" (productId 643590) carries BOTH a
      Normal and a Foil subTypeName row under the "(Foil)"-suffixed
      product. Ignoring suffix and reading subTypeName directly still
      resolves every catalog variant correctly here: the spurious
      Normal-subType row on 643590 loses build_mapping's "first candidate
      wins" race in exact_index to the genuine plain-name product's own
      Normal row (productId 643589) as long as candidates are built in
      productId order -- see
      test_wp_redundant_subtype_anomaly_does_not_shadow_genuine_product.
    """
    if sub_type_name == "Normal":
        return "Weekly Play"
    if sub_type_name == "Foil":
        return "Weekly Play Foil"
    return None


@dataclass(frozen=True)
class ProductCandidate:
    tcg_product_id: int
    tcg_group_id: int
    sub_type: str  # raw subTypeName off the matched price row
    variant_type: str
    matched_name: str  # original (non-normalized) tcgcsv product name
    match_method: str  # "name_tier_exact" | "base_prefix"
    base_side: str | None = None  # "shield" | "experience" | None


@dataclass(frozen=True)
class CatalogVariant:
    variant_id: int
    base_card_name: str
    variant_type: str
    is_token: bool = False


@dataclass
class MatchRow:
    variant_id: int
    tcg_product_id: int
    tcg_group_id: int
    sub_type: str
    match_method: str
    matched_name: str


@dataclass
class ExceptionRow:
    base_card_name: str
    variant_type: str
    reason: str  # "no_matching_product" | "token" (informational)


@dataclass
class SetMappingStats:
    set_code: str
    catalog_core_variants: int
    matched: int
    tokens_excluded: int

    @property
    def match_rate(self) -> float:
        if self.catalog_core_variants == 0:
            return 1.0
        return self.matched / self.catalog_core_variants


@dataclass
class MappingResult:
    matches: list[MatchRow] = field(default_factory=list)
    exceptions: list[ExceptionRow] = field(default_factory=list)
    stats: SetMappingStats | None = None
    unmapped_products: list[str] = field(
        default_factory=list
    )  # products whose (suffix, subType) resolved to no known tier


def build_product_candidates(
    products: list[dict],
    prices: list[dict],
    group_id: int,
    resolve_fn: Callable[[str | None, str], str | None] = resolve_variant_type,
) -> tuple[list[ProductCandidate], list[str]]:
    """Joins tcgcsv `products` (name, productId) against `prices`
    (productId, subTypeName, ...) into ProductCandidate rows, one per
    matched price row. Returns (candidates, unmapped_product_names) --
    the latter are price rows whose name-suffix/subTypeName combination
    resolved to no known tier (resolve_fn returned None).

    group_id is threaded through explicitly rather than read off the price
    row -- tcgcsv's /prices response (spike §1.5) doesn't carry a groupId
    field, only productId/subTypeName/the four price tiers.

    resolve_fn is the (suffix, subTypeName) -> variant_type function to
    apply -- defaults to resolve_variant_type (the root-set core/Prestige/
    Showcase precedence). BL-174's Weekly Play mapping pass injects
    resolve_weekly_play_variant_type instead (a DIFFERENT precedence that
    ignores suffix -- see that function's docstring)."""
    name_by_product_id = {p["productId"]: p["name"] for p in products}
    candidates: list[ProductCandidate] = []
    unmapped: list[str] = []

    for price_row in prices:
        product_id = price_row["productId"]
        raw_name = name_by_product_id.get(product_id)
        if raw_name is None:
            continue  # price row for a product outside this products list (shouldn't happen)

        sub_type_name = price_row.get("subTypeName", "Normal")
        normalized = normalize_name(raw_name)
        stripped_base, suffix = parse_tier_suffix(normalized)
        variant_type = resolve_fn(suffix, sub_type_name)

        if variant_type is None:
            unmapped.append(raw_name)
            continue

        if " // " in stripped_base:
            root_name, side = stripped_base.split(" // ", 1)
            candidates.append(
                ProductCandidate(
                    tcg_product_id=product_id,
                    tcg_group_id=group_id,
                    sub_type=sub_type_name,
                    variant_type=variant_type,
                    matched_name=raw_name,
                    match_method="base_prefix",
                    base_side=side.strip(),
                )
            )
        else:
            candidates.append(
                ProductCandidate(
                    tcg_product_id=product_id,
                    tcg_group_id=group_id,
                    sub_type=sub_type_name,
                    variant_type=variant_type,
                    matched_name=raw_name,
                    match_method="name_tier_exact",
                )
            )

    return candidates, unmapped


def _candidate_name(candidate: ProductCandidate) -> str:
    """The comparison name for a candidate: the tier-suffix-stripped name,
    further split at ' // ' for base_prefix candidates. Recomputed from the
    stored matched_name rather than threaded through as extra state."""
    stripped_base, _ = parse_tier_suffix(normalize_name(candidate.matched_name))
    if candidate.match_method == "base_prefix" and " // " in stripped_base:
        return stripped_base.split(" // ", 1)[0]
    return stripped_base


def build_mapping(
    set_code: str,
    catalog_variants: list[CatalogVariant],
    products: list[dict],
    prices: list[dict],
    group_id: int,
    target_variant_types: set[str] = CORE_VARIANT_TYPES,
    resolve_fn: Callable[[str | None, str], str | None] = resolve_variant_type,
) -> MappingResult:
    """The full P1 join for one tcgcsv group: catalog variants whose
    variant_type is in target_variant_types (non-token) x tcgcsv products+
    prices for that group -> MatchRow per resolved variant, ExceptionRow
    per catalog variant with no matching product.

    target_variant_types/resolve_fn default to the root-set pass (Standard/
    Standard Foil/Hyperspace/Hyperspace Foil/Showcase/Standard Prestige/
    Foil Prestige/Serialized Prestige, resolved via the suffix-wins
    resolve_variant_type). BL-174's Weekly Play pass calls this with
    target_variant_types={"Weekly Play", "Weekly Play Foil"} and
    resolve_fn=resolve_weekly_play_variant_type instead --
    run_tcgplayer_mapping.run() picks the pair per set_code."""
    candidates, unmapped_products = build_product_candidates(
        products, prices, group_id, resolve_fn=resolve_fn
    )

    exact_index: dict[tuple[str, str], ProductCandidate] = {}
    prefix_index: dict[tuple[str, str], dict[str, ProductCandidate]] = {}
    for candidate in candidates:
        key_name = _candidate_name(candidate)
        if candidate.match_method == "name_tier_exact":
            # First one wins; a genuine duplicate exact name+tier in one
            # group would be a tcgcsv data anomaly, not something to guess
            # at further.
            exact_index.setdefault((key_name, candidate.variant_type), candidate)
        else:
            side_map = prefix_index.setdefault((key_name, candidate.variant_type), {})
            side = (candidate.base_side or "").lower()
            side_map.setdefault(side, candidate)

    matches: list[MatchRow] = []
    exceptions: list[ExceptionRow] = []
    tokens_excluded = 0
    core_total = 0

    for cv in catalog_variants:
        if cv.is_token:
            tokens_excluded += 1
            continue
        if cv.variant_type not in target_variant_types:
            continue
        core_total += 1

        name_key = normalize_name(cv.base_card_name)
        chosen: ProductCandidate | None = None

        exact = exact_index.get((name_key, cv.variant_type))
        if exact is not None:
            chosen = exact
        else:
            sides = prefix_index.get((name_key, cv.variant_type))
            if sides:
                for preferred in BASE_SIDE_PREFERENCE:
                    if preferred in sides:
                        chosen = sides[preferred]
                        break
                if chosen is None:
                    # Neither preferred side present but the key exists --
                    # take whatever side is there (defensive, not expected
                    # to trigger given BASE_SIDE_PREFERENCE covers both
                    # observed sides).
                    chosen = next(iter(sides.values()))

        if chosen is None:
            exceptions.append(
                ExceptionRow(
                    base_card_name=cv.base_card_name,
                    variant_type=cv.variant_type,
                    reason="no_matching_product",
                )
            )
            continue

        matches.append(
            MatchRow(
                variant_id=cv.variant_id,
                tcg_product_id=chosen.tcg_product_id,
                tcg_group_id=chosen.tcg_group_id,
                sub_type=chosen.sub_type,
                match_method=chosen.match_method,
                matched_name=chosen.matched_name,
            )
        )

    stats = SetMappingStats(
        set_code=set_code,
        catalog_core_variants=core_total,
        matched=len(matches),
        tokens_excluded=tokens_excluded,
    )

    return MappingResult(
        matches=matches,
        exceptions=exceptions,
        stats=stats,
        unmapped_products=unmapped_products,
    )
