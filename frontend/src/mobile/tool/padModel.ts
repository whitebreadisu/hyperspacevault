import type { CapMode } from "../../api/settingsLimits";
import type { CardSet } from "../../api/sets";
import { preconEntries } from "../../data/preconDecks";
import type { PreconEntry } from "../../data/preconDecks";
import { sortedEntries } from "../../screens/inventory/AddCardsPreconBar";
import { inventoryStatus, resolveRow } from "../../utils/addCardsResolver";
import type {
  AddCardsCatalogEntry,
  AxisView,
  ResolveResult,
  Row,
} from "../../utils/addCardsResolver";
import { deriveRenditions } from "../../utils/cardImages";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import type { LimitsMatrix } from "../../utils/limits";
import { cardsForEntry } from "../../utils/preconImport";
import {
  BASE_SET_ORDER,
  allSetsGroups,
  baseOnlyGroups,
  isBaseSetCode,
  weeklyPlayCodeFor,
} from "../../utils/setGrouping";
import type { SetRailGroup } from "../../utils/setGrouping";
import type { BatchRow } from "./batch";
import type { PadPicks } from "./toolStore";

// BL-249 S3-02 .. S3-05: the keypad's pure logic. Resolution is desktop's
// (utils/addCardsResolver.ts resolveRow + inventoryStatus, the 4-axis
// Card -> Set -> Stamp -> Finish resolver with BL-191's non-foil default);
// set grouping is desktop's (utils/setGrouping.ts); the precon list is
// desktop's (preconEntries + AddCardsPreconBar sortedEntries). Nothing here
// re-derives a rule desktop already owns.

/** CardsPage.tsx addCardsCatalog (desktop keeps it inline): the resolver's
 * flat per-variant rows, from the phone's shared catalogue + quantities. */
export function toCatalog(cards: InventoryCard[]): AddCardsCatalogEntry[] {
  const flat: AddCardsCatalogEntry[] = [];
  for (const base of cards) {
    for (const v of base.variants) {
      flat.push({
        id: v.variant_id,
        name: base.name,
        subtitle: base.subtitle,
        type: base.type,
        variant_type: v.variant_type,
        finish: v.finish,
        channel: v.channel,
        set_code: base.set_code,
        source_set_code: v.source_set_code,
        card_number: v.card_number,
        is_token: base.is_token,
        quantity: v.quantity,
        front_image_url: v.front_image_url,
        front_images:
          v.front_images ?? (v.front_image_url ? deriveRenditions(v.front_image_url) : undefined),
        back_image_url: v.back_image_url,
        back_images:
          v.back_images ?? (v.back_image_url ? deriveRenditions(v.back_image_url) : undefined),
      });
    }
  }
  return flat;
}

/** rev4 data.js M.padNumbers: the card numbers a set's own printings carry,
 * ascending (tokens excluded, as the resolver excludes them). */
export function padNumbers(set: string, catalog: AddCardsCatalogEntry[]): string[] {
  const out = new Set<string>();
  for (const c of catalog) if (c.source_set_code === set && !c.is_token) out.add(c.card_number);
  return [...out].sort((a, b) => +a - +b);
}

/** A keypad entry as the desktop Row the resolver reads. */
export function rowFor(id: string, setCode: string, cardNumber: string, picks: PadPicks): Row {
  return { id, setCode, cardNumber, ...picks };
}

export function entryRow(e: BatchRow): Row {
  return rowFor(e.id, e.setCode, e.cardNumber, e.picks);
}

/** One chip group on a shared number (a desktop axis that is a real
 * choice: options > 1). */
export interface PadChoice {
  axis: keyof PadPicks;
  label: string;
  options: { value: string; l1: string; l2: string | null }[];
  value: string | null;
  /** The axis needs a pick before Add (desktop needsPick). */
  needsPick: boolean;
  /** BL-191: the value was defaulted (finish only) -- amber verify cue. */
  defaulted: boolean;
}

export type PadView =
  | { kind: "empty" }
  | { kind: "miss" }
  | {
      kind: "card";
      resolved: Extract<ResolveResult, { status: "resolved" | "pending" }>;
      /** The printing (null while an axis still needs a pick). */
      variant: InventoryVariant | null;
      card: InventoryCard | null;
      choices: PadChoice[];
      /** Desktop's cue under the choices (or null). */
      hint: { text: string; attn: boolean } | null;
    };

function axisChoice(axis: keyof PadPicks, label: string, view: AxisView): PadChoice | null {
  if (!view.show || view.options.length <= 1) return null;
  return {
    axis,
    label,
    options: view.options.map((o) => ({ value: o, l1: o, l2: null })),
    value: view.value,
    needsPick: view.needsPick,
    defaulted: !!view.defaulted,
  };
}

export function padView(
  setCode: string,
  num: string,
  picks: PadPicks,
  catalog: AddCardsCatalogEntry[],
  cards: InventoryCard[]
): PadView {
  const res = resolveRow(rowFor("__draft__", setCode, num, picks), catalog);
  if (res.status === "empty") return { kind: "empty" };
  if (res.status === "error") return { kind: "miss" };

  const choices: PadChoice[] = [];
  if (res.card.show) {
    choices.push({
      axis: "cardKey",
      label: "Which card?",
      options: res.card.choices.map((c) => ({ value: c.key, l1: c.name, l2: c.subtitle })),
      value: res.card.selectedKey,
      needsPick: res.card.needsPick,
      defaulted: false,
    });
  }
  for (const c of [
    axisChoice("setKey", "Set", res.set),
    axisChoice("stamp", "Stamp", res.stamp),
    axisChoice("finish", "Finish", res.finish),
  ])
    if (c) choices.push(c);

  // Desktop AddCardsKeypad's cues, in its order of precedence.
  let hint: { text: string; attn: boolean } | null = null;
  if (res.card.needsPick)
    hint = { text: "This number is shared. Pick the card you have.", attn: false };
  else if (res.status === "pending")
    hint = { text: "Pick the highlighted option to enable Add to batch.", attn: false };
  else if (res.finish.defaulted)
    hint = { text: "Card number is shared across variants. Verify selection.", attn: true };
  else if (res.card.show)
    hint = {
      text: "Shared number. Defaulted to the base-set card; change Which card? for the alt printing.",
      attn: false,
    };

  let variant: InventoryVariant | null = null;
  let card: InventoryCard | null = null;
  if (res.status === "resolved") {
    for (const c of cards) {
      const v = c.variants.find((x) => x.variant_id === res.variantId);
      if (v) {
        variant = v;
        card = c;
        break;
      }
    }
  }
  return { kind: "card", resolved: res, variant, card, choices, hint };
}

/** What Add would add for this view: its card and printing, or null while the
 * view is not one resolved printing. This is the Add button's condition -- the
 * keypad's, the camera's found panel's and (BL-262) the first half of the
 * camera's Fast add rule (cameraFlow.ts fastAddTarget), so the three cannot
 * drift. Note a shared number IS addable: the resolver settles it on a default
 * (the base-set card, Base Set, the non-foil finish) and leaves the chips up. */
export function padAddable(
  view: PadView
): { card: InventoryCard; variant: InventoryVariant } | null {
  if (view.kind !== "card" || view.resolved.status !== "resolved") return null;
  return view.card && view.variant ? { card: view.card, variant: view.variant } : null;
}

/** S3-03 (F-1 / R4-7): the readout, desktop's numbers (inventoryStatus:
 * the printing's owned count, its effective keep-limit, and After add =
 * owned + this printing's copies already entered + this one) in rev4's
 * F-1 layout: at / over the limit the "In vault" line is red with a sub
 * line; under it, "After add" turns red once it passes the limit. A
 * "No limit" bucket drops the "/m" and never turns red. */
export interface Readout {
  owned: number;
  limit: number | null;
  after: number;
  /** owned >= limit: the In vault line is red. */
  atLimit: boolean;
  overLimit: boolean;
  /** after > limit (and not already at the limit): the After add line is red. */
  afterOver: boolean;
}

export function padReadout(
  setCode: string,
  num: string,
  picks: PadPicks,
  batch: BatchRow[],
  catalog: AddCardsCatalogEntry[],
  limits: LimitsMatrix | null,
  capMode: CapMode
): Readout | null {
  const draft = rowFor("__draft__", setCode, num, picks);
  const res = resolveRow(draft, catalog);
  if (res.status !== "resolved") return null;
  // After add = owned + every copy of this printing already in the batch
  // (keypad or precon -- S3-10) + this one. desktop inventoryStatus gives
  // owned / limit / owned + 1 for the draft alone; the batch adds its count.
  const inv = inventoryStatus([draft], draft, res, catalog, limits, capMode);
  const inBatch = batch.reduce((n, b) => n + (b.variantId === res.variantId ? 1 : 0), 0);
  const afterAdd = inv.afterAdd + inBatch;
  const limit = inv.effectiveLimit;
  const atLimit = limit !== null && inv.owned >= limit;
  return {
    owned: inv.owned,
    limit,
    after: afterAdd,
    atLimit,
    overLimit: limit !== null && inv.owned > limit,
    afterOver: limit !== null && !atLimit && afterAdd > limit,
  };
}

// ── S3-05: the set button and the two choosers ─────────────────────────────

/** A Weekly Play container's base set (LAWP -> LAW); a base set is its own;
 * an exclusive has none (desktop setGrouping: only Weekly Play nests). */
export function padSetBase(code: string): string | null {
  if (isBaseSetCode(code)) return code;
  return BASE_SET_ORDER.find((b) => weeklyPlayCodeFor(b) === code) ?? null;
}

// BL-257 FR3-01: setLogoUrl lives with the logo artwork table (the trims and
// the sizing rule) in ../setLogoArt.ts; re-exported here for the tool's callers.
export { setLogoUrl } from "../setLogoArt";
export const starfieldUrl = (code: string) => `/images/starfields/starfield_${code}.jpg`;

export interface SetSheetGroups {
  base: { canonical: SetRailGroup[]; secondary: SetRailGroup[] };
  all: { baseGroups: SetRailGroup[]; exclusiveGroups: SetRailGroup[] };
}

/** Desktop SetDropdown's two views, from desktop's own grouping. */
export function setSheetGroups(sets: CardSet[]): SetSheetGroups {
  return { base: baseOnlyGroups(sets), all: allSetsGroups(sets) };
}

/** Desktop's precon list (22 decks + the Hoth whole box), in its order. */
export const PRECON_ENTRIES: PreconEntry[] = sortedEntries(preconEntries());

export function preconByKey(key: string | null): PreconEntry | null {
  return key ? (PRECON_ENTRIES.find((e) => e.key === key) ?? null) : null;
}

/** rev4 MPrecon short name for the set button: the deck key after its set
 * code ("SOR-VADER" -> "Vader"); the Hoth whole box reads "Box". */
export function preconShort(entry: PreconEntry): string {
  if (entry.kind === "ibhBox") return "Box";
  const tail = entry.key.split("-").slice(1).join("-");
  return tail ? tail.charAt(0) + tail.slice(1).toLowerCase() : entry.key;
}

/** "N cards · M distinct" facts for a deck entry (desktop cardsForEntry). */
export function preconFacts(entry: PreconEntry): { total: number; distinct: number } {
  const cards = cardsForEntry(entry);
  return { total: cards.reduce((s, c) => s + c.quantity, 0), distinct: cards.length };
}
