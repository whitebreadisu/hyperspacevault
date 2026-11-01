import rawPreconData from "./preconDecks.json";

/** Typed loader for the static, checked-in precon deck data (App Spec §18).
 * The JSON itself is bundled (no fetch): the data is static, checked in and
 * resolved to catalog uuids at prep time, so there is no backend precon
 * table or API. Nothing in this module (or any of its consumers) assumes a
 * deck count or specific deck contents beyond this schema. */

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
   * title (name) is their identity. No precon picker renders this field. */
  aspects: string | null;
  cards: PreconDeckCard[];
}

export interface PreconData {
  generated: string;
  /** The data's provenance: one source document path, or a list of them. */
  source: string | string[];
  decks: PreconDeck[];
}

export const preconData = rawPreconData as unknown as PreconData;
export const preconDecks: PreconDeck[] = preconData.decks;

/** Every precon deck is its own selectable entry -- each SOR/SHD/TWI
 * Two-Player Starter deck as well as every Spotlight/Twin Suns deck (App
 * Spec §18). IBH is the one special case, in the opposite direction: it's
 * ALWAYS the whole 104-card box (no per-deck option at all), because the
 * two Hoth decks partition a single 104-card set with per-copy print-slot
 * numbering -- there's no meaningful "just deck A" purchase in the real
 * product line the way there is for a Two-Player Starter's two half-decks.
 *
 * So in `preconEntries()` every deck is its own dropdown entry EXCEPT IBH's
 * pair, which collapses into one `"ibhBox"` entry carrying both decks
 * (cardsForEntry, utils/preconImport.ts, unions them via mergeDeckCards). */
const IBH_SET_CODE = "IBH";

export type PreconEntry =
  | { kind: "deck"; key: string; setCode: string; deck: PreconDeck }
  | { kind: "ibhBox"; key: "IBH"; setCode: "IBH"; deckA: PreconDeck; deckB: PreconDeck };

/** Derives the dropdown's entry list from the raw deck data: one entry per
 * deck, except that IBH's two decks fold into one `ibhBox` entry, only once
 * both are present. If the data ever ships an unpaired IBH deck (this makes
 * zero assumptions about deck count/contents beyond the schema) it falls
 * back to a plain `"deck"` entry rather than silently dropping it. */
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
