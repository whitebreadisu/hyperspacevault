// BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): pure completion-panel
// math -- the four block metrics (Playset complete %, Set complete %,
// Cards, Collection value) and their per-base-set breakdown rows, extracted
// from InventorySummary.tsx so the calc rules are independently unit
// testable (CLAUDE.md's test-disposition policy expects direct coverage of
// calc rules, not just DOM assertions).
//
// Universe rules (owner-locked 2026-07-26):
//   - Tokens are excluded from every metric (pre-existing rule, kept).
//   - The two completion PERCENTAGES are scoped to base cards whose home
//     set (`card.set_code`) is one of the ten base sets (`baseSetCodes`,
//     built from GET /api/sets' `is_base_set` flag). An "orphan" base card
//     (its only printing lives in a non-base container set -- the known
//     case is Zam's root in C26) is excluded from both percentages.
//   - Cards and Collection value are NOT set-scoped -- every non-token card
//     counts, orphans included. In practice this already covers nearly the
//     whole catalog: only a handful of orphan base cards live outside the
//     ten base sets at all (see BASE_SET_CODES's docstring,
//     swuapi_transform.py) -- everything else's home set_code already IS a
//     base set, TS26-deck reprints included (a reprint's home set is its
//     ORIGINAL set, not TS26 -- it's a separate base_card row already
//     correctly attributed, no extra logic needed here).
//   - The per-set "by set" breakdown groups by `card.set_code` (home set)
//     for exactly the same reason -- a card's home set is always its
//     correct attribution, TS26 reprints included.

import { cardOwnedTotal, isOwned, isPlaysetComplete } from "./inventory";
import type { InventoryCard, InventoryVariant } from "./inventory";

export type PriceMode = "market" | "low";

export interface SetMeta {
  code: string;
  name: string;
}

function nonToken(cards: InventoryCard[]): InventoryCard[] {
  return cards.filter((c) => !c.is_token);
}

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

function variantPrice(v: InventoryVariant, mode: PriceMode): number | null {
  if (v.price == null) return null;
  const value = mode === "market" ? v.price.market : v.price.low;
  return value ?? null;
}

/** Definition §3: per owned copy, that variant's own price (active mode) ×
 * its owned quantity; a variant with no price of its own falls back to the
 * card's own Standard-variant price (same mode); neither priced -> the
 * copy contributes $0 and the OWNED VARIANT (not each copy) counts once
 * toward "unpriced" -- mirrors CardPopup's rail-footer "(N unpriced)"
 * convention (counts distinct unpriced items, not raw quantity). */
export function cardValue(
  card: InventoryCard,
  mode: PriceMode
): { value: number; unpriced: number } {
  const standard = card.variants.find((v) => v.variant_type === "Standard");
  const standardPrice = standard ? variantPrice(standard, mode) : null;

  let value = 0;
  let unpriced = 0;
  for (const v of card.variants) {
    const qty = v.quantity || 0;
    if (qty <= 0) continue;
    const effective = variantPrice(v, mode) ?? standardPrice;
    if (effective == null) {
      unpriced += 1;
    } else {
      value += effective * qty;
    }
  }
  return { value, unpriced };
}

export interface ValueTotals {
  value: number;
  unpricedCount: number;
}

/** Sums cardValue across every non-token card in `cards` -- callers pass
 * whichever scope (filtered/all, or one set's slice) they need totaled. */
export function totalValue(cards: InventoryCard[], mode: PriceMode): ValueTotals {
  let value = 0;
  let unpricedCount = 0;
  for (const card of nonToken(cards)) {
    const result = cardValue(card, mode);
    value += result.value;
    unpricedCount += result.unpriced;
  }
  return { value, unpricedCount };
}

export interface CardCounts {
  totalCopies: number;
  uniqueOwned: number;
}

/** "Cards" block math: total owned copies (summed across every variant of
 * every non-token card) and the count of distinct cards with >=1 owned
 * copy ("N unique"). Not base-set-scoped -- see the file header. */
export function cardCounts(cards: InventoryCard[]): CardCounts {
  const cardsInScope = nonToken(cards);
  return {
    totalCopies: cardsInScope.reduce((sum, c) => sum + cardOwnedTotal(c.inventory), 0),
    uniqueOwned: cardsInScope.filter((c) => isOwned(c.inventory)).length,
  };
}

export interface CompletionPercents {
  universeSize: number;
  playsetPct: number;
  setPct: number;
}

/** Playset/Set complete % math, scoped to `baseSetCodes` -- see the file
 * header for the orphan-exclusion rule. */
export function completionPercents(
  cards: InventoryCard[],
  baseSetCodes: Set<string>
): CompletionPercents {
  const universe = nonToken(cards).filter((c) => baseSetCodes.has(c.set_code));
  const playsetComplete = universe.filter((c) => isPlaysetComplete(c.inventory, c.type)).length;
  const owned = universe.filter((c) => isOwned(c.inventory)).length;
  return {
    universeSize: universe.length,
    playsetPct: pct(playsetComplete, universe.length),
    setPct: pct(owned, universe.length),
  };
}

export interface PanelMetrics extends CompletionPercents, CardCounts, ValueTotals {}

/** All four header-block metrics in one pass over `cards` (the active
 * scope -- Filtered or All, per the scope toggle). */
export function computePanelMetrics(
  cards: InventoryCard[],
  baseSetCodes: Set<string>,
  mode: PriceMode
): PanelMetrics {
  return {
    ...completionPercents(cards, baseSetCodes),
    ...cardCounts(cards),
    ...totalValue(cards, mode),
  };
}

export interface SetBreakdownRow extends SetMeta {
  universeSize: number;
  playsetPct: number;
  setPct: number;
  totalCopies: number;
  uniqueOwned: number;
  value: number;
  unpricedCount: number;
}

/** "«metric» by set" popover rows -- one row per entry in `orderedBaseSets`
 * (already release-ordered, see utils/catalog.ts's orderSetCodes), each
 * scoped to `card.set_code === row.code` (a card's home set, per the file
 * header). A base set with zero cards in the current scope still renders
 * its row (0%/0/$0) -- the design's "No base-set cards in scope" empty
 * state is for when `orderedBaseSets` itself is empty (sets not loaded
 * yet), not for an individual zero-count set. */
export function buildSetBreakdown(
  cards: InventoryCard[],
  orderedBaseSets: SetMeta[],
  mode: PriceMode
): SetBreakdownRow[] {
  const bySet = new Map<string, InventoryCard[]>();
  for (const card of nonToken(cards)) {
    const bucket = bySet.get(card.set_code);
    if (bucket) bucket.push(card);
    else bySet.set(card.set_code, [card]);
  }

  return orderedBaseSets.map(({ code, name }) => {
    const inSet = bySet.get(code) ?? [];
    const playsetComplete = inSet.filter((c) => isPlaysetComplete(c.inventory, c.type)).length;
    const owned = inSet.filter((c) => isOwned(c.inventory)).length;
    const { totalCopies, uniqueOwned } = cardCounts(inSet);
    const { value, unpricedCount } = totalValue(inSet, mode);
    return {
      code,
      name,
      universeSize: inSet.length,
      playsetPct: pct(playsetComplete, inSet.length),
      setPct: pct(owned, inSet.length),
      totalCopies,
      uniqueOwned,
      value,
      unpricedCount,
    };
  });
}

export function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
