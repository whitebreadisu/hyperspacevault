// BL-173 (Definition_VariantScope_2026-07-26.md): pure logic for the Cards
// table's variant-scope control (Playset header) + Value column (between
// Playset and Rarity). Kept out of the components (CardsTable.tsx,
// PlaysetCell.tsx, screens/cards/VariantScopeControls.tsx) so the
// scope/price/persistence rules are independently unit-testable, following
// the same utils/ split every other Cards-view calc uses (inventory.ts,
// filters.ts, completion.ts).
//
// Raw finish values here are the SAME universe filters.ts's buildFinishTree
// works from (`v.finish ?? v.variant_type`) -- verified against
// analysis/VariantScope_Finish_Chase_Feasibility_2026-07-26.md's per-value
// table, NOT the Claude Design mock's abbreviated keys (the mock used short
// codes like "Hy" purely for its own demo data object; the real raw values
// are the literal finish/variant_type strings, e.g. "Hyperspace Foil").

import type { InventoryVariant } from "./inventory";
import type { PriceMode } from "./completion";
import type { BaseCard, SetOrderMap } from "./catalog";
import { sortBaseCards, setReleaseRank } from "./catalog";

export type { PriceMode };

// ── Price-kind persistence (Definition §1) ──────────────────────────────────
// Market/Low toggle in the Value header. Market is the default; the choice
// persists across visits via localStorage, following the SAME
// no-repeat-of-last degrade-gracefully shape as utils/headerStarfield.ts's
// applyHeaderStarfield: storage access is best-effort (private-mode/
// storage-denied environments just get the default), and a corrupt/absent
// stored value degrades to "market" rather than throwing. Scope itself is
// NEVER persisted (Definition §1: "transient") -- there is no storage key
// for it anywhere in this file.

const PRICE_KIND_STORAGE_KEY = "swu.cardsValue.kind";

export function loadPriceKind(): PriceMode {
  try {
    const stored = window.localStorage.getItem(PRICE_KIND_STORAGE_KEY);
    return stored === "low" ? "low" : "market";
  } catch {
    /* storage unavailable -- degrade to the default */
    return "market";
  }
}

export function savePriceKind(kind: PriceMode): void {
  try {
    window.localStorage.setItem(PRICE_KIND_STORAGE_KEY, kind);
  } catch {
    /* best-effort, same as headerStarfield's own store */
  }
}

// ── Value display mode: Unit vs Collection (owner request 2026-07-31) ───────
// The Value column header toggles between the unit price of one copy
// (cardValuePrice below, the original semantics) and the value of the
// viewer's OWNED copies of the row's card (cardCollectionValue). Persists
// like MKT/LOW (owner-picked; scope stays transient, this doesn't).

export type ValueDisplayMode = "unit" | "collection";

const VALUE_DISPLAY_STORAGE_KEY = "swu.cardsValue.display";

export function loadValueDisplay(): ValueDisplayMode {
  try {
    const stored = window.localStorage.getItem(VALUE_DISPLAY_STORAGE_KEY);
    return stored === "collection" ? "collection" : "unit";
  } catch {
    return "unit";
  }
}

export function saveValueDisplay(mode: ValueDisplayMode): void {
  try {
    window.localStorage.setItem(VALUE_DISPLAY_STORAGE_KEY, mode);
  } catch {
    /* best-effort */
  }
}

// ── Value column price (Definition §1) ──────────────────────────────────────

/** A single variant's own price for the active kind. `v.price === undefined`
 * (stale pre-BL-163 cached response) and `v.price === null` (a real,
 * priced-nothing variant) both resolve to "no price for this variant" here --
 * the same `== null` fold utils/completion.ts's own `variantPrice` uses --
 * because both cases mean the SAME thing to this function's caller: fall
 * through to whatever fallback applies. Distinguishing the two is a
 * loading-vs-permanent distinction that matters to *callers deciding whether
 * to show a skeleton*, not to the fallback math itself. */
function variantPriceValue(v: Pick<InventoryVariant, "price">, kind: PriceMode): number | null {
  if (v.price == null) return null;
  const value = kind === "market" ? v.price.market : v.price.low;
  return value ?? null;
}

/** The Value column's per-row price: the unit price of ONE copy of the
 * relevant printing (never price × quantity -- owner decision, Definition
 * §1).
 * - Scoped: the scoped variant's own price. `null` if the card carries no
 *   printing of that finish at all, or that printing is unpriced.
 * - Unscoped (`scope === null`, "All variants"): the card's Standard
 *   printing's price; when there is no Standard printing, or it's unpriced,
 *   falls back to the MINIMUM price (active kind) across the card's other
 *   priced printings -- consistent with the app's existing "cheapest =
 *   min-Low-across-variants" policy (recorded micro-decision, Definition
 *   §1). */
export function cardValuePrice(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "price">[],
  scope: string | null,
  kind: PriceMode
): number | null {
  if (scope) {
    const variant = variants.find((v) => (v.finish ?? v.variant_type) === scope);
    return variant ? variantPriceValue(variant, kind) : null;
  }
  const standard = variants.find((v) => v.variant_type === "Standard");
  const standardPrice = standard ? variantPriceValue(standard, kind) : null;
  if (standardPrice != null) return standardPrice;

  let min: number | null = null;
  for (const v of variants) {
    const price = variantPriceValue(v, kind);
    if (price == null) continue;
    if (min == null || price < min) min = price;
  }
  return min;
}

/** The Value column's per-row COLLECTION value (owner request 2026-07-31):
 * what the viewer's owned copies of this card are worth, mirroring the
 * summary panel's Collection-value math (utils/completion.ts cardValue) at
 * row grain so the column visibly decomposes the header block's total.
 * - Unscoped: Σ over owned variants of qty × that variant's own price
 *   (active kind), unpriced variants falling back to the card's Standard
 *   price -- the completion.ts fallback chain exactly.
 * - Scoped: owned quantity OF THE SCOPED FINISH × that finish's own price
 *   (consistent with the scoped pips; deliberately NO fallback, matching
 *   scoped unit mode's no-fallback rule).
 * - `null` (renders as the em-dash) when the viewer owns no copies in
 *   scope, or owns copies but none contributed a price -- a computed $0.00
 *   would misread as "worthless" rather than "unpriced". */
export function cardCollectionValue(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "price" | "quantity">[],
  scope: string | null,
  kind: PriceMode
): number | null {
  if (scope) {
    const qty = scopedOwnedCount(variants, scope);
    if (qty <= 0) return null;
    const variant = variants.find((v) => (v.finish ?? v.variant_type) === scope);
    const price = variant ? variantPriceValue(variant, kind) : null;
    return price == null ? null : price * qty;
  }
  const standard = variants.find((v) => v.variant_type === "Standard");
  const standardPrice = standard ? variantPriceValue(standard, kind) : null;
  let value = 0;
  let priced = false;
  for (const v of variants) {
    const qty = v.quantity || 0;
    if (qty <= 0) continue;
    const effective = variantPriceValue(v, kind) ?? standardPrice;
    if (effective != null) {
      value += effective * qty;
      priced = true;
    }
  }
  return priced ? value : null;
}

/** Em-dash for an unpriced printing -- "same quiet state as the popup rail"
 * (Definition §1). Prices >= $100 render as whole dollars ("$325", not
 * "$325.00") per the owner's mock (VariantScopeMock.jsx's `fmt`) -- the
 * showcase-leader price range is exactly where the cents stop earning their
 * width in the compact 92px column. Deliberately table-only: the popup
 * rail keeps its own always-cents format. */
export function formatCardValue(price: number | null): string {
  if (price == null) return "—";
  return price >= 100 ? `$${Math.round(price)}` : `$${price.toFixed(2)}`;
}

// ── Scoped pips (Definition §1) ─────────────────────────────────────────────

/** Owned copies of ONE finish, summed across every variant of the card that
 * carries it (there's normally exactly one, but this stays total rather than
 * find-first in case a future catalog wrinkle ever produces more than one
 * variant row sharing a raw finish value on the same card). Playset SIZE
 * never changes with scope (Definition §1) -- only which owned count the
 * pips fill from; getPlaysetSize/isPlaysetComplete (utils/inventory.ts) are
 * untouched and still drive the count chip. */
export function scopedOwnedCount(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "quantity">[],
  scope: string
): number {
  return variants
    .filter((v) => (v.finish ?? v.variant_type) === scope)
    .reduce((sum, v) => sum + (v.quantity || 0), 0);
}

/** BL-187 (Definition_VariantNumberSort_2026-08-02.md): the `#` column's
 * scoped card number -- when a scope is active and the card carries a
 * variant matching it, that variant's OWN `card_number` (early sets: e.g.
 * SOR Corellian Freighter Standard is "019", Hyperspace is "508" -- the two
 * finishes are genuinely different printings with different numbers).
 * FIRST match in `variants` order wins (same caveat as `scopedOwnedCount`
 * above -- normally exactly one variant carries a given raw finish, but this
 * stays find-first rather than asserting uniqueness). `null` when `scope` is
 * null (nothing to scope to) or the card has no printing of that finish --
 * either way the caller falls back to `base_card_number`. */
export function scopedCardNumber(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "card_number">[],
  scope: string | null
): string | null {
  if (!scope) return null;
  const variant = variants.find((v) => (v.finish ?? v.variant_type) === scope);
  return variant ? variant.card_number : null;
}

// ── Scoped row order (Definition §1) ────────────────────────────────────────

/** BL-187: the Cards table's row order while a scope is active -- the SAME
 * set-release / tokens-last precedence `sortBaseCards` (utils/catalog.ts)
 * already applies, but the final tiebreak compares the SCOPED variant's
 * `card_number` (via `scopedCardNumber` above) instead of `base_card_number`,
 * so the `#` column and the row order always agree while scoped. A card with
 * no printing of the scoped finish falls back to its own `base_card_number`
 * -- keeps the comparator total/deterministic even though such cards are
 * normally filtered out of view while a scope is engaged (engaging a scope
 * pins `FilterState.finish` to exactly that scope, CardsPage's
 * `handleScopeChange`) -- the array handed to this function can still
 * contain them pre-filter (CardsPage sorts before it filters). `scope ===
 * null` defers entirely to `sortBaseCards` (today's unscoped behavior,
 * unchanged). Same no-mutation contract as `sortBaseCards` -- a fresh array
 * via `slice().sort()`, input untouched. */
export function sortCardsByScope<T extends BaseCard>(
  cards: T[],
  setOrder: SetOrderMap = {},
  scope: string | null = null
): T[] {
  if (!scope) return sortBaseCards(cards, setOrder);

  return cards.slice().sort((a, b) => {
    const [aTier, aKey] = setReleaseRank(a.set_code, setOrder);
    const [bTier, bKey] = setReleaseRank(b.set_code, setOrder);
    if (aTier !== bTier) return aTier - bTier;
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;

    if (a.is_token !== b.is_token) return Number(a.is_token) - Number(b.is_token);

    const aNumber = scopedCardNumber(a.variants, scope) ?? a.base_card_number;
    const bNumber = scopedCardNumber(b.variants, scope) ?? b.base_card_number;
    return aNumber.localeCompare(bNumber, undefined, { numeric: true });
  });
}

// ── Scope <-> Finish-filter interplay (Definition §1) ───────────────────────

/** True iff `finish` is EXACTLY the single-value set a scope pick would have
 * produced (`Set([scope])`). CardsPage's FilterPanel-change wrapper uses this
 * to decide whether a `FilterState.finish` change came from the user editing
 * the Finish dropdown directly (which must disengage the scope, Definition
 * §1: "scope drives filter, never vice versa") versus an unrelated field
 * changing (which leaves `finish` untouched and must NOT disengage it). */
export function isFinishSetScopedTo(finish: Set<string>, scope: string): boolean {
  return finish.size === 1 && finish.has(scope);
}

// ── Scope menu -- Option set C (Definition §2, owner-locked) ────────────────
// 14 scopes + "All variants": the pinned section (3 pair rows + Showcase,
// mirroring buildFinishTree's own pinned rows) plus an expandable "Show all
// finishes…" tail (Prestige's 3-chip group + 4 more plain rows). Values here
// are literal raw finish strings (== the exported variant_type values,
// confirmed 1:1 against the feasibility analysis's per-value table) -- they
// are NOT faceted against the live catalog (the option SET itself is
// owner-locked static config, not data-driven; see Definition §2).

export interface ScopeChip {
  rawValue: string;
  label: string;
}

interface ScopePairRow {
  kind: "pair";
  key: string;
  label: string;
  chips: [ScopeChip, ScopeChip];
}

interface ScopePlainRow {
  kind: "plain";
  key: string;
  rawValue: string;
  label: string;
  note?: string;
}

interface ScopeGroupRow {
  kind: "group";
  key: string;
  label: string;
  chips: ScopeChip[];
}

export type ScopeMenuRow = ScopePairRow | ScopePlainRow | ScopeGroupRow;

/* Round 4 owner revisions to the option set: (1) order mirrors the sidebar
 * Finish filter's pinned order (Standard, Hyperspace, Prestige, Weekly
 * Play -- FINISH_TOP_LEVEL_ORDER minus Showcase); (2) Prestige moved UP
 * from the expander into the core rows; (3) Showcase REMOVED from the
 * picker entirely (a leaders-only playset-1 finish never made sense as a
 * pip scope -- it remains fully reachable via the sidebar Finish filter);
 * (4) the "leaders · playset 1" annotations are dropped. */
export const SCOPE_PINNED_ROWS: ScopeMenuRow[] = [
  {
    kind: "pair",
    key: "Standard",
    label: "Standard",
    chips: [
      { rawValue: "Standard", label: "Non-foil" },
      { rawValue: "Standard Foil", label: "Foil" },
    ],
  },
  {
    kind: "pair",
    key: "Hyperspace",
    label: "Hyperspace",
    chips: [
      { rawValue: "Hyperspace", label: "Non-foil" },
      { rawValue: "Hyperspace Foil", label: "Foil" },
    ],
  },
  {
    kind: "group",
    key: "Prestige",
    label: "Prestige",
    chips: [
      { rawValue: "Standard Prestige", label: "Std" },
      { rawValue: "Foil Prestige", label: "Foil" },
      { rawValue: "Serialized Prestige", label: "Serialized" },
    ],
  },
  {
    kind: "pair",
    key: "Weekly Play",
    label: "Weekly Play",
    chips: [
      { rawValue: "Weekly Play", label: "Non-foil" },
      { rawValue: "Weekly Play Foil", label: "Foil" },
    ],
  },
];

export const SCOPE_EXPANDED_ROWS: ScopeMenuRow[] = [
  {
    kind: "plain",
    key: "Convention Exclusive",
    rawValue: "Convention Exclusive",
    label: "Convention Exclusive",
  },
  { kind: "plain", key: "Event Exclusive", rawValue: "Event Exclusive", label: "Event Exclusive" },
  {
    kind: "plain",
    key: "Prerelease Promo",
    rawValue: "Prerelease Promo",
    label: "Prerelease Promo",
  },
  { kind: "plain", key: "Movie Promo", rawValue: "Movie Promo", label: "Movie Promo" },
];

/* (Round 4 owner call: the menu's footer coverage line -- "Set C — 14
 * scopes / 99.0% of catalog" -- is retired; the constant went with it.) */

/** Header-trigger / bracket-row / amber-tag short display name for a raw
 * scope value (e.g. "PIPS · HS Foil", "Hyperspace Foil · PIPS + VALUE"). */
export const SCOPE_SHORT_NAME: Record<string, string> = {
  Standard: "Standard",
  "Standard Foil": "Std Foil",
  Hyperspace: "Hyperspace",
  "Hyperspace Foil": "HS Foil",
  "Weekly Play": "Weekly Play",
  "Weekly Play Foil": "WP Foil",
  Showcase: "Showcase",
  "Standard Prestige": "Std Prestige",
  "Foil Prestige": "Foil Prestige",
  "Serialized Prestige": "Ser. Prestige",
  "Convention Exclusive": "Conv. Excl.",
  "Event Exclusive": "Event Excl.",
  "Prerelease Promo": "Prerelease",
  "Movie Promo": "Movie Promo",
};

export function scopeShortName(raw: string): string {
  return SCOPE_SHORT_NAME[raw] ?? raw;
}
