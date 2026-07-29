import { parseCardDisplay } from "./catalog";
import type { BaseCard } from "./catalog";

// Filter logic for the Cards view, extracted from components/FilterPanel.tsx
// (RR-22) following the utils/ pattern (resolver, inventory): pure functions
// and domain constants here, panel UI in the component.

// ── Domain constants ──────────────────────────────────────────────────────

export const ASPECT_LIST = [
  "Vigilance",
  "Command",
  "Aggression",
  "Cunning",
  "Heroism",
  "Villainy",
] as const;

// BL-90: sentinel for the "No Aspect" pseudo-option, matching
// `card.aspects.length === 0`. Chosen to be unreachable as a real aspect
// name (swuapi aspects are always one of ASPECT_LIST) so it can share a
// Set<string> with real aspect values without collision risk.
export const NO_ASPECT = "__none__";

// BL-130 (issue #306): the three-way control governing how a multi-aspect
// selection is evaluated against a card's own effective aspect set (real
// aspects, or [NO_ASPECT] for an aspectless card -- same representation
// `FIELD_EXTRACTORS.aspects` already uses). Order matches the segmented
// control's left-to-right layout.
//   - "any"    -- today's OR match: the card carries at least one selected
//                 aspect (or is aspectless and NO_ASPECT is selected).
//   - "within" -- subset match: no card carrying an aspect *outside* the
//                 selection passes (the deckbuilder question -- what fits a
//                 deck built from these aspects).
//   - "exact"  -- the card's own aspect set equals the selection exactly.
// Single-aspect selections make Within and Exact collapse to the same
// mono-<aspect> result -- expected, not a bug (issue #306).
export type AspectMatchMode = "any" | "within" | "exact";

export const ASPECT_MATCH_MODES: AspectMatchMode[] = ["any", "within", "exact"];

// BL-130: Exact is the default -- a deliberate owner call (2026-07-14,
// issue #306) that changes the out-of-the-box matching behavior away from
// the historical Any/OR default. See SWU_Application_Spec.md §5.6.
export const DEFAULT_ASPECT_MODE: AspectMatchMode = "exact";

export const TYPE_OPTIONS = ["Leader", "Base", "Unit", "Event", "Upgrade"];

// swuapi stores rarity as full words (confirmed against the live API:
// Common / Uncommon / Rare / Legendary / Special) — NOT single-letter codes.
// These option values must match `card.rarity` exactly or the filter never
// matches and (post-BL-70) faceting hides every option. Ordered common→special.
export const RARITY_OPTIONS = ["Common", "Uncommon", "Rare", "Legendary", "Special"];

export const ARENA_OPTIONS = ["Ground", "Space"];

export const COST_MAX = 15;
export const POWER_MAX = 12;
export const HP_MAX = 35;

// ── FilterState type ──────────────────────────────────────────────────────

export interface FilterState {
  search: string;
  aspects: Set<string>;
  // BL-130: how `aspects` is evaluated against a card's own aspect set --
  // see AspectMatchMode above. Independent of the selection itself, but
  // inert (no observable effect) while `aspects` is empty, same as every
  // other facet's "empty = unfiltered" rule (BL-90).
  aspectMode: AspectMatchMode;
  set: Set<string>;
  type: Set<string>;
  rarity: Set<string>;
  finish: Set<string>;
  keyword: Set<string>;
  trait: Set<string>;
  arena: Set<string>;
  costRange: [number, number];
  powerRange: [number, number];
  hpRange: [number, number];
}

export const DEFAULT_FILTERS: FilterState = {
  search: "",
  // BL-90: empty = unfiltered, matching every other facet. Previously this
  // defaulted to `new Set(ASPECT_LIST)` (all-selected == unfiltered), the
  // only facet with inverted semantics -- that special case made an empty
  // selection match zero cards (aspectless cards failed a hard length
  // check, aspected cards failed `some()` on an empty set), so the panel
  // snapped a deselect-all back to all-selected and no reachable state
  // could show only aspectless cards. See applyFilters below.
  aspects: new Set(),
  // BL-130: Exact is the owner-locked default (issue #306) -- see
  // AspectMatchMode/DEFAULT_ASPECT_MODE above.
  aspectMode: DEFAULT_ASPECT_MODE,
  set: new Set(),
  type: new Set(),
  rarity: new Set(),
  finish: new Set(),
  keyword: new Set(),
  trait: new Set(),
  arena: new Set(),
  costRange: [0, COST_MAX],
  powerRange: [0, POWER_MAX],
  hpRange: [0, HP_MAX],
};

// ── isDefaultFilterState (BL-91) ────────────────────────────────────────────
//
// Deep-compares `filters` against `DEFAULT_FILTERS` field-by-field: `Set`
// fields need value comparison (two different `Set` instances holding the
// same members must count as equal, and `===` on Sets never does that), and
// the range tuples need element comparison for the same reason. Exported
// (rather than kept private to FilterPanel) so it's unit-testable on its own
// and reusable anywhere else a "filters are active" signal is needed.

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function rangeEqual(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function isDefaultFilterState(filters: FilterState): boolean {
  return (
    filters.search === DEFAULT_FILTERS.search &&
    setsEqual(filters.aspects, DEFAULT_FILTERS.aspects) &&
    // BL-130: the matching mode is a genuine FilterState field now -- Reset
    // restores it to Exact even when `aspects` is already empty (a changed
    // mode with no active selection is inert but still non-default state).
    filters.aspectMode === DEFAULT_FILTERS.aspectMode &&
    setsEqual(filters.set, DEFAULT_FILTERS.set) &&
    setsEqual(filters.type, DEFAULT_FILTERS.type) &&
    setsEqual(filters.rarity, DEFAULT_FILTERS.rarity) &&
    setsEqual(filters.finish, DEFAULT_FILTERS.finish) &&
    setsEqual(filters.keyword, DEFAULT_FILTERS.keyword) &&
    setsEqual(filters.trait, DEFAULT_FILTERS.trait) &&
    setsEqual(filters.arena, DEFAULT_FILTERS.arena) &&
    rangeEqual(filters.costRange, DEFAULT_FILTERS.costRange) &&
    rangeEqual(filters.powerRange, DEFAULT_FILTERS.powerRange) &&
    rangeEqual(filters.hpRange, DEFAULT_FILTERS.hpRange)
  );
}

// ── matchesAspectMode (BL-130) ──────────────────────────────────────────────
//
// `cardAspects` is a card's *effective* aspect representation -- its real
// aspects, or the single-element [NO_ASPECT] sentinel for an aspectless
// card (never both; a card is either aspectless or carries 1+ real
// aspects). `selected` is the current aspect facet selection, which may
// freely mix real aspect names with NO_ASPECT. No mode-specific special
// casing is needed for NO_ASPECT: because a card's effective set never
// mixes the sentinel with real values, plain set comparison already
// produces the right answer everywhere, including the edge case of an
// Exact selection that mixes a real aspect with NO_ASPECT (no card's
// effective set can ever equal that combination, so nothing matches --
// consistent with Exact's definition, not a bolted-on rule).
//
// An empty `selected` always matches (BL-90: unfiltered), independent of
// mode -- every mode's own comparison would otherwise reject everything
// against an empty set (no intersection, nothing is "within" nothing
// non-empty, nothing equals empty), so this is a real branch, not a no-op.
function matchesAspectMode(
  cardAspects: string[],
  selected: Set<string>,
  mode: AspectMatchMode
): boolean {
  if (selected.size === 0) return true;
  switch (mode) {
    case "any":
      return cardAspects.some((a) => selected.has(a));
    case "within":
      return cardAspects.every((a) => selected.has(a));
    case "exact":
      return cardAspects.length === selected.size && cardAspects.every((a) => selected.has(a));
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

// ── applyFilters ──────────────────────────────────────────────────────────

export function applyFilters(cards: BaseCard[], filters: FilterState): BaseCard[] {
  const q = filters.search.trim().toLowerCase();
  const costNarrowed = filters.costRange[0] !== 0 || filters.costRange[1] !== COST_MAX;
  const powerNarrowed = filters.powerRange[0] !== 0 || filters.powerRange[1] !== POWER_MAX;
  const hpNarrowed = filters.hpRange[0] !== 0 || filters.hpRange[1] !== HP_MAX;

  const hasAnyOf = (set: Set<string>, values: string[]) =>
    set.size === 0 || values.some((v) => set.has(v));

  return cards.filter((card) => {
    if (q) {
      const { displayName, subtitle } = parseCardDisplay(card);
      const hay = `${displayName} ${subtitle ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    // BL-90 x BL-130: an empty filters.aspects means unfiltered (all pass)
    // in every mode -- BL-90's empty-selection semantics hold constant
    // across all three matching modes. A non-empty selection is evaluated
    // against the card's effective aspect set (real aspects, or [NO_ASPECT]
    // for an aspectless card -- same representation FIELD_EXTRACTORS.aspects
    // uses) per the active mode. See matchesAspectMode below.
    if (
      !matchesAspectMode(
        card.aspects.length === 0 ? [NO_ASPECT] : card.aspects,
        filters.aspects,
        filters.aspectMode
      )
    )
      return false;

    if (filters.set.size) {
      const matchesSet =
        filters.set.has(card.set_code) ||
        card.variants.some((v) => filters.set.has(v.source_set_code));
      if (!matchesSet) return false;
    }
    if (filters.type.size && !filters.type.has(card.type)) return false;
    if (filters.rarity.size && !filters.rarity.has(card.rarity)) return false;

    if (filters.finish.size) {
      const hasFinish = card.variants.some((v) => filters.finish.has(v.finish ?? v.variant_type));
      if (!hasFinish) return false;
    }

    if (filters.keyword.size && !hasAnyOf(filters.keyword, card.keywords)) return false;
    if (filters.trait.size && !hasAnyOf(filters.trait, card.traits)) return false;

    if (filters.arena.size && !(card.arena && filters.arena.has(card.arena))) return false;

    if (costNarrowed) {
      if (card.cost == null) return false;
      if (card.cost < filters.costRange[0] || card.cost > filters.costRange[1]) return false;
    }
    if (powerNarrowed) {
      if (card.power == null) return false;
      if (card.power < filters.powerRange[0] || card.power > filters.powerRange[1]) return false;
    }
    if (hpNarrowed) {
      if (card.hp == null) return false;
      if (card.hp < filters.hpRange[0] || card.hp > filters.hpRange[1]) return false;
    }

    return true;
  });
}

// ── Option helpers ────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  /** BL-70: set once a facet computation determines this value can't add
   * anything given the other active filters/toggles. Rendered greyed +
   * "(0)"-suffixed and (unless already selected) not clickable -- see
   * `facetedOptions` below. */
  inert?: boolean;
  /** BL-129 R6b: originally set on the Finish dropdown's pinned subset so
   * MultiSelect.tsx could draw a pinned/alphabetized divider. BL-133 moved
   * Finish to its own two-tier tree (FinishFilter.tsx, buildFinishTree/
   * shapeFinishTree below) with its own `pinned` concept on `FinishTreeRow`
   * -- no current caller sets this field anymore, but it's left in place
   * (harmless, MultiSelect still reads it as a no-op) rather than touched,
   * per BL-133's Finish-dropdown-only scope. */
  pinned?: boolean;
}

export function normOpt(opt: string | SelectOption): SelectOption {
  return typeof opt === "string" ? { value: opt, label: opt } : opt;
}

export function distinctMulti(cards: BaseCard[], field: "keywords" | "traits"): string[] {
  const out = new Set<string>();
  cards.forEach((c) => c[field].forEach((v) => out.add(v)));
  return [...out].sort();
}

// ── Finish filter -- two-tier tree (BL-133, issue #318) ────────────────────
//
// BL-129/R6b's flat `distinctFinishes` (pinned SelectOption[] + a single
// pinned/alphabetized divider, rendered by the generic MultiSelect) is
// superseded by the block below. The Finish universe grew to 58 distinct raw
// values (8 named finishes + ~50 promo/tournament variant_types) -- too many
// for a flat list. This reshapes the SAME raw-value universe (still
// `v.finish ?? v.variant_type`, still matched by `applyFilters`/
// `FIELD_EXTRACTORS.finish` completely unchanged -- FilterState.finish stays
// a flat Set<string> of raw values, see the type above) into a two-tier tree
// for FinishFilter.tsx to render: pair rows (fused foil/non-foil toggle
// chips), group rows (expandable tournament/prestige families), and plain
// rows (everything else) -- ordered per the locked design. Every
// classification is RULE driven (regex prefix/suffix, twin-presence), not a
// hardcoded member list, so a new promo/tournament/prestige value slots in
// automatically the next time the catalog refreshes.

export interface FinishChildOption {
  /** Full raw finish value -- what FilterState.finish/applyFilters use. */
  value: string;
  /** Prefix/suffix-stripped display text (e.g. "PQ Top 8" -> "Top 8"). */
  displayLabel: string;
}

interface FinishPlainRow {
  kind: "plain";
  key: string;
  value: string;
  label: string;
  pinned: boolean;
}

interface FinishPairRow {
  kind: "pair";
  key: string;
  label: string;
  baseValue: string;
  foilValue: string;
  pinned: boolean;
}

interface FinishGroupRow {
  kind: "group";
  key: string;
  label: string;
  children: FinishChildOption[];
  pinned: boolean;
}

export type FinishTreeRow = FinishPlainRow | FinishPairRow | FinishGroupRow;

/** Tournament-prefix -> group label (grouping rule, issue #318). A future
 * prefixed value needs a new prefix added here to gain its own group -- an
 * unrecognized prefix falls through to the pair/plain path and, since it
 * won't match any FINISH_TOP_LEVEL_ORDER key either, lands in the
 * alphabetized tail as a plain row (visible, not silently dropped). */
const TOURNAMENT_PREFIX_LABELS: Record<string, string> = {
  GC: "Galactic Championship",
  RQ: "Regional Qualifier",
  SQ: "Sector Qualifier",
  PQ: "Planetary Qualifier",
  SS: "Store Showdown",
};
const TOURNAMENT_PREFIX_RE = /^(GC|RQ|SQ|PQ|SS) (.+)$/;
const PRESTIGE_SUFFIX_RE = /^(.+) Prestige$/;
const PRESTIGE_GROUP_LABEL = "Prestige";

/** Acquisition-ladder order for tournament group children (issue #318,
 * Jeremy's ladder). A child whose display label isn't on the ladder (a
 * future rung) sorts after every known rung, alphabetized among any other
 * unknowns -- never dropped. */
const TOURNAMENT_LADDER = [
  "Event Pack",
  "Prize Wall",
  "VIP Promo",
  "Participation",
  "Day Two",
  "Day Three",
  "Top 64",
  "Top 16",
  "Top 8",
  "Top 4",
  "Finalist",
  "Champion",
  "Judge",
];

/** Prestige's 3 known children, in the locked order; a future prestige
 * variant (e.g. a color) alphabetizes after them via the same tail rule. */
const PRESTIGE_LADDER = ["Standard", "Foil", "Serialized"];

function sortGroupChildren(children: FinishChildOption[], ladder: string[]): FinishChildOption[] {
  const rank = new Map(ladder.map((label, i) => [label, i]));
  const known = children
    .filter((c) => rank.has(c.displayLabel))
    .sort((a, b) => rank.get(a.displayLabel)! - rank.get(b.displayLabel)!);
  const unknown = children
    .filter((c) => !rank.has(c.displayLabel))
    .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel));
  return [...known, ...unknown];
}

/** Explicit top-level order (issue #318): the first `FINISH_PINNED_COUNT`
 * keys are the pinned section; the rest render below the pinned/alphabetized
 * divider in this literal order (not alphabetical). A key here may resolve
 * to a pair row (Standard/Hyperspace/Weekly Play, if their Foil twin is also
 * present), a plain row (Showcase, Convention Exclusive, ... whenever
 * pairing/grouping don't claim them), or a group row (Prestige + the 5
 * tournament families, built by the suffix/prefix rules above) --
 * FINISH_TOP_LEVEL_ORDER only fixes WHERE each key sits; buildFinishTree
 * decides WHAT it is from the actual data. Any key present in the data but
 * absent from this list is a genuinely new top-level value -- it appends
 * after these, alphabetized, so it's visible instead of silently swallowed
 * until someone slots it in deliberately. */
const FINISH_TOP_LEVEL_ORDER = [
  "Standard",
  "Hyperspace",
  "Showcase",
  PRESTIGE_GROUP_LABEL,
  "Weekly Play",
  "Convention Exclusive",
  "Event Exclusive",
  "Galactic Championship",
  "Regional Qualifier",
  "Sector Qualifier",
  "Planetary Qualifier",
  "Store Showdown",
  "Prerelease Promo",
  "Judge Program",
  "Prerelease Judge",
  "Movie Promo",
];
const FINISH_PINNED_COUNT = 5;

/** Builds the Finish filter's two-tier tree from the full raw-value universe
 * (same extraction the old `distinctFinishes` used: `v.finish ??
 * v.variant_type` over every card/variant passed in -- unfiltered by facets).
 * Pure/rule-driven per issue #318 -- see the constants above for the actual
 * grouping/pairing/ordering rules; this function just applies them. Faceting
 * (BL-70) is intentionally NOT applied here -- `shapeFinishTree` below does
 * that against this tree's fixed shape, keeping "what exists" and "what's
 * currently valid" as separate concerns (mirrors every other field's
 * `distinctX(cards)` vs `facetValidValues`/`facetedOptions` split). */
export function buildFinishTree(cards: BaseCard[]): FinishTreeRow[] {
  const universe = new Set<string>();
  cards.forEach((c) => c.variants.forEach((v) => universe.add(v.finish ?? v.variant_type)));

  const groupChildren = new Map<string, FinishChildOption[]>();
  const remaining = new Set(universe);

  for (const value of universe) {
    const tournamentMatch = value.match(TOURNAMENT_PREFIX_RE);
    if (tournamentMatch) {
      const label = TOURNAMENT_PREFIX_LABELS[tournamentMatch[1]];
      const list = groupChildren.get(label) ?? [];
      list.push({ value, displayLabel: tournamentMatch[2] });
      groupChildren.set(label, list);
      remaining.delete(value);
      continue;
    }
    const prestigeMatch = value.match(PRESTIGE_SUFFIX_RE);
    if (prestigeMatch) {
      const list = groupChildren.get(PRESTIGE_GROUP_LABEL) ?? [];
      list.push({ value, displayLabel: prestigeMatch[1] });
      groupChildren.set(PRESTIGE_GROUP_LABEL, list);
      remaining.delete(value);
    }
  }

  // Pair fusion (issue #318): rule-based over whatever's left after
  // grouping, so a future "Showcase Foil" auto-fuses onto "Showcase" with no
  // code change. A twin that isn't present in the universe at all just means
  // no pair forms -- the lone side falls through to the plain-row loop below.
  // That's the SAME degrade-to-plain-row `shapeFinishTree` uses for the
  // facet-time single-chip case -- one rule, two call sites (build-time
  // universe absence vs. render-time facet invalidity), deliberately (see
  // PR/report).
  const rows = new Map<string, FinishTreeRow>();
  const bases = [...remaining].filter((v) => !v.endsWith(" Foil")).sort();
  for (const base of bases) {
    const foilValue = `${base} Foil`;
    if (remaining.has(foilValue)) {
      rows.set(base, {
        kind: "pair",
        key: base,
        label: base,
        baseValue: base,
        foilValue,
        pinned: false,
      });
      remaining.delete(base);
      remaining.delete(foilValue);
    }
  }
  for (const value of remaining) {
    rows.set(value, { kind: "plain", key: value, value, label: value, pinned: false });
  }
  for (const [label, children] of groupChildren) {
    const ladder = label === PRESTIGE_GROUP_LABEL ? PRESTIGE_LADDER : TOURNAMENT_LADDER;
    rows.set(label, {
      kind: "group",
      key: label,
      label,
      children: sortGroupChildren(children, ladder),
      pinned: false,
    });
  }

  const ordered: FinishTreeRow[] = [];
  FINISH_TOP_LEVEL_ORDER.forEach((key, i) => {
    const row = rows.get(key);
    if (!row) return;
    ordered.push({ ...row, pinned: i < FINISH_PINNED_COUNT });
    rows.delete(key);
  });
  const leftover = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
  ordered.push(...leftover);

  return ordered;
}

export interface ShapedFinishValue {
  value: string;
  checked: boolean;
  inert: boolean;
}

export interface ShapedFinishChild extends ShapedFinishValue {
  displayLabel: string;
}

interface ShapedPlainRow {
  kind: "plain";
  key: string;
  value: string;
  label: string;
  checked: boolean;
  inert: boolean;
  pinned: boolean;
}

interface ShapedPairRow {
  kind: "pair";
  key: string;
  label: string;
  base: ShapedFinishValue | null;
  foil: ShapedFinishValue | null;
  pinned: boolean;
}

interface ShapedGroupRow {
  kind: "group";
  key: string;
  label: string;
  children: ShapedFinishChild[];
  selectedCount: number;
  allInert: boolean;
  pinned: boolean;
}

export type ShapedFinishRow = ShapedPlainRow | ShapedPairRow | ShapedGroupRow;

function shapeValue(
  value: string,
  valid: Set<string> | null,
  selected: Set<string>,
  showAllValues: boolean
): ShapedFinishValue | null {
  const isValid = valid === null || valid.has(value);
  const checked = selected.has(value);
  // BL-70 parity: hide only when invalid, unselected, and show-all is off --
  // a selected value is NEVER hidden here (removable, not silently dropped),
  // same invariant `facetedOptions` enforces for every other field.
  if (!isValid && !checked && !showAllValues) return null;
  return { value, checked, inert: !isValid };
}

/** Applies BL-70 faceting to `buildFinishTree`'s fixed tree, per leaf value:
 * a plain row's own value, a pair row's base/foil independently, a group
 * row's children independently. A leaf that's invalid, unselected, and
 * show-all is off is dropped -- for a pair row that degrades it to a single
 * chip (chose this over collapsing the row to "plain" -- keeps the row's
 * `kind` stable regardless of the live facet state, see report); if BOTH
 * sides drop, the row is omitted entirely. A group row whose children all
 * drop is omitted the same way `facetedOptions` omits an all-invalid
 * unselected option today. */
export function shapeFinishTree(
  tree: FinishTreeRow[],
  valid: Set<string> | null,
  selected: Set<string>,
  showAllValues: boolean
): ShapedFinishRow[] {
  const out: ShapedFinishRow[] = [];
  for (const row of tree) {
    if (row.kind === "plain") {
      const shaped = shapeValue(row.value, valid, selected, showAllValues);
      if (!shaped) continue;
      out.push({
        kind: "plain",
        key: row.key,
        value: row.value,
        label: row.label,
        checked: shaped.checked,
        inert: shaped.inert,
        pinned: row.pinned,
      });
      continue;
    }
    if (row.kind === "pair") {
      const base = shapeValue(row.baseValue, valid, selected, showAllValues);
      const foil = shapeValue(row.foilValue, valid, selected, showAllValues);
      if (!base && !foil) continue;
      out.push({ kind: "pair", key: row.key, label: row.label, base, foil, pinned: row.pinned });
      continue;
    }
    // group
    const children: ShapedFinishChild[] = [];
    for (const child of row.children) {
      const shaped = shapeValue(child.value, valid, selected, showAllValues);
      if (!shaped) continue;
      children.push({ ...shaped, displayLabel: child.displayLabel });
    }
    if (children.length === 0) continue;
    out.push({
      kind: "group",
      key: row.key,
      label: row.label,
      children,
      selectedCount: children.filter((c) => c.checked).length,
      allInert: children.every((c) => c.inert),
      pinned: row.pinned,
    });
  }
  return out;
}

// ── Faceting (BL-70) ───────────────────────────────────────────────────────
//
// Every faceted field below shares one shape in FilterState: a bare
// `Set<string>` that defaults empty ("no restriction"). That means "ignore
// this field's own selection" is just "swap it back to an empty Set" -- no
// per-field default lookup needed. `facetValidValues` reuses `applyFilters`
// itself (with the target field reset) as the single source of truth for
// "what passes," so faceting can't drift from matching logic.
//
// BL-90: `aspects` now shares this shape too (empty default, standard
// any-of matching), so it participates in faceting exactly like every
// other field -- no special-casing needed for the "No Aspect" pseudo-value
// either, since FIELD_EXTRACTORS maps an aspectless card to [NO_ASPECT]
// just as applyFilters does.
//
// BL-130: no signature change was needed to make faceting mode-aware.
// `facetValidValues` spreads the caller's full `filters` (including
// `aspectMode`) into `otherFilters`, and `applyFilters` already reads
// `filters.aspectMode` -- so a *different* field's facet computation (e.g.
// "what Set values remain valid") automatically evaluates the active
// aspect selection through the active mode. Faceting `"aspects"` itself
// still resets `aspects` to empty (the standard dead-end-prevention rule),
// which makes the mode a no-op for that one computation by the same
// empty-selection invariant matchesAspectMode relies on elsewhere --
// consistent, not a gap: per-value "would adding this under Exact leave a
// dead end" analysis is a different, combinatorial question BL-130 doesn't
// ask for (Exact's non-monotonicity means a growing same-field selection
// can shrink its own result set, unlike every OR-shaped field faceting
// already assumes).

export type FacetField =
  "aspects" | "set" | "type" | "rarity" | "finish" | "keyword" | "trait" | "arena";

export const FIELD_EXTRACTORS: Record<FacetField, (card: BaseCard) => string[]> = {
  aspects: (c) => (c.aspects.length === 0 ? [NO_ASPECT] : c.aspects),
  set: (c) => [c.set_code, ...c.variants.map((v) => v.source_set_code)],
  type: (c) => [c.type],
  rarity: (c) => [c.rarity],
  finish: (c) => c.variants.map((v) => v.finish ?? v.variant_type),
  keyword: (c) => c.keywords,
  trait: (c) => c.traits,
  arena: (c) => (c.arena ? [c.arena] : []),
};

/** Dead-end-prevention rule (BL-70): the values `field` could still add,
 * given every *other* active filter but ignoring `field`'s own selection.
 * Returns `null` when `cards` is empty -- an empty base list (no data
 * loaded yet, or a toggle-narrowed set of zero) means "nothing to facet
 * against," so callers should treat that as "no restriction" rather than
 * hiding every option. */
export function facetValidValues(
  cards: BaseCard[],
  filters: FilterState,
  field: FacetField
): Set<string> | null {
  if (cards.length === 0) return null;
  const otherFilters: FilterState = { ...filters, [field]: new Set<string>() };
  const passing = applyFilters(cards, otherFilters);
  const valid = new Set<string>();
  passing.forEach((c) => FIELD_EXTRACTORS[field](c).forEach((v) => valid.add(v)));
  return valid;
}

/** Combines a field's full "universe" of options with its current facet
 * validity into what the dropdown should render:
 * - valid values always show, normally.
 * - already-selected values always show, even if now invalid -- flagged
 *   `inert` (greyed, "(0)", still removable) instead of silently dropped.
 *   This covers both the multi-select OR case (keywords/traits) and the
 *   single-select dead-end case uniformly.
 * - other invalid values are hidden unless `showAllValues` is on, in which
 *   case they appear disabled/greyed alongside the valid ones.
 * `valid === null` (see `facetValidValues`) means "don't restrict" -- every
 * universe option renders normally. */
export function facetedOptions(
  universe: (string | SelectOption)[],
  valid: Set<string> | null,
  selected: Set<string>,
  showAllValues: boolean
): SelectOption[] {
  return universe
    .map(normOpt)
    .filter((o) => valid === null || showAllValues || valid.has(o.value) || selected.has(o.value))
    .map((o) => {
      const isValid = valid === null || valid.has(o.value);
      // BL-129 R6b: `pinned` carries through unchanged on both branches --
      // the valid branch returns `o` as-is (already has it), the inert
      // branch spreads it explicitly so a faceted-out-but-still-selected
      // pinned Finish value keeps its divider placement instead of silently
      // losing the flag.
      return isValid
        ? o
        : { value: o.value, label: `${o.label} (0)`, inert: true, pinned: o.pinned };
    });
}
