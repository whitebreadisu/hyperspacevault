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
//   token  -- one card, and it is a token. It is named as that token (never
//             as the card that holds its number) and is never addable: tokens
//             are not added by scanning, as the keypad cannot enter one
//             (owner 2026-10-13).
//   card   -- one card. One printing: it IS the read (`variant` set, nothing
//             asked). Several printings (an early set's foil and non-foil
//             under one strip; tournament stamps on one row; two events on
//             one number; the three Serialized Prestige printings of one
//             number): the choice is among exactly those printings, by what
//             tells them apart (Set, Stamp, Finish -- the keypad's own
//             vocabulary, utils/addCardsResolver decompose -- then, for
//             printings that vocabulary cannot separate, the tier their image
//             file names: Carbonite / Gold / Rose Gold). `partial` = some of
//             the strip's printings are not in the loaded catalogue: such a
//             read is never added without an Add tap (readAddable).
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
// time"). Stamps and the Serialized Prestige tiers are defaulted in neither
// mode: there is no sensible default among them.
//
// Users (there is no second rule): the controller's add effect (the automatic
// add of Fast add, the add after a choice, and Add to batch), the found panel,
// and the pick list's rows.

export type ReadIdentity =
  | { kind: "none" }
  | { kind: "cards"; cards: InventoryCard[] }
  | {
      /** A token: recognised and named, never addable by scanning. */
      kind: "token";
      card: InventoryCard;
      /** The token's printings the strip identified (the first is shown). */
      printings: InventoryVariant[];
      hint: { text: string; attn: boolean };
    }
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
      /** Some of the strip's printings are not in the loaded catalogue. */
      partial: boolean;
    };

interface Dec extends Decomposition {
  v: InventoryVariant;
}

const HINT_FINISH = "Foil and non-foil share this number. Pick the one you have.";
const HINT_PICK = "This code is on more than one printing. Pick the one you have.";
/** The keypad's cue for a defaulted finish (tool/padModel.ts), same words. */
const HINT_DEFAULTED = "Card number is shared across variants. Verify selection.";
const HINT_TOKEN = "Tokens can't be added from the camera.";
const HINT_PARTIAL =
  "Part of this read is not in the catalogue this app loaded. Check the card before adding.";
const HINT_TWINS =
  "This number has printings the app cannot tell apart. It is not added by scanning.";

/** The Serialized Prestige tiers, in the order their chips are shown. The 21
 * SEC senator cards are three printings under one number with one variant
 * type and one finish; the catalogue tells them apart by the image file name
 * alone (App Spec 10.5: `..._Carb_C_<hash>` = Carbonite, `..._Carb_C_Gold_`,
 * `..._Carb_C_Rose_Gold_`). The keypad and desktop collapse them to the first
 * (BL-31/40, deferred); the camera asks (BL-262 review S1). */
const TIERS = ["Carbonite", "Gold", "Rose Gold"];

/** A printing's tier from its image file name, or null when it has none. */
function tierOf(v: InventoryVariant): string | null {
  const m = /_Carb_C(_Rose_Gold|_Gold)?_[0-9a-f]+\.[a-z]+$/i.exec(v.front_image_url ?? "");
  if (!m) return null;
  return m[1] === "_Rose_Gold" ? "Rose Gold" : m[1] === "_Gold" ? "Gold" : "Carbonite";
}

/** "A, B and C". */
function listed(xs: string[]): string {
  return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
}

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

  // A token: named, never addable (no choice is offered -- there is no add).
  if (card.is_token)
    return { kind: "token", card, printings, hint: { text: HINT_TOKEN, attn: false } };

  // Review N1: a printing the strip names is missing from the catalogue. The
  // read is not narrowed to the ones found without saying so.
  const partial = new Set(hits.map((h) => h.v.variant_id)).size < want.size;
  const PARTIAL = { text: HINT_PARTIAL, attn: true };
  const choices: PadChoice[] = [];
  const asking = (hint: string): ReadIdentity => ({
    kind: "card",
    card,
    printings,
    choices,
    variant: null,
    hint: partial ? PARTIAL : { text: hint, attn: false },
    partial,
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

  // Printings no axis tells apart (the Serialized Prestige three): one chip
  // per printing, labelled by its tier, defaulted in neither mode -- nothing
  // is added until the user says which (BL-262 review S1; was: the first, as
  // the keypad resolves them). The tiers are a Finish (owner 2026-07-05).
  if (left.length > 1) {
    const tiers = left.map((d) => tierOf(d.v));
    const told =
      finishes.length === 1 && tiers.every((t) => t !== null) && uniq(tiers).length === left.length;
    // Nothing tells them apart: nothing is offered and nothing is addable.
    if (!told) return asking(HINT_TWINS);
    const options = TIERS.filter((t) => tiers.includes(t));
    const value = picks.finish !== null && options.includes(picks.finish) ? picks.finish : null;
    choices.push(choice("finish", "Finish", options, value, false));
    if (value === null)
      return asking(listed(options) + " share this number. Pick the one you have.");
    left = left.filter((_, i) => tiers[i] === value);
  }

  return {
    kind: "card",
    card,
    printings,
    choices,
    variant: left[0].v,
    hint: partial ? PARTIAL : defaulted ? { text: HINT_DEFAULTED, attn: true } : null,
    partial,
  };
}

/** What may be added for this identity: one card and one printing the strip
 * identified, or null while there is none, a choice is still needed, or the
 * read is a token. The found panel's Add condition and every camera add.
 * `auto` = an add with no Add tap (Fast add: at the read, after a pick, after
 * a chip): a partial read is never added that way -- only by the Add button,
 * under the panel's line that says part of the read is missing. */
export function readAddable(
  id: ReadIdentity,
  auto = false
): { card: InventoryCard; variant: InventoryVariant } | null {
  if (id.kind !== "card" || !id.variant) return null;
  if (auto && id.partial) return null;
  return { card: id.card, variant: id.variant };
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
