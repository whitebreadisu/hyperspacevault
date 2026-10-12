import type { PreconEntry } from "../../data/preconDecks";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import { cardImageProps } from "../../utils/cardImages";
import type { CardImageProps } from "../../utils/cardImages";
import { buildPreconPreview } from "../../utils/preconPreview";

// BL-257 FR3-03 (F-13): the leader / base art on a precon deck row of the
// keypad's "Choose a set" sheet. The data is desktop's own hover-preview
// resolution (utils/preconPreview.ts buildPreconPreview -- kinds standard /
// dual / ibh / unresolved) over the catalogue the keypad already holds; this
// module only turns it into the row's image list and holds the row geometry.

/** Card art geometry on a deck row, CSS px. One leader size for every row
 * kind (desktop's rule, PreconDropdown.tsx:186-189): a landscape card
 * (88 : 63). The base sits behind, raised by `peek` so its name strip shows
 * above the leader. `gap` separates two leaders; a Twin Suns row's single
 * base is `dualBase` of the two-leader width, centred (desktop: 62 %). */
export const DECK_ART = {
  leaderW: 60,
  leaderH: 43,
  peek: 8,
  gap: 2,
  dualBase: 0.62,
} as const;

/** Rendered box of a row's art for its kind (CSS px). */
export function deckArtBox(kind: "single" | "dual" | "ibh"): { w: number; h: number } {
  const { leaderW, leaderH, peek, gap } = DECK_ART;
  return { w: kind === "single" ? leaderW : leaderW * 2 + gap, h: leaderH + peek };
}

export interface DeckArtImage {
  /** Catalogue variant id (React key, and the failed-image key). */
  id: number;
  img: CardImageProps;
}

/** What a deck row draws:
 *  - "single": one leader, its base behind it (bases[0], may be null);
 *  - "dual" (Twin Suns): two leaders side by side, ONE base behind and
 *    between them (bases[0], may be null);
 *  - "ibh" (the Hoth box): two leaders, each with its OWN base behind it
 *    (bases[i] pairs with leaders[i], each may be null);
 *  - "none": a leader is unresolved or has no image -- the row has no art. */
export type DeckRowArt =
  | { kind: "single" | "dual" | "ibh"; leaders: DeckArtImage[]; bases: (DeckArtImage | null)[] }
  | { kind: "none" };

const NONE: DeckRowArt = { kind: "none" };

function face(e: AddCardsCatalogEntry | null, sizes: string): DeckArtImage | null {
  if (!e) return null;
  // "thumb" is the small-cell slot (320 / 640 width candidates + `sizes`).
  const img = cardImageProps(e.front_images, e.front_image_url, "thumb", sizes);
  return img ? { id: e.id, img } : null;
}

const deckCards = (e: PreconEntry) =>
  e.kind === "ibhBox" ? [...e.deckA.cards, ...e.deckB.cards] : e.deck.cards;

/** The art of every deck row, keyed by entry key. buildPreconPreview scans
 * the catalogue once per deck card, so each deck is resolved against only
 * the catalogue rows that share a card number with one of its cards (found
 * through one index pass). That subset keeps EVERY candidate the resolver
 * would see for each deck card, in catalogue order, so the result is the
 * whole catalogue's. It must not be narrowed by card type: a deck's event
 * (SOR 74 Repair) shares its set + number with a promo leader printing, and
 * only the event's own presence among the candidates keeps that leader out. */
export function deckRowArts(
  entries: PreconEntry[],
  catalog: AddCardsCatalogEntry[]
): Map<string, DeckRowArt> {
  const byNumber = new Map<string, AddCardsCatalogEntry[]>();
  for (const c of catalog) {
    const list = byNumber.get(c.card_number);
    if (list) list.push(c);
    else byNumber.set(c.card_number, [c]);
  }
  return new Map(
    entries.map((e) => {
      const numbers = new Set(deckCards(e).map((c) => c.card_number));
      const subset = [...numbers].flatMap((n) => byNumber.get(n) ?? []);
      return [e.key, deckRowArt(e, subset)];
    })
  );
}

/** The art of one deck row, resolved against `catalog`. */
export function deckRowArt(entry: PreconEntry, catalog: AddCardsCatalogEntry[]): DeckRowArt {
  const p = buildPreconPreview(entry, catalog);
  const lw = `${DECK_ART.leaderW}px`;
  if (p.kind === "unresolved") return NONE;
  if (p.kind === "standard") {
    const leader = face(p.leader, lw);
    return leader ? { kind: "single", leaders: [leader], bases: [face(p.base, lw)] } : NONE;
  }
  if (p.kind === "dual") {
    const a = face(p.leaders[0], lw);
    const b = face(p.leaders[1], lw);
    const bw = `${Math.round(deckArtBox("dual").w * DECK_ART.dualBase)}px`;
    return a && b ? { kind: "dual", leaders: [a, b], bases: [face(p.base, bw)] } : NONE;
  }
  const a = face(p.halves[0].leader, lw);
  const b = face(p.halves[1].leader, lw);
  return a && b
    ? {
        kind: "ibh",
        leaders: [a, b],
        bases: [face(p.halves[0].base, lw), face(p.halves[1].base, lw)],
      }
    : NONE;
}
