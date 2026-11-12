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
  empty: "You have no stashes. A stash records where cards are kept, like a binder or a trade box.",
  zero: (name: string) => `${name} has no cards. Cards go into a stash from a card’s detail.`,
  filtered: "No cards match the current filters.",
  noDescription: "No description",
  loading: "Loading stashes…",
  loadFailed: "Your stashes did not load.",
  staleFailed: "The stash list did not refresh.",
  retry: "Try again",
  /** The delete confirm (R1-9): every card in the stash returns to the
   * Vault, with the count -- a stash's total reads "cards" (R3-1). */
  deleteLead: (cards: number) =>
    cards === 0
      ? "It holds no cards."
      : `Every card in it returns to your Vault: ${cards.toLocaleString()} ${cards === 1 ? "card" : "cards"}.`,
  deleteFine: "You still own every copy. Only the stash and its name and description are deleted.",
  /** The delete confirm's extra line while the stash has a share link. */
  deleteShared: "Its share link stops working.",
};

/** A stash link's viewer copy (App Spec §19.1), both layouts. The empty
 * sentence carries no hint about card details (that is owner copy). */
export const SHARED_STASH_COPY = {
  eyebrow: (shareName: string) => `${shareName}'s stash`,
  readOnly: "Read only",
  zero: (name: string) => `${name} has no cards right now.`,
  loading: "Loading shared stash…",
  rateLimited:
    "This shared stash is getting a lot of traffic right now — please try again in a moment.",
  invalid: "This shared stash is no longer available.",
};

export interface StashPrinting {
  card: InventoryCard;
  variant: InventoryVariant;
  /** Copies of this printing in the stash. */
  qty: number;
  /** When copies last went in (ISO), when known: "Recently stashed". */
  stashedAt?: string | null;
}

/** The printing's finish name ("Hyperspace"), as the Vault names it. */
export function finishName(v: InventoryVariant): string {
  return v.finish ?? v.variant_type;
}

/** The printing's own number ("SOR 269"). */
export function printingNumber(v: InventoryVariant): string {
  return `${v.source_set_code} ${v.card_number}`;
}

/** The base card's number ("SOR 5"): every printing of a card shares it
 * (the variant mapping, mapping spec §2). */
export function baseNumber(card: InventoryCard): string {
  return `${card.set_code} ${card.base_card_number}`;
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
  items: StashMove[],
  stashedAtOf?: (variantId: number) => string | null
): StashPrinting[] {
  if (items.length === 0) return [];
  const index = Array.isArray(source) ? printingIndex(source) : source;
  const out: StashPrinting[] = [];
  for (const it of items) {
    if (it.quantity <= 0) continue;
    const hit = index.get(it.variant_id);
    if (!hit) continue;
    const row: StashPrinting = { card: hit.card, variant: hit.variant, qty: it.quantity };
    if (stashedAtOf) row.stashedAt = stashedAtOf(it.variant_id);
    out.push(row);
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

/** "base" = Set | # by the base card's number (a card's printings sit
 * together); "number" = Set | # by the printing's own number; "recent" =
 * Recently stashed. */
export type StashSortColumn =
  "base" | "number" | "name" | "printing" | "qty" | "value" | "rarity" | "recent";
export interface StashSort {
  column: StashSortColumn;
  direction: "asc" | "desc";
}
/** Set | # by base card number, ascending (R1-15): binder order with every
 * printing of a card side by side. */
export const DEFAULT_STASH_SORT: StashSort = { column: "base", direction: "asc" };

/** The sort control's entries (R1-16), both layouts. The two Set | # sorts
 * share one entry with a secondary choice. */
export const STASH_SORT_LABELS: Record<StashSortColumn, string> = {
  base: "Set | # (base card)",
  number: "Set | # (this printing)",
  name: "Name",
  printing: "Printing",
  qty: "Copies in stash",
  value: "Value",
  rarity: "Rarity",
  recent: "Recently stashed",
};
/** The base / actual secondary choice under Set | #. */
export const NUMBER_SORT_CHOICES: { column: "base" | "number"; label: string }[] = [
  { column: "base", label: "Base card number" },
  { column: "number", label: "Card number" },
];

/** A pick from a sort control, the Vault's rule: a new column lands
 * ascending, the active column flips direction. One exception: Recently
 * stashed lands descending (newest first). */
export function nextStashSort(prev: StashSort, column: StashSortColumn): StashSort {
  if (prev.column === column)
    return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
  return { column, direction: column === "recent" ? "desc" : "asc" };
}

const RARITY_RANK: Record<string, number> = {
  Special: 0,
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Legendary: 4,
};

function compareSetNumber(
  aSet: string,
  aNum: string,
  bSet: string,
  bNum: string,
  setOrder: SetOrderMap
): number {
  const [at, ak] = setReleaseRank(aSet, setOrder);
  const [bt, bk] = setReleaseRank(bSet, setOrder);
  if (at !== bt) return at - bt;
  if (ak !== bk) return ak < bk ? -1 : 1;
  const an = Number(aNum);
  const bn = Number(bNum);
  if (an !== bn && !Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return aNum.localeCompare(bNum);
}

/** The printing's own Set | #. */
function compareNumber(a: StashPrinting, b: StashPrinting, setOrder: SetOrderMap): number {
  return compareSetNumber(
    a.variant.source_set_code,
    a.variant.card_number,
    b.variant.source_set_code,
    b.variant.card_number,
    setOrder
  );
}

/** The base card's Set | #, then the base card itself (two cards can share
 * a set and base number -- in-set collisions, mapping spec section 5 D),
 * then the printing's own number, then the printing (several printings can
 * share one number, e.g. serialized triples): a card's printings together,
 * in a stable order. */
function compareBase(a: StashPrinting, b: StashPrinting, setOrder: SetOrderMap): number {
  return (
    compareSetNumber(
      a.card.set_code,
      a.card.base_card_number,
      b.card.set_code,
      b.card.base_card_number,
      setOrder
    ) ||
    a.card.base_card_id - b.card.base_card_id ||
    compareNumber(a, b, setOrder) ||
    a.variant.variant_id - b.variant.variant_id
  );
}

/** The pane's order. Ties fall to Set | # by base card, then the
 * printing's own number (newest main set first as everywhere). Unpriced
 * rows sort last under Value in both directions; an unknown stash time
 * sorts last under Recently stashed (ascending = oldest first). */
export function sortPrintings(
  rows: StashPrinting[],
  sort: StashSort,
  setOrder: SetOrderMap,
  mode: PriceMode,
  valueOf: (r: StashPrinting) => number | null = (r) => totalPrice(r, mode)
): StashPrinting[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  const tie = (a: StashPrinting, b: StashPrinting) => compareBase(a, b, setOrder);
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
      return tie(a, b);
    }
    if (sort.column === "recent") {
      const at = a.stashedAt ? Date.parse(a.stashedAt) : NaN;
      const bt = b.stashedAt ? Date.parse(b.stashedAt) : NaN;
      const an = Number.isNaN(at);
      const bn = Number.isNaN(bt);
      if (an || bn) {
        if (!an) return -1;
        if (!bn) return 1;
      } else if (at !== bt) return (at - bt) * dir;
      return tie(a, b);
    }
    if (sort.column === "base") return compareBase(a, b, setOrder) * dir;
    if (sort.column === "number")
      return (
        (compareNumber(a, b, setOrder) ||
          a.variant.variant_id - b.variant.variant_id ||
          compareBase(a, b, setOrder)) * dir
      );
    return by(a, b) * dir || tie(a, b);
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
  return `${copies} ${copies === 1 ? "card is" : "cards are"} back in your Vault.`;
}
