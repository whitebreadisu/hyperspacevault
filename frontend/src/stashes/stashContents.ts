import { useMemo } from "react";
import type { Stash, StashMove } from "../api/stashes";
import { parseCardDisplay, setReleaseRank } from "../utils/catalog";
import type { SetOrderMap } from "../utils/catalog";
import { variantPriceValue } from "../utils/completion";
import { getPlaysetSize } from "../utils/inventory";
import type { InventoryCard, InventoryVariant } from "../utils/inventory";
import type { PriceMode } from "../utils/variantScope";
import { getRarityLabel } from "../utils/variants";

// The Stashes page's model (App Spec §26), shared by desktop 1b and phone 1d.
// A stash's contents are printing-level: one row per (variant_id, quantity)
// the stash holds, the card data joined from the catalogue the Vault already
// loads. Values follow the user's Market / Low: a printing with no price of
// its own takes its card's Standard price (the Vault's collection-value
// rule, utils/completion.ts cardValue); neither priced = no value ("—").

/** The Stashes page's copy, both layouts. */
export const STASH_COPY = {
  empty:
    "You have no stashes. A stash records where copies are kept, like a binder or a trade box.",
  zero: (name: string) => `${name} has no copies. Copies go into a stash from a card’s detail.`,
  filtered: "No cards match the current filters.",
  noDescription: "No description",
  loading: "Loading stashes…",
  loadFailed: "Your stashes did not load.",
  staleFailed: "The stash list did not refresh.",
  retry: "Try again",
} as const;

export interface StashPrinting {
  card: InventoryCard;
  variant: InventoryVariant;
  /** Copies of this printing in the stash. */
  qty: number;
}

/** The printing's finish name ("Hyperspace"), as the Vault names it. */
export function finishName(v: InventoryVariant): string {
  return v.finish ?? v.variant_type;
}

/** The printing's own number ("SOR 269"). */
export function printingNumber(v: InventoryVariant): string {
  return `${v.source_set_code} ${v.card_number}`;
}

/** "Luke Skywalker · Standard". */
export function printingLabel(row: StashPrinting): string {
  return `${parseCardDisplay(row.card).displayName} · ${finishName(row.variant)}`;
}

/** One copy's price for the active kind, or null. */
export function unitPrice(row: StashPrinting, mode: PriceMode): number | null {
  const own = variantPriceValue(row.variant, mode);
  if (own != null) return own;
  const standard = row.card.variants.find((v) => v.variant_type === "Standard");
  return standard ? variantPriceValue(standard, mode) : null;
}

/** The row's total (unit × copies), or null when unpriced. */
export function totalPrice(row: StashPrinting, mode: PriceMode): number | null {
  const u = unitPrice(row, mode);
  return u == null ? null : u * row.qty;
}

/** The count chip's class: green at the card's playset (3, leaders and
 * bases 1), muted at 0 (cards.css .playset-chip family). */
export function stashChipClass(qty: number, card: InventoryCard): string {
  if (qty <= 0) return "playset-chip playset-chip--empty";
  return "playset-chip" + (qty >= getPlaysetSize(card.type) ? " playset-chip--complete" : "");
}

/** variant_id -> its card and printing, built once per catalogue. */
export type PrintingIndex = Map<number, { card: InventoryCard; variant: InventoryVariant }>;

export function printingIndex(cards: InventoryCard[]): PrintingIndex {
  const m: PrintingIndex = new Map();
  for (const card of cards)
    for (const variant of card.variants) m.set(variant.variant_id, { card, variant });
  return m;
}

/** The catalogue's printing index, memoised on the card list. */
export function usePrintingIndex(cards: InventoryCard[]): PrintingIndex {
  return useMemo(() => printingIndex(cards), [cards]);
}

/** Join a stash's items to the catalogue (a card list or its index), in the
 * items' order. A printing the catalogue does not carry (it cannot happen
 * for a fresh catalogue) is skipped. */
export function stashPrintings(
  source: InventoryCard[] | PrintingIndex,
  items: StashMove[]
): StashPrinting[] {
  if (items.length === 0) return [];
  const index = Array.isArray(source) ? printingIndex(source) : source;
  const out: StashPrinting[] = [];
  for (const it of items) {
    if (it.quantity <= 0) continue;
    const hit = index.get(it.variant_id);
    if (hit) out.push({ card: hit.card, variant: hit.variant, qty: it.quantity });
  }
  return out;
}

/** Each stash's value (the rail, the phone list): stash id -> value. */
export function stashValues(
  index: PrintingIndex,
  stashes: Stash[],
  itemsOf: (id: number) => StashMove[],
  mode: PriceMode
): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of stashes)
    m.set(s.id, stashTotals(stashPrintings(index, itemsOf(s.id)), mode).value);
  return m;
}

/** stashValues, memoised on the index, the stash list, its items and the kind. */
export function useStashValues(
  index: PrintingIndex,
  ctx: { stashes: Stash[]; itemsOf: (id: number) => StashMove[] },
  mode: PriceMode
): Map<number, number> {
  const { stashes, itemsOf } = ctx;
  return useMemo(() => stashValues(index, stashes, itemsOf, mode), [index, stashes, itemsOf, mode]);
}

/** The Vault's filters applied to the pane: a row stays when its card is in
 * the Vault's narrowed list and, while a Finish facet is set, its printing
 * carries one of the chosen finishes. */
export function narrowPrintings(
  rows: StashPrinting[],
  list: InventoryCard[],
  finishes: Set<string>
): StashPrinting[] {
  const keep = new Set(list.map((c) => c.base_card_id));
  return rows.filter(
    (r) =>
      keep.has(r.card.base_card_id) && (finishes.size === 0 || finishes.has(finishName(r.variant)))
  );
}

/** Copies and value over some rows. Unpriced copies add nothing. */
export function stashTotals(
  rows: StashPrinting[],
  mode: PriceMode
): { copies: number; value: number } {
  let copies = 0;
  let value = 0;
  for (const r of rows) {
    copies += r.qty;
    value += totalPrice(r, mode) ?? 0;
  }
  return { copies, value };
}

export type StashSortColumn = "number" | "name" | "printing" | "qty" | "value" | "rarity";
export interface StashSort {
  column: StashSortColumn;
  direction: "asc" | "desc";
}
/** Set | # ascending: binder order. */
export const DEFAULT_STASH_SORT: StashSort = { column: "number", direction: "asc" };

const RARITY_RANK: Record<string, number> = {
  Special: 0,
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Legendary: 4,
};

function compareNumber(a: StashPrinting, b: StashPrinting, setOrder: SetOrderMap): number {
  const [at, ak] = setReleaseRank(a.variant.source_set_code, setOrder);
  const [bt, bk] = setReleaseRank(b.variant.source_set_code, setOrder);
  if (at !== bt) return at - bt;
  if (ak !== bk) return ak < bk ? -1 : 1;
  const an = Number(a.variant.card_number);
  const bn = Number(b.variant.card_number);
  if (an !== bn && !Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return a.variant.card_number.localeCompare(b.variant.card_number);
}

/** The pane's order. Ties fall to Set | # (the printing's own set, newest
 * main set first as everywhere, then its number). Unpriced rows sort last
 * under Value in both directions. */
export function sortPrintings(
  rows: StashPrinting[],
  sort: StashSort,
  setOrder: SetOrderMap,
  mode: PriceMode,
  valueOf: (r: StashPrinting) => number | null = (r) => totalPrice(r, mode)
): StashPrinting[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  const by = (a: StashPrinting, b: StashPrinting): number => {
    switch (sort.column) {
      case "name":
        return parseCardDisplay(a.card).displayName.localeCompare(
          parseCardDisplay(b.card).displayName
        );
      case "printing":
        return finishName(a.variant).localeCompare(finishName(b.variant));
      case "qty":
        return a.qty - b.qty;
      case "rarity":
        return (
          (RARITY_RANK[getRarityLabel(a.card.rarity)] ?? 9) -
          (RARITY_RANK[getRarityLabel(b.card.rarity)] ?? 9)
        );
      default:
        return 0;
    }
  };
  return rows.slice().sort((a, b) => {
    if (sort.column === "value") {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av == null || bv == null) {
        if (av != null) return -1;
        if (bv != null) return 1;
      } else if (av !== bv) return (av - bv) * dir;
      return compareNumber(a, b, setOrder);
    }
    if (sort.column === "number") return compareNumber(a, b, setOrder) * dir;
    return by(a, b) * dir || compareNumber(a, b, setOrder);
  });
}

/** Rows in the order of an outside card list (the phone's Sort sheet sorts
 * cards): cards in `list` order, a card's printings by Set | #. */
export function orderByCards(
  rows: StashPrinting[],
  list: InventoryCard[],
  setOrder: SetOrderMap
): StashPrinting[] {
  const rank = new Map(list.map((c, i) => [c.base_card_id, i]));
  return rows.slice().sort((a, b) => {
    const d = (rank.get(a.card.base_card_id) ?? 1e9) - (rank.get(b.card.base_card_id) ?? 1e9);
    return d || compareNumber(a, b, setOrder);
  });
}

/** The feedback line after a return: one printing names it ("1 Luke
 * Skywalker · Standard is back in your Vault."), several count copies. */
export function returnSentence(rows: { row: StashPrinting; quantity: number }[]): string {
  const copies = rows.reduce((n, r) => n + r.quantity, 0);
  if (rows.length === 1) {
    const { row, quantity } = rows[0];
    return `${quantity} ${printingLabel(row)} ${quantity === 1 ? "is" : "are"} back in your Vault.`;
  }
  return `${copies} ${copies === 1 ? "copy is" : "copies are"} back in your Vault.`;
}
