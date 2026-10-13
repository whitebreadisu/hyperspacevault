import { useSyncExternalStore } from "react";
import type { CapMode } from "../../api/settingsLimits";
import type { PreconDeckCard, PreconEntry } from "../../data/preconDecks";
import { decompose, resolveRow, toVerificationRow } from "../../utils/addCardsResolver";
import type {
  AddCardsCatalogEntry,
  InventoryStatus,
  Row,
  VerificationItem,
  VerificationRow,
} from "../../utils/addCardsResolver";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import {
  QUANTITY_CEILING,
  effectiveLimit,
  limitBucketOf,
  typeCategoryOf,
} from "../../utils/limits";
import type { LimitsMatrix } from "../../utils/limits";
import { cardsForEntry } from "../../utils/preconImport";
import { clearPersisted, readPersisted, writeBatch } from "./batchPersist";
import type { PadPicks } from "./toolStore";

// BL-249 S3-08: the batch model (rev4 data.js RUN D2 `M.addEntry` /
// `M.batch` / `M.verifyRows`, with R5-8's "one row per copy"). The batch is
// what the keypad, a precon deck (and, in slice 7, the camera) add to; the
// vault is untouched until the Verify cards sheet commits (stage 3c).
//
//   - One row per copy: entering the same number three times is three rows;
//     a 52-card deck is 52 rows. Nothing is folded in storage -- a fold per
//     printing is a *commit-time* view (`foldAdded`).
//   - Each row = { card, printing, via: keypad | precon, force }. A keypad
//     row keeps the desktop Row it was entered as (setCode + number + axis
//     picks) so desktop's resolver can name it; a precon row keeps the deck
//     card it came from (the commit rebuilds desktop's import file from it).
//     A precon copy whose printing the catalogue does not hold has a null
//     variantId and is reported as "unresolved" (desktop's data-integrity
//     section), never silently dropped.
//   - Admission is decided when the batch is *viewed* (so a quick-remove
//     re-admits a copy that was over the cap): `batchView` walks the rows in
//     order, per printing, exactly as desktop's `inventoryStatus` /
//     `splitForVerification` do (hard cap -> copies past the effective limit
//     are "not added" with desktop's reason; soft mode and `force` rows stay
//     in "added" flagged over-limit; the 999 ceiling blocks in both modes).
//   - The store is a module store: the batch persists while the tool is
//     closed and while the card layer is over it. BL-253 S7-08: it is also
//     mirrored to sessionStorage (batchPersist.ts) so it survives the hop
//     between the main document and the isolated /scan/ document; a new tab
//     starts empty.

/** BL-253 S7-14 / S7-17: camera rows (`camera` = Add in the prompt,
 * `camera_fast_add` = an add with no Add tap under Fast add) are stored as
 * keypad rows (set + number + picks, one adjust per printing at commit); the
 * via feeds add_cards_committed.method (S7-18). BL-262: a camera row's
 * `variantId` is the printing its strip identified and its set + number are
 * that printing's own -- the Verify view describes it by the printing when
 * the keypad resolver would name another (verificationRowOf). */
export type BatchVia = "keypad" | "precon" | "camera" | "camera_fast_add";

/** One copy waiting in the batch. */
export interface BatchRow {
  id: string;
  via: BatchVia;
  /** Precon "Add the full deck, even above my keep-limits": admitted past
   * the hard cap (R4-14.2). Always false for a keypad row. */
  force: boolean;
  /** The desktop Row fields (the keypad's entry; for a precon copy the
   * printing's own set + number with no axis picks). */
  setCode: string;
  cardNumber: string;
  picks: PadPicks;
  /** The printing; null for a deck copy the catalogue does not hold. */
  variantId: number | null;
  baseCardId: number | null;
  /** Precon only: where the copy came from. */
  deck?: { key: string; card: PreconDeckCard };
}

export type NewBatchRow = Omit<BatchRow, "id">;

// Hydrated from the sessionStorage mirror at load (S7-08).
const saved = readPersisted();
let rows: BatchRow[] = saved?.rows ?? [];
let seq = saved?.seq ?? 0;
const subs = new Set<() => void>();

function emit(next: BatchRow[]): void {
  rows = next;
  writeBatch(rows, seq);
  subs.forEach((f) => f());
}

/** S7-08: re-read the mirror (a bfcache `pageshow` -- the other document may
 * have changed the batch while this one was frozen). */
export function rehydrateBatch(): void {
  const p = readPersisted();
  rows = p?.rows ?? [];
  seq = Math.max(seq, p?.seq ?? 0);
  subs.forEach((f) => f());
}

export function getBatch(): BatchRow[] {
  return rows;
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function useBatch(): BatchRow[] {
  return useSyncExternalStore(subscribe, getBatch, getBatch);
}

/** Add one copy (S3-08). Returns the stored row. */
export function addCopy(row: NewBatchRow): BatchRow {
  const stored: BatchRow = { ...row, id: "b-" + ++seq };
  emit([...rows, stored]);
  return stored;
}

/** Quick remove (S3-12): drops exactly one copy. */
export function removeCopy(id: string): void {
  if (rows.some((r) => r.id === id)) emit(rows.filter((r) => r.id !== id));
}

/** S3-15: drop the copies a partial commit already wrote. */
export function removeCopies(ids: Set<string>): void {
  if (ids.size && rows.some((r) => ids.has(r.id))) emit(rows.filter((r) => !ids.has(r.id)));
}

/** BL-235 `pending_entries` as desktop counts it: keypad copies plus one per
 * chosen deck (AddCardsModal pendingEntries). */
export function pendingEntries(list: BatchRow[]): number {
  const decks = new Set<string>();
  let n = 0;
  for (const r of list) {
    if (r.via === "precon" && r.deck) decks.add(r.deck.key);
    else n++;
  }
  return n + decks.size;
}

/** Discard batch: clears every row. */
export function discardBatch(): void {
  if (rows.length) emit([]);
}

/** Test seam. */
export function resetBatchForTest(): void {
  seq = 0;
  rows = [];
  clearPersisted();
  subs.forEach((f) => f());
}

// ── S3-09: precon deck -> rows ─────────────────────────────────────────────

const deckIndexCache = new WeakMap<
  InventoryCard[],
  Map<string, { card: InventoryCard; variant: InventoryVariant }>
>();

/** The catalogue's printings keyed set | number | variant_type -- the triple
 * a deck card carries (no uuid reaches the phone's catalogue). */
function deckIndex(cards: InventoryCard[]) {
  let idx = deckIndexCache.get(cards);
  if (!idx) {
    idx = new Map();
    for (const card of cards)
      for (const variant of card.variants) {
        const k = `${variant.source_set_code}|${variant.card_number}|${variant.variant_type}`;
        if (!idx.has(k)) idx.set(k, { card, variant });
      }
    deckIndexCache.set(cards, idx);
  }
  return idx;
}

const NO_PICKS: PadPicks = { cardKey: null, setKey: null, stamp: null, finish: null };

/** S3-09 (R4-14.2): write every copy of a deck into the batch -- one row per
 * copy, `force` as the caller decided (hard-cap users who chose "Add the
 * full deck, even above my keep-limits"). Over-cap copies are not trimmed
 * here: admission is the batch view's job, so the Verify cards sheet can
 * list them under "will not be added" with desktop's reason. Returns the
 * number of copies written. */
export function addDeck(entry: PreconEntry, cards: InventoryCard[], force: boolean): number {
  const idx = deckIndex(cards);
  const added: BatchRow[] = [];
  for (const dc of cardsForEntry(entry)) {
    const hit = idx.get(`${dc.set_code}|${dc.card_number}|${dc.variant_type}`) ?? null;
    for (let i = 0; i < dc.quantity; i++) {
      added.push({
        id: "b-" + ++seq,
        via: "precon",
        force,
        setCode: dc.set_code,
        cardNumber: dc.card_number,
        picks: NO_PICKS,
        variantId: hit ? hit.variant.variant_id : null,
        baseCardId: hit ? hit.card.base_card_id : null,
        deck: { key: entry.key, card: dc },
      });
    }
  }
  if (added.length) emit([...rows, ...added]);
  return added.length;
}

// ── S3-08: admission + the Verify view ─────────────────────────────────────

export interface BatchViewCtx {
  catalog: AddCardsCatalogEntry[];
  limits: LimitsMatrix | null;
  capMode: CapMode;
}

/** desktop REASON_TEXT (utils/preconImport.ts) / AddCardsModal.tsx:357. */
export const NOT_ADDED_REASON = "Inventory limit already reached.";
export const UNRESOLVED_REASON = "No matching card for that set/number/variant.";

export interface BatchView {
  /** "The following cards will be added to inventory" -- one row per copy. */
  added: VerificationRow[];
  /** "The following cards will not be added" -- one row per copy. */
  notAdded: VerificationRow[];
  /** Deck copies matching no catalogue card (desktop's Unresolved rows). */
  unresolved: VerificationRow[];
}

const catalogIndexCache = new WeakMap<AddCardsCatalogEntry[], Map<number, AddCardsCatalogEntry>>();

function catalogIndex(catalog: AddCardsCatalogEntry[]): Map<number, AddCardsCatalogEntry> {
  let idx = catalogIndexCache.get(catalog);
  if (!idx) {
    idx = new Map(catalog.map((c) => [c.id, c]));
    catalogIndexCache.set(catalog, idx);
  }
  return idx;
}

function keypadRowOf(r: BatchRow): Row {
  return { id: r.id, setCode: r.setCode, cardNumber: r.cardNumber, ...r.picks };
}

/** The batch as desktop's Verify Cards screen reads it. Walks the rows in
 * order; per printing it counts the copies already admitted, so the first
 * copies up to the effective limit are "added", the rest "not added" (hard
 * cap, not forced). Mirrors desktop `inventoryStatus` (the same bucket /
 * limit / 999-ceiling arithmetic) keyed by printing instead of re-resolving
 * each row -- a precon copy has no number-pad draft to resolve. For
 * keypad-only batches the result equals desktop `splitForVerification`
 * (asserted in batch.test.ts). */
export function batchView(batch: BatchRow[], ctx: BatchViewCtx): BatchView {
  const byId = catalogIndex(ctx.catalog);
  const taken = new Map<number, number>();
  const view: BatchView = { added: [], notAdded: [], unresolved: [] };

  for (const r of batch) {
    const entry = r.variantId === null ? undefined : byId.get(r.variantId);
    if (!entry || r.variantId === null) {
      const dc = r.deck?.card;
      view.unresolved.push({
        id: r.id,
        groupKey: dc?.set_code ?? r.setCode,
        cardNumber: dc?.card_number ?? r.cardNumber,
        name: dc?.name ?? "Unrecognized row",
        subtitle: null,
        setText: "",
        isOP: false,
        finishText: dc?.variant_type ?? "",
        inventoryText: "",
        dotColor: "red",
        skipReason: UNRESOLVED_REASON,
      });
      continue;
    }

    const owned = entry.quantity;
    const category = typeCategoryOf(entry.type);
    const bucket = limitBucketOf(entry.finish, entry.channel);
    const rawLimit = effectiveLimit(ctx.limits, category, bucket);
    const max = rawLimit ?? QUANTITY_CEILING;
    const wouldBe = owned + (taken.get(r.variantId) ?? 0) + 1;

    let color: InventoryStatus["color"] = "green";
    if (wouldBe > QUANTITY_CEILING) color = "red";
    else if (rawLimit !== null && wouldBe > rawLimit)
      color = ctx.capMode === "soft" || r.force ? "amber" : "red";
    const inv: InventoryStatus = {
      color,
      owned,
      max,
      effectiveLimit: rawLimit,
      afterAdd: wouldBe,
    };
    if (color !== "red") taken.set(r.variantId, wouldBe - owned);

    const vrow = verificationRowOf(r, entry, inv, ctx.catalog);
    if (color === "red") view.notAdded.push({ ...vrow, skipReason: NOT_ADDED_REASON });
    else view.added.push(vrow);
  }
  return view;
}

function verificationRowOf(
  r: BatchRow,
  entry: AddCardsCatalogEntry,
  inv: InventoryStatus,
  catalog: AddCardsCatalogEntry[]
): VerificationRow {
  const camera = r.via === "camera" || r.via === "camera_fast_add";
  if (r.via !== "precon") {
    const row = keypadRowOf(r);
    const resolved = resolveRow(row, catalog);
    // BL-262: a camera row is the printing its strip identified, which the
    // resolver may not reach from the row's set + number (a Weekly Play
    // printing on a base-set number resolves to the base-set card; a token
    // does not resolve at all). The row is described as a keypad row only
    // when the resolver names that same printing.
    if (resolved.status === "resolved" && (!camera || resolved.variantId === r.variantId)) {
      const item: VerificationItem = { row, resolved, inv };
      return { ...toVerificationRow(item), id: r.id };
    }
  }
  if (camera) {
    // The same columns toVerificationRow fills, from the printing itself.
    const d = decompose(entry.variant_type, entry.channel);
    return {
      id: r.id,
      groupKey: r.setCode,
      cardNumber: r.cardNumber,
      name: entry.name,
      subtitle: entry.subtitle,
      setText: [d.event, d.stamp].filter(Boolean).join(" · "),
      isOP: entry.channel !== "Retail",
      finishText: d.finish,
      inventoryText: `${inv.owned} → ${inv.color === "red" ? inv.owned : inv.afterAdd}`,
      dotColor: inv.color,
      overLimitNote: inv.color === "amber" ? "Over your keep-limit — will still be added" : null,
      skipReason: null,
    };
  }
  // Precon copies (and a keypad row whose number no longer resolves): the
  // precon flow's mapping (utils/preconImport.ts verificationRowsFromReport)
  // -- the "Set" column reads "Base Set", the Finish column the variant type.
  return {
    id: r.id,
    groupKey: entry.source_set_code,
    cardNumber: entry.card_number,
    name: entry.name,
    subtitle: entry.subtitle,
    setText: r.via === "precon" ? "Base Set" : entry.channel,
    isOP: false,
    finishText: entry.finish ?? entry.variant_type,
    inventoryText: `${inv.owned} → ${inv.color === "red" ? inv.owned : inv.afterAdd}`,
    dotColor: inv.color,
    overLimitNote: inv.color === "amber" ? "Over your keep-limit — will still be added" : null,
    skipReason: null,
  };
}

/** The commit-time fold (S3-15 reads it): admitted copies per printing, in
 * batch order -- the delta each `adjustCard` call sends. Unresolved copies
 * and not-added copies are excluded. */
export function foldAdded(batch: BatchRow[], view: BatchView): Map<number, number> {
  const ok = new Set(view.added.map((v) => v.id));
  const out = new Map<number, number>();
  for (const r of batch)
    if (ok.has(r.id) && r.variantId !== null) out.set(r.variantId, (out.get(r.variantId) ?? 0) + 1);
  return out;
}
