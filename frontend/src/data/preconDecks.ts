import rawPreconData from "./preconDecks.json";

/** BL-151 S2 -- typed loader for the static, checked-in precon deck data
 * (Definition_BulkAddPrecons_2026-07-24.md §3). The JSON itself is bundled
 * (no fetch) -- same "static, checked-in, resolved at prep time" choice §2's
 * rejected-alternatives note makes explicit: no backend precon table/API.
 *
 * frontend/src/data/preconDecks.json now ships S1's real 22-deck,
 * catalog-uuid-resolved file (the S2 placeholder it replaced -- a fake
 * 2-deck SOR pair -- is gone). Nothing in this module (or any of its
 * consumers) assumes a deck count or specific deck contents beyond this
 * schema. */

export interface PreconDeckCard {
  swuapi_uuid: string;
  set_code: string;
  card_number: string;
  variant_type: string;
  name: string;
  quantity: number;
}

export interface PreconDeck {
  code: string;
  set_code: string;
  product: string;
  name: string;
  /** "Cunning / Heroism"-style label; null for the dual-leader Twin Suns
   * decks, whose four-aspect pools would read as noise -- the official deck
   * title (name) is their identity, and the picker simply omits the aspects
   * line when this is null. */
  aspects: string | null;
  cards: PreconDeckCard[];
}

export interface PreconData {
  generated: string;
  /** One research doc path or (S1's real data) the list of them. */
  source: string | string[];
  decks: PreconDeck[];
}

export const preconData = rawPreconData as unknown as PreconData;
export const preconDecks: PreconDeck[] = preconData.decks;

/** BL-151 S2b (§4-REV, owner dev-review 2026-07-24): the boxed three-choice
 * model (deck A / deck B / whole box) is REVERTED for SOR/SHD/TWI -- their
 * starter decks are individually selectable entries only, same as every
 * Spotlight/Twin Suns deck. IBH is the one remaining special case, but in
 * the opposite direction: it's ALWAYS the whole 104-card box (no per-deck
 * option at all), because the two Hoth decks partition a single 104-variant
 * set with per-copy print-slot numbering (§1 P4) -- there's no meaningful
 * "just deck A" purchase in the real product line the way there is for a
 * Two-Player Starter's two half-decks.
 *
 * `preconEntries()` therefore replaces the old `boxedProducts()`: every deck
 * is its own dropdown entry EXCEPT IBH's pair, which collapses into one
 * `"ibhBox"` entry carrying both decks (cardsForEntry, utils/preconImport.ts,
 * unions them via mergeDeckCards -- kept from the old boxed-choice code,
 * still exactly what an always-both entry needs). */
const IBH_SET_CODE = "IBH";

export type PreconEntry =
  | { kind: "deck"; key: string; setCode: string; deck: PreconDeck }
  | { kind: "ibhBox"; key: "IBH"; setCode: "IBH"; deckA: PreconDeck; deckB: PreconDeck };

/** Derives the dropdown's 21-entry list (§4-REV: "6 starter decks + 10
 * Spotlight + 4 Twin Suns individually, + 1 IBH box") from the raw deck
 * data. IBH's two decks fold into one `ibhBox` entry only once both are
 * present; if the data ever ships an unpaired IBH deck (shouldn't happen
 * once S1's data is complete, but this makes zero assumptions about deck
 * count/contents beyond the schema) it falls back to a plain `"deck"` entry
 * rather than silently dropping it. */
export function preconEntries(decks: PreconDeck[] = preconDecks): PreconEntry[] {
  const ibhDecks = decks.filter((d) => d.set_code === IBH_SET_CODE);
  const entries: PreconEntry[] = [];

  for (const deck of decks) {
    if (deck.set_code === IBH_SET_CODE) continue;
    entries.push({ kind: "deck", key: deck.code, setCode: deck.set_code, deck });
  }

  if (ibhDecks.length === 2) {
    entries.push({
      kind: "ibhBox",
      key: "IBH",
      setCode: "IBH",
      deckA: ibhDecks[0],
      deckB: ibhDecks[1],
    });
  } else {
    for (const deck of ibhDecks) {
      entries.push({ kind: "deck", key: deck.code, setCode: deck.set_code, deck });
    }
  }

  return entries;
}
