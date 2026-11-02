import type { BaseCardDetail, VariantDetail } from "../api/baseCards";
import { formatAsOf } from "../mobile/card/priceChartModel";

// The public card pages' data model (design note §3 "Data source", §5).
//
// `PublicCatalog` is the document the planned tenant-less route
// `GET /api/public/cards` returns: the detail shape without `quantity`, set
// names, per-printing prices from variant_latest_prices, `build_sha` and
// per-set `counts`. The generator (scripts/public-pages/generate.mjs) reads
// one such document; locally it is built from a swuapi export by
// backend/scripts/public_catalog_from_export.py, so nothing here knows which
// source filled it.
//
// Everything here is pure and runs both in the generator (Node) and in the
// page's browser bundle, so the prerendered markup and the hydrated markup
// come from the same functions. Dates are formatted in UTC with a fixed
// locale, never from the visitor's clock or locale (D3).

export type PublicVariant = Omit<VariantDetail, "quantity">;

export interface PublicCard extends Omit<BaseCardDetail, "variants"> {
  variants: PublicVariant[];
}

export interface PublicSet {
  code: string;
  name: string;
  is_base_set: boolean;
  release_date: string | null;
}

export interface PublicCatalog {
  build_sha: string;
  sets: PublicSet[];
  /** Non-token base cards per base set (the completeness guard's input). */
  counts: Record<string, number>;
  cards: PublicCard[];
}

/** A link to a neighbouring card page. */
export interface CardLink {
  path: string;
  label: string;
}

/** What one page renders from, embedded in the page as JSON for hydration. */
export interface CardPageData {
  card: BaseCardDetail;
  setName: string;
  setNameByCode: Record<string, string>;
  numberLabel: string;
  /** "as of Nov 1, 2026", or null when no printing has a price. */
  asOfLabel: string | null;
  prev: CardLink | null;
  next: CardLink | null;
}

/** "005": base numbers are 1-3 digits today (design note §2), padded to 3. */
export function padNumber(num: string): string {
  return /^\d+$/.test(num) ? num.padStart(3, "0") : num.toLowerCase();
}

/** `/cards/sor/005/` -- lower-case set code, padded number, trailing slash
 * (Firebase Hosting's native directory form, design note §5 / Q1). */
export function cardPath(setCode: string, num: string): string {
  return `/cards/${setCode.toLowerCase()}/${padNumber(num)}/`;
}

export function setPath(setCode: string): string {
  return `/cards/${setCode.toLowerCase()}/`;
}

/** "SOR 005", how the card prints and how players search (row 5). */
export function numberLabel(setCode: string, num: string): string {
  return `${setCode} ${padNumber(num)}`;
}

/** cp1252 bytes 0x80-0x9F (the five undefined slots map to themselves). */
const CP1252_HIGH: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** The census pattern from the design note (§8, R1). */
export const MOJIBAKE = /Ã|â€|Â|�/;

/** Repairs UTF-8 text that was decoded as cp1252 ("canâ€™t" -> "can’t",
 * "6Â or" -> "6 or"). Text without the census pattern, or text that does
 * not round-trip to valid UTF-8, is returned unchanged. */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE.test(text)) return text;
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x100) bytes.push(code);
    else if (CP1252_HIGH[ch] !== undefined) bytes.push(CP1252_HIGH[ch]);
    else return text;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

/** The data already starts with "Epic Action:" on most cards that have one;
 * the view adds the label itself, so it is stripped here (row 8). */
export function stripEpicLabel(text: string | null): string | null {
  if (text == null) return null;
  return text.replace(/^\s*Epic Action:\s*/i, "");
}

/** The newest "as of" date across the card's printings. */
export function latestAsOf(card: Pick<PublicCard, "variants">): string | null {
  let best: string | null = null;
  for (const v of card.variants) {
    const d = v.price?.as_of;
    if (d && (best == null || d > best)) best = d;
  }
  return best;
}

/** Canonical and og:url point at prod in every environment (R2). */
export const CANONICAL_ORIGIN = "https://www.hyperspacevault.com";

/** The page never names the official CDN (design note §5a, "no
 * hotlinking"): a printing's stored CDN URL is replaced by its same-origin
 * original rendition. The components only test it for presence (the flip)
 * and derive renditions from its file name, which is unchanged. */
function sameOrigin(url: string | null, images: PublicVariant["front_images"]): string | null {
  if (!url) return null;
  return images?.original ? CANONICAL_ORIGIN + images.original : null;
}

const TEXT_FIELDS = [
  "name",
  "subtitle",
  "front_text",
  "back_text",
  "epic_action",
  "artist",
] as const;

/** The card as the view renders it: text repaired, the epic-action label
 * stripped, and quantity 0 on every printing (the page is signed out). */
export function toPageCard(card: PublicCard): BaseCardDetail {
  const fixed = { ...card };
  for (const f of TEXT_FIELDS) {
    const value = fixed[f];
    if (typeof value === "string") (fixed as Record<string, unknown>)[f] = repairMojibake(value);
  }
  return {
    ...fixed,
    epic_action: stripEpicLabel(fixed.epic_action),
    traits: card.traits.map(repairMojibake),
    keywords: card.keywords.map(repairMojibake),
    variants: card.variants.map((v) => ({
      ...v,
      front_image_url: sameOrigin(v.front_image_url, v.front_images),
      back_image_url: sameOrigin(v.back_image_url, v.back_images),
      quantity: 0,
    })),
  };
}

function cardOrder(a: PublicCard, b: PublicCard): number {
  return Number(a.base_card_number) - Number(b.base_card_number);
}

/** Every page's data, in set then number order. Previous / next walk the
 * card's own set in number order (row 2). Fails when two cards map to one
 * URL (design note §8). */
export function buildPages(catalog: PublicCatalog): CardPageData[] {
  const setNames: Record<string, string> = {};
  for (const s of catalog.sets) setNames[s.code] = s.name;

  const bySet = new Map<string, PublicCard[]>();
  const seen = new Map<string, PublicCard>();
  for (const c of catalog.cards) {
    if (c.is_token) continue;
    const path = cardPath(c.set_code, c.base_card_number);
    const clash = seen.get(path);
    if (clash) {
      throw new Error(`${path} is claimed by both ${clash.name} and ${c.name}`);
    }
    seen.set(path, c);
    const list = bySet.get(c.set_code) ?? [];
    list.push(c);
    bySet.set(c.set_code, list);
  }

  const link = (c: PublicCard | undefined): CardLink | null =>
    c ? { path: cardPath(c.set_code, c.base_card_number), label: c.name } : null;

  const pages: CardPageData[] = [];
  for (const code of [...bySet.keys()].sort()) {
    const cards = bySet.get(code)!.sort(cardOrder);
    cards.forEach((c, i) => {
      const setNameByCode: Record<string, string> = {};
      for (const v of c.variants) {
        setNameByCode[v.source_set_code] =
          setNames[v.source_set_code] ?? v.source_set_name ?? v.source_set_code;
      }
      const asOf = latestAsOf(c);
      pages.push({
        card: toPageCard(c),
        setName: setNames[c.set_code] ?? c.set_name ?? c.set_code,
        setNameByCode,
        numberLabel: numberLabel(c.set_code, c.base_card_number),
        asOfLabel: asOf ? `as of ${formatAsOf(asOf)}` : null,
        prev: link(cards[i - 1]),
        next: link(cards[i + 1]),
      });
    });
  }
  return pages;
}
