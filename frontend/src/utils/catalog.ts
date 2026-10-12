import type { ImageRenditions, PriceInfo } from "../api/baseCards";
import { BASE_SET_ORDER, weeklyPlayCodeFor } from "./setGrouping";

export interface Variant {
  variant_id: number;
  variant_type: string;
  finish: string | null;
  channel: string;
  source_set_code: string;
  card_number: string;
  front_image_url: string | null;
  back_image_url: string | null;
  /** BL-76 Phase 3 / BL-146: no longer sourced from the API (which stopped
   * shipping these on the list, Design_SparseList_2026-07-25.md §3) --
   * toInventoryCards (utils/inventory.ts) computes them client-side via
   * utils/cardImages.ts's deriveRenditions. Optional because a null source
   * URL (e.g. most cards have no back_image_url) yields no renditions. */
  front_images?: ImageRenditions | null;
  back_images?: ImageRenditions | null;
  /** BL-163: this variant's own market/low price, passed through from
   * CatalogVariant -- see that interface's doc comment for the
   * undefined-vs-null distinction. Used by utils/completion.ts's
   * Collection-value calc. */
  price?: PriceInfo | null;
}

export interface BaseCard {
  base_card_id: number;
  set_code: string;
  base_card_number: string;
  name: string;
  subtitle: string | null;
  type: string;
  rarity: string;
  aspects: string[];
  keywords: string[];
  traits: string[];
  cost: number | null;
  power: number | null;
  hp: number | null;
  arena: string | null;
  is_token: boolean;
  variants: Variant[];
}

export function parseCardDisplay(card: BaseCard): { displayName: string; subtitle: string | null } {
  if (card.subtitle == null && card.type === "Base") {
    return { displayName: card.name, subtitle: card.traits[0] ?? null };
  }
  return { displayName: card.name, subtitle: card.subtitle };
}

/** set_code → release_date (nullable ISO date string), used to order sets by
 * release for the standard sort (redesign spec §5.2/§5.3). Built by callers
 * from `getSets()` so catalog.ts doesn't depend on the sets API directly. */
export type SetOrderMap = Record<string, string | null>;

/** Display rank for one set code (BL-258, owner 2026-10-12: newest main sets
 * first). Precedence: (a) a base set -> its index in `BASE_SET_ORDER`
 * (utils/setGrouping.ts, the single definition: main block newest first, then
 * IBH, TS26); (b) a Weekly Play code whose base is in that list -> directly
 * after its base; (c) anything else keeps its old relative order after every
 * (a)/(b) set -- `release_date` ascending when present, else alphabetical.
 * An explicit `release_date` never reorders (a)/(b) sets. Shared by
 * sortBaseCards, orderSetCodes (completion rows), cardSort and variantScope
 * so there is one rank rule. */
export function setReleaseRank(setCode: string, setOrder: SetOrderMap): [number, string | number] {
  const baseIndex = BASE_SET_ORDER.indexOf(setCode);
  if (baseIndex !== -1) return [0, baseIndex * 2];

  const wpBaseIndex = BASE_SET_ORDER.findIndex((base) => weeklyPlayCodeFor(base) === setCode);
  if (wpBaseIndex !== -1) return [0, wpBaseIndex * 2 + 1];

  const releaseDate = setOrder[setCode];
  if (releaseDate != null) return [1, releaseDate];

  return [2, setCode];
}

/** Orders a list of set codes in display order (see setReleaseRank) --
 * BL-163: used to put the completion panel's base-set breakdown rows in
 * display order (newest main set first), the same rule sortBaseCards applies at the card level. */
export function orderSetCodes(codes: string[], setOrder: SetOrderMap = {}): string[] {
  return [...codes].sort((a, b) => {
    const [aTier, aKey] = setReleaseRank(a, setOrder);
    const [bTier, bKey] = setReleaseRank(b, setOrder);
    if (aTier !== bTier) return aTier - bTier;
    if (aKey === bKey) return 0;
    return aKey < bKey ? -1 : 1;
  });
}

/** Standard sort: (1) set in display order (newest main set first; see
 * setReleaseRank) —
 * (2) tokens last within a set, (3) base_card_number ascending (numeric).
 * Shared by the unified Cards view (BL-56) — see
 * screens/cards/CardsPage.tsx / CardsTable.tsx. */
export function sortBaseCards<T extends BaseCard>(cards: T[], setOrder: SetOrderMap = {}): T[] {
  return cards.slice().sort((a, b) => {
    const [aTier, aKey] = setReleaseRank(a.set_code, setOrder);
    const [bTier, bKey] = setReleaseRank(b.set_code, setOrder);
    if (aTier !== bTier) return aTier - bTier;
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;

    if (a.is_token !== b.is_token) return Number(a.is_token) - Number(b.is_token);

    return a.base_card_number.localeCompare(b.base_card_number, undefined, { numeric: true });
  });
}
