import { CANONICAL_ORIGIN, cardPath, setPath } from "./publicCatalog";
import type { CardPageData, IndexPageData, SetPageData } from "./publicCatalog";
import { AUTO_OPEN_JS, autoOpenConfig } from "./autoOpen";

// The public pages' <head> (design note §5, D2): title, meta description,
// canonical, robots, Open Graph and the BreadcrumbList JSON-LD, for the card
// pages, the set pages (`/cards/sor/`) and the set index (`/cards/`). Pure
// functions: the generator calls them, a test checks them.
//
// No price figure goes into the description, og:description or JSON-LD
// (C4): a frozen number would surface in snippets without its date.

export { CANONICAL_ORIGIN };

export interface HeadOptions {
  /** Dev builds emit a robots noindex meta (PUBLIC_PAGES_NOINDEX, R2). */
  noindex: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Luke Skywalker - Faithful Friend" */
export function fullName(d: Pick<CardPageData["card"], "name" | "subtitle">): string {
  return d.subtitle ? `${d.name} - ${d.subtitle}` : d.name;
}

export function pageTitle(p: CardPageData): string {
  return `${fullName(p.card)} · ${p.numberLabel} · Price and printings · HyperspaceVault`;
}

/** Built from type, aspects and cost / power / HP; prices are mentioned
 * without a figure. */
export function pageDescription(p: CardPageData): string {
  const c = p.card;
  const type = c.type2 && c.type !== c.type2 ? `${c.type} (${c.type2})` : c.type;
  const aspects = c.aspects.length ? `, ${c.aspects.join(" / ")}` : "";
  const stats = [
    c.cost != null ? `cost ${c.cost}` : null,
    c.power != null ? `power ${c.power}` : null,
    c.hp != null ? `HP ${c.hp}` : null,
  ].filter(Boolean);
  const printings = c.variants.length === 1 ? "1 printing" : `${c.variants.length} printings`;
  return (
    `${fullName(c)}, ${p.numberLabel}, ${p.setName}. ${type}${aspects}` +
    (stats.length ? `, ${stats.join(", ")}` : "") +
    `. Card text, ${printings} and current TCGplayer prices for every printing.`
  );
}

interface Crumb {
  name: string;
  path: string;
}

function breadcrumbs(items: Crumb[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: CANONICAL_ORIGIN + it.path,
    })),
  };
}

const CARDS_CRUMB: Crumb = { name: "Cards", path: "/cards/" };

export function breadcrumbJsonLd(p: CardPageData): object {
  return breadcrumbs([
    CARDS_CRUMB,
    { name: p.setName, path: setPath(p.card.set_code) },
    { name: p.card.name, path: cardPath(p.card.set_code, p.card.base_card_number) },
  ]);
}

export function setBreadcrumbJsonLd(p: SetPageData): object {
  return breadcrumbs([CARDS_CRUMB, { name: p.name, path: p.path }]);
}

export function indexBreadcrumbJsonLd(): object {
  return breadcrumbs([CARDS_CRUMB]);
}

/** JSON inside a <script>: `<` escaped so the text cannot close the tag. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

interface HeadFields {
  title: string;
  description: string;
  path: string;
  ogTitle: string;
  /** Same-origin path of the og:image, if any. */
  image?: string | null;
  jsonLd: object;
}

function headLines(f: HeadFields, opts: HeadOptions): string {
  const url = CANONICAL_ORIGIN + f.path;
  const lines = [
    `<title>${esc(f.title)}</title>`,
    `<meta name="description" content="${esc(f.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    opts.noindex ? `<meta name="robots" content="noindex" />` : null,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(f.ogTitle)}" />`,
    `<meta property="og:description" content="${esc(f.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    f.image ? `<meta property="og:image" content="${esc(CANONICAL_ORIGIN + f.image)}" />` : null,
    `<meta name="twitter:card" content="summary" />`,
    `<script type="application/ld+json">${scriptJson(f.jsonLd)}</script>`,
  ];
  return lines.filter(Boolean).join(HEAD_SEP);
}

const HEAD_SEP = "\n    ";

/** The card page's returning-visitor redirect (autoOpen.ts), first in the
 * head; the config is JSON with `<` escaped, so no value can close the tag. */
export function autoOpenScript(p: CardPageData, hosts?: readonly string[]): string {
  return `<script>${AUTO_OPEN_JS}(${scriptJson(autoOpenConfig(p.card, hosts))});</script>`;
}

export function headHtml(p: CardPageData, opts: HeadOptions): string {
  const standard = p.card.variants.find((v) => v.finish === "Standard") ?? p.card.variants[0];
  return (
    autoOpenScript(p) +
    HEAD_SEP +
    headLines(
      {
        title: pageTitle(p),
        description: pageDescription(p),
        path: cardPath(p.card.set_code, p.card.base_card_number),
        ogTitle: `${fullName(p.card)} · ${p.numberLabel}`,
        image: standard?.front_images?.w320,
        jsonLd: breadcrumbJsonLd(p),
      },
      opts
    )
  );
}

/** "Spark of Rebellion (SOR) card list · Prices and printings · HyperspaceVault" */
export function setPageTitle(p: SetPageData): string {
  return `${p.name} (${p.code}) card list · Prices and printings · HyperspaceVault`;
}

/** No price figure (C4). */
export function setPageDescription(p: SetPageData): string {
  const n = p.cards.length === 1 ? "1 card" : `${p.cards.length} cards`;
  return (
    `Every Star Wars: Unlimited card in ${p.name} (${p.code}), ${n} in number order. ` +
    `Card text, rarity, printings and current TCGplayer prices for each card.`
  );
}

export function setHeadHtml(p: SetPageData, opts: HeadOptions): string {
  return headLines(
    {
      title: setPageTitle(p),
      description: setPageDescription(p),
      path: p.path,
      ogTitle: `${p.name} (${p.code}) card list`,
      jsonLd: setBreadcrumbJsonLd(p),
    },
    opts
  );
}

export const INDEX_TITLE = "Star Wars: Unlimited card list · Every set · HyperspaceVault";

export function indexPageDescription(p: IndexPageData): string {
  const sets = p.sets.length === 1 ? "1 set" : `${p.sets.length} sets`;
  return (
    `Every Star Wars: Unlimited set, newest first: ${sets} and ${p.total} cards. ` +
    `Card text, printings and current TCGplayer prices for every card.`
  );
}

export function indexHeadHtml(p: IndexPageData, opts: HeadOptions): string {
  return headLines(
    {
      title: INDEX_TITLE,
      description: indexPageDescription(p),
      path: "/cards/",
      ogTitle: "Star Wars: Unlimited card list",
      jsonLd: indexBreadcrumbJsonLd(),
    },
    opts
  );
}
