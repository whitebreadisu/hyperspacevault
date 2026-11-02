import { CANONICAL_ORIGIN, cardPath, setPath } from "./publicCatalog";
import type { CardPageData } from "./publicCatalog";

// The card page's <head> (design note §5, D2): title, meta description,
// canonical, robots, Open Graph and the BreadcrumbList JSON-LD. Pure
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

export function breadcrumbJsonLd(p: CardPageData): object {
  const items = [
    { name: "Cards", path: "/cards/" },
    { name: p.setName, path: setPath(p.card.set_code) },
    { name: p.card.name, path: cardPath(p.card.set_code, p.card.base_card_number) },
  ];
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

/** JSON inside a <script>: `<` escaped so the text cannot close the tag. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function headHtml(p: CardPageData, opts: HeadOptions): string {
  const url = CANONICAL_ORIGIN + cardPath(p.card.set_code, p.card.base_card_number);
  const standard = p.card.variants.find((v) => v.finish === "Standard") ?? p.card.variants[0];
  const image = standard?.front_images?.w320;
  const ogTitle = `${fullName(p.card)} · ${p.numberLabel}`;
  const desc = pageDescription(p);
  const lines = [
    `<title>${esc(pageTitle(p))}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    opts.noindex ? `<meta name="robots" content="noindex" />` : null,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(ogTitle)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    image ? `<meta property="og:image" content="${esc(CANONICAL_ORIGIN + image)}" />` : null,
    `<meta name="twitter:card" content="summary" />`,
    `<script type="application/ld+json">${scriptJson(breadcrumbJsonLd(p))}</script>`,
  ];
  return lines.filter(Boolean).join("\n    ");
}
