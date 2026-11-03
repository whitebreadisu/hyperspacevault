import type { BaseCardDetail, VariantDetail } from "../api/baseCards";
import { cardAppHref } from "../utils/cardParam";
import { linkSlug } from "../utils/printingSlug";
import type { SluggedPrinting } from "../utils/printingSlug";
import { setSortRank } from "../utils/setGrouping";
import { repairMojibake } from "../utils/mojibake";

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

/** A link to a neighbouring card: its page, and the same card inside the
 * app (`/?card=sor-006`, the desktop header arrows). */
export interface CardLink {
  path: string;
  label: string;
  appHref: string;
}

/** What one page renders from, embedded in the page as JSON for hydration. */
export interface CardPageData {
  card: BaseCardDetail;
  setName: string;
  setNameByCode: Record<string, string>;
  numberLabel: string;
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

export { repairMojibake } from "../utils/mojibake";

/** Canonical and og:url point at prod in every environment (R2). */
export const CANONICAL_ORIGIN = "https://www.hyperspacevault.com";

/** The production hostnames; a link copied there names the canonical origin. */
const PROD_HOSTNAMES = ["hyperspacevault.com", "www.hyperspacevault.com"];

/** The origin a copied card link names (App Spec §5.3): the canonical one on
 * production, the page's own origin anywhere else, so a link copied on dev
 * opens dev's page (dev's pages exist before a promote; prod's may not). */
export function shareOrigin(
  location: { hostname: string; origin: string } | undefined = globalThis.location
): string {
  if (!location || PROD_HOSTNAMES.includes(location.hostname)) return CANONICAL_ORIGIN;
  return location.origin;
}

/** The shareable link to one printing of a card (App Spec §5.3): its public
 * page on the share origin (`shareOrigin`), with `?v=<slug>` unless the
 * printing is the card's default. Tokens have no page; callers hide the
 * control for them. */
export function cardPageUrl(
  card: { set_code: string; base_card_number: string; variants: readonly SluggedPrinting[] },
  printing: SluggedPrinting | null,
  origin: string = shareOrigin()
): string {
  const base = origin + cardPath(card.set_code, card.base_card_number);
  const v = printing ? linkSlug(card.variants, printing) : null;
  return v ? `${base}?v=${encodeURIComponent(v)}` : base;
}

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

/** The card as the view renders it: text repaired and quantity 0 on every
 * printing (the page is signed out). The epic-action label is the views' own
 * rule (utils/epicAction.ts, App Spec §10), so the field passes through. */
export function toPageCard(card: PublicCard): BaseCardDetail {
  const fixed = { ...card };
  for (const f of TEXT_FIELDS) {
    const value = fixed[f];
    if (typeof value === "string") (fixed as Record<string, unknown>)[f] = repairMojibake(value);
  }
  return {
    ...fixed,
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
    c
      ? {
          path: cardPath(c.set_code, c.base_card_number),
          label: c.name,
          appHref: cardAppHref(c.set_code, c.base_card_number),
        }
      : null;

  const pages: CardPageData[] = [];
  for (const code of [...bySet.keys()].sort()) {
    const cards = bySet.get(code)!.sort(cardOrder);
    cards.forEach((c, i) => {
      const setNameByCode: Record<string, string> = {};
      for (const v of c.variants) {
        setNameByCode[v.source_set_code] =
          setNames[v.source_set_code] ?? v.source_set_name ?? v.source_set_code;
      }
      pages.push({
        card: toPageCard(c),
        setName: setNames[c.set_code] ?? c.set_name ?? c.set_code,
        setNameByCode,
        numberLabel: numberLabel(c.set_code, c.base_card_number),
        prev: link(cards[i - 1]),
        next: link(cards[i + 1]),
      });
    });
  }
  return pages;
}

// ── Set pages and the set index (design note §5 "Internal linking") ──────

/** One row of a set page: every non-token card, in number order. */
export interface SetPageCard {
  name: string;
  subtitle: string | null;
  /** "SOR 005" */
  numberLabel: string;
  rarity: string;
  path: string;
}

/** `/cards/sor/` -- what one set page renders from. */
export interface SetPageData {
  code: string;
  name: string;
  path: string;
  cards: SetPageCard[];
}

/** One row of the set index. */
export interface IndexSet {
  code: string;
  name: string;
  path: string;
  count: number;
}

/** `/cards/` -- the sets that have card pages, newest first (ADR-0031). */
export interface IndexPageData {
  sets: IndexSet[];
  /** Card pages across every set. */
  total: number;
}

function nonTokenBySet(catalog: PublicCatalog): Map<string, PublicCard[]> {
  const bySet = new Map<string, PublicCard[]>();
  for (const c of catalog.cards) {
    if (c.is_token) continue;
    const list = bySet.get(c.set_code) ?? [];
    list.push(c);
    bySet.set(c.set_code, list);
  }
  for (const list of bySet.values()) list.sort(cardOrder);
  return bySet;
}

/** ADR-0031: the main block newest first, then the secondary base sets
 * (setSortRank); a set outside both lists by release date, newest first,
 * then by code. */
export function compareSetsNewestFirst(
  a: Pick<PublicSet, "code" | "release_date">,
  b: Pick<PublicSet, "code" | "release_date">
): number {
  const r = setSortRank(a.code) - setSortRank(b.code);
  if (r !== 0) return r;
  const da = a.release_date ?? "";
  const db = b.release_date ?? "";
  if (da !== db) return da < db ? 1 : -1;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function setNameOf(catalog: PublicCatalog, code: string, fallback?: string | null): string {
  return catalog.sets.find((s) => s.code === code)?.name ?? fallback ?? code;
}

/** Every set page's data, one per set that has card pages. */
export function buildSetPages(catalog: PublicCatalog): SetPageData[] {
  const bySet = nonTokenBySet(catalog);
  return [...bySet.entries()].map(([code, cards]) => ({
    code,
    name: repairMojibake(setNameOf(catalog, code, cards[0]?.set_name)),
    path: setPath(code),
    cards: cards.map((c) => ({
      name: repairMojibake(c.name),
      subtitle: c.subtitle ? repairMojibake(c.subtitle) : null,
      numberLabel: numberLabel(c.set_code, c.base_card_number),
      rarity: c.rarity,
      path: cardPath(c.set_code, c.base_card_number),
    })),
  }));
}

/** The set index's data. */
export function buildIndexPage(catalog: PublicCatalog): IndexPageData {
  const bySet = nonTokenBySet(catalog);
  const release = (code: string) => catalog.sets.find((s) => s.code === code)?.release_date ?? null;
  const sets = [...bySet.entries()]
    .map(([code, cards]) => ({
      code,
      name: repairMojibake(setNameOf(catalog, code, cards[0]?.set_name)),
      path: setPath(code),
      count: cards.length,
      release_date: release(code),
    }))
    .sort(compareSetsNewestFirst)
    .map(({ code, name, path, count }) => ({ code, name, path, count }));
  return { sets, total: sets.reduce((n, s) => n + s.count, 0) };
}
