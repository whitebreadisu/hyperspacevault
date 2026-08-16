// BL-213 (Issue #122, owner-locked design): pure sort logic for the Vault
// table's user-controlled column sorting -- kept out of the components
// (CardsTable.tsx renders headers, CardsPage.tsx owns the session-only
// SortState and feeds the ordered list to both CardsTable and GalleryGrid)
// so the comparator rules are independently unit-testable, the same utils/
// split every other Cards-view calc uses (variantScope.ts, filters.ts,
// completion.ts).
//
// Single active sort at a time, 2-state header cycling (asc/desc -- there is
// NO neutral/unsorted state: `#` ascending IS today's default row order, so
// it's what the table renders on load and what a fresh `#` click returns
// to). Every column's comparator falls back to the row's DEFAULT-ORDER index
// (context.defaultIndex) on a tie -- "ties always fall back to default
// order" (owner spec) -- which also doubles as the exact definition of `#`/
// `Set` ascending, since that IS the default order.

import type { InventoryCard } from "./inventory";
import { getPlaysetSize, cardOwnedTotal } from "./inventory";
import { setReleaseRank, parseCardDisplay } from "./catalog";
import type { SetOrderMap } from "./catalog";
import {
  cardValuePrice,
  cardCollectionValue,
  scopedCardNumber,
  scopedOwnedCount,
} from "./variantScope";
import type { PriceMode, ValueDisplayMode } from "./variantScope";
import { getRarityLabel } from "./variants";

export type SortColumn =
  "number" | "name" | "variants" | "playset" | "value" | "rarity" | "cost" | "power" | "hp" | "set";

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

/** The columns the locked design makes sortable -- Aspect, Type, Trait,
 * Keyword, Arena deliberately carry no sort affordance at all (their headers
 * render with no button/aria-sort). */
export const SORTABLE_COLUMNS: ReadonlySet<SortColumn> = new Set([
  "number",
  "name",
  "variants",
  "playset",
  "value",
  "rarity",
  "cost",
  "power",
  "hp",
  "set",
]);

/** On load -- and whenever nothing else has been picked this session -- the
 * table shows `#` ascending, because `#` ascending IS today's default row
 * order. There is no separate "unsorted" state to represent. Session-only by
 * design (owner spec): this is plain React state in CardsPage, never
 * persisted -- a reload always starts back here. */
export const DEFAULT_SORT_STATE: SortState = { column: "number", direction: "asc" };

/** 2-state header click cycling: a different column always lands on
 * ascending; clicking the ALREADY-active column toggles asc<->desc. Clicking
 * `#` while already on `#` ascending is therefore a no-op that stays exactly
 * on the default order -- the owner spec's explicit "# asc returns the exact
 * default order" case falls out of this rule for free, it isn't a special
 * case here. */
export function nextSortState(current: SortState, clicked: SortColumn): SortState {
  if (current.column === clicked) {
    return { column: clicked, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column: clicked, direction: "asc" };
}

/** `aria-sort` for one header: "none" for a sortable-but-inactive column
 * (per the ARIA authoring practice for sortable columnheaders), "ascending"/
 * "descending" for the active one. Callers never call this for the five
 * non-sortable columns -- those headers carry no `aria-sort` attribute at
 * all, not "none". */
export function ariaSortValue(
  sortState: SortState,
  column: SortColumn
): "ascending" | "descending" | "none" {
  if (sortState.column !== column) return "none";
  return sortState.direction === "asc" ? "ascending" : "descending";
}

export interface SortContext {
  /** Active finish scope (BL-173/BL-187/BL-195), or null for "All variants" --
   * drives the `#` column's scoped card number and the Playset column's
   * scoped owned counts, matching the cells themselves exactly. */
  scope: string | null;
  /** Market/Low kind driving the Value column (CardsPage's `priceKind`). */
  valueMode: PriceMode;
  /** Unit/Collection display mode driving the Value column (CardsPage's
   * `valueDisplay`). */
  unitMode: ValueDisplayMode;
  /** set_code -> release order, feeding the `#`/`Set` columns' set-group
   * comparisons (utils/catalog.ts's setReleaseRank -- the same canonical
   * order sortBaseCards/orderSetCodes already use). */
  setOrder: SetOrderMap;
  /** base_card_id -> the row's position in TODAY's default order (canonical
   * set order, numbers ascending -- the array CardsPage's `cards` memo
   * already produces via sortCardsByScope). This is both the universal
   * tie-break every column falls back to AND the literal definition of `#`/
   * `Set` ascending. */
  defaultIndex: Map<number, number>;
}

const RARITY_RANK: Record<string, number> = {
  Special: 0,
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Legendary: 4,
};

function defaultIndexOf(card: InventoryCard, context: SortContext): number {
  // A card absent from defaultIndex (shouldn't happen -- CardsPage builds it
  // from the same array being sorted) sorts last rather than crashing.
  return context.defaultIndex.get(card.base_card_id) ?? Number.POSITIVE_INFINITY;
}

function compareDefaultOrder(a: InventoryCard, b: InventoryCard, context: SortContext): number {
  return defaultIndexOf(a, context) - defaultIndexOf(b, context);
}

/** set_code group compare, release order ascending -- the same grouping
 * sortBaseCards/orderSetCodes use (utils/catalog.ts). */
function compareSetGroup(a: InventoryCard, b: InventoryCard, context: SortContext): number {
  const [aTier, aKey] = setReleaseRank(a.set_code, context.setOrder);
  const [bTier, bKey] = setReleaseRank(b.set_code, context.setOrder);
  if (aTier !== bTier) return aTier - bTier;
  if (aKey === bKey) return 0;
  return aKey < bKey ? -1 : 1;
}

/** The `#` column's own displayed number (BL-187 scoped card_number when a
 * scope is active and the card carries that finish, else base_card_number) --
 * mirrors CardsTable's own `cardNumber` calc so the sort and the glyph on
 * screen never disagree. */
function cardNumberFor(card: InventoryCard, context: SortContext): string {
  return scopedCardNumber(card.variants, context.scope) ?? card.base_card_number;
}

function compareNumeric(a: number, b: number): number {
  return a - b;
}

/** Name column: case-insensitive alphanumeric on `name`, then subtitle.
 * JUDGMENT CALL: "subtitle" is read via parseCardDisplay (the SAME value the
 * Name cell itself renders) rather than the raw `card.subtitle` field, so a
 * Base with a null `subtitle` (which displays its first trait as a fallback
 * subtitle, parseCardDisplay's own rule) sorts on what's actually on screen
 * rather than on a field the cell doesn't show for that row. The owner spec
 * didn't disambiguate raw-field vs. displayed-value here. */
function compareName(a: InventoryCard, b: InventoryCard): number {
  const nameCompare = a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (nameCompare !== 0) return nameCompare;
  const aSub = parseCardDisplay(a).subtitle ?? "";
  const bSub = parseCardDisplay(b).subtitle ?? "";
  return aSub.localeCompare(bSub, undefined, { numeric: true, sensitivity: "base" });
}

/** The owned-copies count the Playset pips themselves fill from (BL-195's
 * scoped counting, reused verbatim -- not recomputed): scoped owned count
 * while a scope is active, else the card's total owned across all variants.
 * Works identically for a read-only shared-vault viewer (BL-205) -- `card.
 * inventory`/`card.variants[].quantity` already carry the share OWNER's
 * quantities in that context (CardsPage's existing `quantities` merge), zero
 * for every variant when nothing is owned, same as any signed-out/anonymous
 * zero-inventory case. */
function ownedCountFor(card: InventoryCard, context: SortContext): number {
  return context.scope
    ? scopedOwnedCount(card.variants, context.scope)
    : cardOwnedTotal(card.inventory);
}

/** Playset DESCENDING order (complete playsets first): primary key "copies
 * needed to complete the playset" ascending (0 needed = complete, sorts
 * first), secondary key owned-copies count DESCENDING (ties among complete
 * playsets: more owned sorts higher). The owner spec defines ascending as
 * "the exact mirror" of this -- `sortCards` gets that mirror for free by
 * negating this whole comparator for the "asc" direction, rather than this
 * function re-deriving a separate ascending rule that could drift from it. */
function comparePlaysetDescending(
  a: InventoryCard,
  b: InventoryCard,
  context: SortContext
): number {
  const aNeeded = Math.max(getPlaysetSize(a.type) - ownedCountFor(a, context), 0);
  const bNeeded = Math.max(getPlaysetSize(b.type) - ownedCountFor(b, context), 0);
  if (aNeeded !== bNeeded) return aNeeded - bNeeded;
  return ownedCountFor(b, context) - ownedCountFor(a, context);
}

/** The Value column's per-row value under the active toggles -- the SAME
 * computed value the column itself displays (cardValuePrice/
 * cardCollectionValue, utils/variantScope.ts), so switching either toggle
 * while Value is the active sort re-sorts live for free (the memo in
 * CardsPage recomputes whenever priceKind/valueDisplay change). */
function valueFor(card: InventoryCard, context: SortContext): number | null {
  return context.unitMode === "collection"
    ? cardCollectionValue(card.variants, context.scope, context.valueMode)
    : cardValuePrice(card.variants, context.scope, context.valueMode);
}

/** Rarity rank: Special < Common < Uncommon < Rare < Legendary, explicit --
 * never alphabetized. An unrecognized rarity code sorts last rather than
 * crashing or silently colliding with a real rank, the same "still show
 * something" defensive posture RarityBadge's own unrecognized-rarity
 * fallback takes. */
function rarityRankFor(card: InventoryCard): number {
  return RARITY_RANK[getRarityLabel(card.rarity)] ?? Number.POSITIVE_INFINITY;
}

/** Builds the ASCENDING-oriented comparator for one column. The direction
 * flip (for "desc") and the universal default-order tiebreak both live in
 * `sortCards` below, applied uniformly across every column so neither can be
 * forgotten when a new column is added. `number`/`set` are defined directly
 * as the default order here (that IS what their ascending direction means);
 * their "desc" behavior is asymmetric enough (the set GROUP order doesn't
 * simply reverse) that `sortCards` special-cases it instead of calling this
 * function at all for those two directions -- see its own comment. */
/** The nullable-numeric columns (Value + the three stats) get their own
 * branch in `sortCards` (nulls pinned last in both directions, owner
 * revision 2026-08-16), so this builder never sees them. */
type NullableNumericColumn = "cost" | "power" | "hp" | "value";

function ascendingCompareFor(
  column: Exclude<SortColumn, NullableNumericColumn>,
  context: SortContext
): (a: InventoryCard, b: InventoryCard) => number {
  switch (column) {
    case "number":
    case "set":
      return (a, b) => compareDefaultOrder(a, b, context);
    case "name":
      return compareName;
    case "variants":
      return (a, b) => compareNumeric(a.variants.length, b.variants.length);
    case "playset":
      return (a, b) => -comparePlaysetDescending(a, b, context);
    case "rarity":
      return (a, b) => compareNumeric(rarityRankFor(a), rarityRankFor(b));
  }
}

/** Orders `cards` by `sortState`, falling back to `context.defaultIndex` on
 * every tie. Feeds both CardsTable (row order) and GalleryGrid (the Gallery
 * view inherits the same ordering, owner spec) from one call in CardsPage. */
export function sortCards(
  cards: InventoryCard[],
  sortState: SortState,
  context: SortContext
): InventoryCard[] {
  const { column, direction } = sortState;

  let primary: (a: InventoryCard, b: InventoryCard) => number;

  if (column === "cost" || column === "power" || column === "hp" || column === "value") {
    // Owner revision (2026-08-16 review round, supersedes the original
    // "below 0" rule for stats AND Value's em-dash): a null pins to the END
    // in BOTH directions -- an ascending Power/Value sort is a ranking of
    // cards that HAVE the number, so leading with a wall of blanks helps
    // nobody. Two nulls compare equal here, so the universal defaultIndex
    // tiebreak below (which is never direction-flipped) orders the trailing
    // null block in default order, exactly as specified.
    const numericOf =
      column === "value"
        ? (card: InventoryCard) => valueFor(card, context)
        : (card: InventoryCard) => card[column];
    primary = (a, b) => {
      const aNum = numericOf(a);
      const bNum = numericOf(b);
      if (aNum == null || bNum == null) {
        if (aNum == null && bNum == null) return 0;
        return aNum == null ? 1 : -1;
      }
      return direction === "asc" ? aNum - bNum : bNum - aNum;
    };
  } else if (column === "number" && direction === "desc") {
    // "Within each set group, numbers descending; the SET GROUP ORDER STAYS
    // the canonical ascending order -- sets never interleave and never
    // reverse here" (owner spec). Group by canonical set order ascending,
    // then tokens pinned last (owner revision 2026-08-16 -- ascending
    // already pins them via the default order's own tokens-last rule), then
    // the row's own displayed number (BL-187 scope-aware) descending.
    primary = (a, b) =>
      compareSetGroup(a, b, context) ||
      (a.is_token ? 1 : 0) - (b.is_token ? 1 : 0) ||
      -cardNumberFor(a, context).localeCompare(cardNumberFor(b, context), undefined, {
        numeric: true,
      });
  } else if (column === "set" && direction === "desc") {
    // "Descending reverses the SET GROUP order only, with numbers still
    // ASCENDING within each group" (owner spec). Reversing just the group
    // comparison and falling through to the universal defaultIndex tiebreak
    // below reproduces that in-group ascending sub-order (tokens-last,
    // numbers ascending) for free -- defaultIndex IS the default order, and
    // it's monotonic ascending within any one set group.
    primary = (a, b) => -compareSetGroup(a, b, context);
  } else {
    const ascending = ascendingCompareFor(column, context);
    primary = direction === "asc" ? ascending : (a, b) => -ascending(a, b);
  }

  return cards.slice().sort((a, b) => primary(a, b) || compareDefaultOrder(a, b, context));
}
