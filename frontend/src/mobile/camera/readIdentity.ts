import type { CapMode } from "../../api/settingsLimits";
import { decompose } from "../../utils/addCardsResolver";
import type { AddCardsCatalogEntry, Decomposition } from "../../utils/addCardsResolver";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { effectiveLimit, limitBucketOf, typeCategoryOf } from "../../utils/limits";
import type { LimitsMatrix } from "../../utils/limits";
import type { BatchRow } from "../tool/batch";
import type { PadChoice, Readout } from "../tool/padModel";
import type { PadPicks } from "../tool/toolStore";

// BL-262 stage 2 (owner 2026-10-13: "Trust what the strip says"). THE rule
// for what a camera read identifies. A read -- an exact read's card, or the
// row picked from a pick list -- carries the printings its strip names (their
// variant ids). This module turns those, and nothing else, into what the
// camera may show and add:
//
//   none   -- none of the printings is in the catalogue the app loaded.
//   cards  -- the printings belong to more than one card: the pick list's
//             case; nothing is addable until one card's printings are chosen.
//   card   -- one card. One printing: it IS the read (`variant` set, nothing
//             asked). Several printings (an early set's foil and non-foil
//             under one strip; tournament stamps on one row; two events on
//             one number): the choice is among exactly those printings, by
//             the axes that tell them apart (Set, Stamp, Finish -- the
//             keypad's own vocabulary, utils/addCardsResolver decompose).
//
// The keypad resolves a TYPED set + number, where the base-set card is the
// right default for a shared number. A strip says more than a typed number
// (its denominator, its T prefix, its printed code), so the camera never asks
// the keypad's resolver which card a read is: it would answer with the
// base-set card for a Weekly Play strip and with another card for a token.
//
// `defaults` is the mode. Prompt mode (true): a choice the keypad would
// default is shown defaulted and Add stays a tap -- Base Set among events, the
// non-foil among finishes (BL-191), both printings the strip identified. Fast
// add (false): nothing is defaulted, so a read with more than one printing is
// never added until the user says which (owner: "Ask foil or non-foil each
// time").
//
// Users (there is no second rule): the controller's add effect (the automatic
// add of Fast add, the add after a choice, and Add to batch), the found panel,
// and the pick list's rows.

export type ReadIdentity =
  | { kind: "none" }
  | { kind: "cards"; cards: InventoryCard[] }
  | {
      kind: "card";
      card: InventoryCard;
      /** The printings the strip identified, in the read's order. */
      printings: InventoryVariant[];
      /** The chip groups that tell them apart (empty for one printing). */
      choices: PadChoice[];
      /** The printing settled on; null while a choice is still needed. */
      variant: InventoryVariant | null;
      hint: { text: string; attn: boolean } | null;
    };

interface Dec extends Decomposition {
  v: InventoryVariant;
}

const HINT_FINISH = "Foil and non-foil share this number. Pick the one you have.";
const HINT_PICK = "This code is on more than one printing. Pick the one you have.";
/** The keypad's cue for a defaulted finish (tool/padModel.ts), same words. */
const HINT_DEFAULTED = "Card number is shared across variants. Verify selection.";

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function choice(
  axis: keyof PadPicks,
  label: string,
  options: string[],
  value: string | null,
  defaulted: boolean
): PadChoice {
  return {
    axis,
    label,
    options: options.map((o) => ({ value: o, l1: o, l2: null })),
    value,
    needsPick: value === null,
    defaulted,
  };
}

/** What the printings `vids` identify, with the user's `picks` applied. */
export function readIdentity(
  vids: readonly number[],
  cards: InventoryCard[],
  picks: PadPicks,
  defaults: boolean
): ReadIdentity {
  const want = new Set(vids);
  const hits: { card: InventoryCard; v: InventoryVariant }[] = [];
  for (const card of cards)
    for (const v of card.variants) if (want.has(v.variant_id)) hits.push({ card, v });
  if (!hits.length) return { kind: "none" };
  const owners = uniq(hits.map((h) => h.card));
  if (owners.length > 1) return { kind: "cards", cards: owners };

  const card = owners[0];
  const order = new Map(vids.map((id, i) => [id, i]));
  const printings = hits
    .map((h) => h.v)
    .sort((a, b) => (order.get(a.variant_id) ?? 0) - (order.get(b.variant_id) ?? 0));
  const choices: PadChoice[] = [];
  const asking = (hint: string): ReadIdentity => ({
    kind: "card",
    card,
    printings,
    choices,
    variant: null,
    hint: { text: hint, attn: false },
  });

  let left: Dec[] = printings.map((v) => ({ v, ...decompose(v.variant_type, v.channel) }));

  // Set (the event): the keypad defaults to Base Set; Fast add asks.
  const events = uniq(left.map((d) => d.event));
  if (events.length > 1) {
    const picked = picks.setKey !== null && events.includes(picks.setKey) ? picks.setKey : null;
    const value = picked ?? (defaults && events.includes("Base Set") ? "Base Set" : null);
    choices.push(choice("setKey", "Set", events, value, false));
    if (value === null) return asking(HINT_PICK);
    left = left.filter((d) => d.event === value);
  }

  // Stamp: never defaulted (as on the keypad).
  const stamps = uniq(left.map((d) => d.stamp ?? ""));
  if (stamps.length > 1) {
    const value = picks.stamp !== null && stamps.includes(picks.stamp) ? picks.stamp : null;
    choices.push(choice("stamp", "Stamp", stamps, value, false));
    if (value === null) return asking(HINT_PICK);
    left = left.filter((d) => (d.stamp ?? "") === value);
  }

  // Finish: the keypad defaults to the non-foil (BL-191); Fast add asks.
  // The non-foil is always the first chip, whatever order the catalogue lists.
  let defaulted = false;
  const finishes = uniq(left.map((d) => d.finish)).sort(
    (a, b) => Number(a.includes("Foil")) - Number(b.includes("Foil"))
  );
  if (finishes.length > 1) {
    let value = picks.finish !== null && finishes.includes(picks.finish) ? picks.finish : null;
    if (value === null && defaults) {
      value = finishes.includes("Standard")
        ? "Standard"
        : finishes.includes("Hyperspace")
          ? "Hyperspace"
          : null;
      defaulted = value !== null;
    }
    choices.push(choice("finish", "Finish", finishes, value, defaulted));
    if (value === null)
      return asking(finishes.some((f) => f.includes("Foil")) ? HINT_FINISH : HINT_PICK);
    left = left.filter((d) => d.finish === value);
  }

  // Printings no axis tells apart (the Serialized Prestige image twins): the
  // first, as the keypad resolves them -- every one is a printing of the read.
  return {
    kind: "card",
    card,
    printings,
    choices,
    variant: left[0].v,
    hint: defaulted ? { text: HINT_DEFAULTED, attn: true } : null,
  };
}

/** What may be added for this identity: one card and one printing the strip
 * identified, or null while there is none or a choice is still needed. The
 * found panel's Add condition and every camera add. */
export function readAddable(
  id: ReadIdentity
): { card: InventoryCard; variant: InventoryVariant } | null {
  return id.kind === "card" && id.variant ? { card: id.card, variant: id.variant } : null;
}

/** The keep-limit readout for one printing (the keypad computes the same
 * numbers from a typed set + number; the camera has the printing itself):
 * owned, its effective limit, and After add = owned + this printing's copies
 * already in the batch + this one. */
export function printingReadout(
  variantId: number,
  batch: BatchRow[],
  catalog: AddCardsCatalogEntry[],
  limits: LimitsMatrix | null,
  capMode: CapMode
): Readout | null {
  void capMode; // the readout's numbers do not depend on the mode (as the keypad's)
  const entry = catalog.find((c) => c.id === variantId);
  if (!entry) return null;
  const owned = entry.quantity;
  const limit = effectiveLimit(
    limits,
    typeCategoryOf(entry.type),
    limitBucketOf(entry.finish, entry.channel)
  );
  const inBatch = batch.reduce((n, b) => n + (b.variantId === variantId ? 1 : 0), 0);
  const after = owned + inBatch + 1;
  const atLimit = limit !== null && owned >= limit;
  return {
    owned,
    limit,
    after,
    atLimit,
    overLimit: limit !== null && owned > limit,
    afterOver: limit !== null && !atLimit && after > limit,
  };
}
