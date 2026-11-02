// Sitemaps for the public pages (design note §5 "Sitemaps"):
//   /sitemap.xml               a sitemap INDEX (same URL robots.txt and
//                              Search Console already name)
//   /sitemaps/core.xml         /, /cards/ and every set page
//   /sitemaps/cards-<set>.xml  that set's card pages, so Search Console
//                              shows indexed counts per set
// Absolute URLs on the given origin (prod https://www.hyperspacevault.com;
// a dev deploy writes its own origin, and nothing points crawlers at it).
// No changefreq, no priority; lastmod only where the caller supplies one
// (manifest.mjs decides it). Pure: strings in, strings out.

const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export const SITEMAP_INDEX_PATH = "/sitemap.xml";
export const CORE_SITEMAP_PATH = "/sitemaps/core.xml";
export const setSitemapPath = (setCode) => `/sitemaps/cards-${setCode.toLowerCase()}.xml`;

function entry(tag, loc, lastmod) {
  const lm = lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : "";
  return `  <${tag}><loc>${xmlEscape(loc)}</loc>${lm}</${tag}>`;
}

function urlset(origin, paths, lastmodOf) {
  const lines = paths.map((p) => entry("url", origin + p, lastmodOf(p)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}">\n${lines.join("\n")}\n</urlset>\n`;
}

const maxDate = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;

/**
 * @param {object} o
 * @param {string} o.origin          e.g. "https://www.hyperspacevault.com"
 * @param {string[]} o.corePaths     ["/", "/cards/", "/cards/sor/", ...] in order
 * @param {Array<{code: string, paths: string[]}>} o.sets  card page paths per set, in order;
 *                                   a set with no card paths gets no sitemap
 * @param {(path: string) => string | null} [o.lastmodOf]
 * @returns {Array<{ path: string, xml: string, urls: string[] }>} the index first
 */
export function buildSitemaps({ origin, corePaths, sets, lastmodOf = () => null }) {
  const o = origin.replace(/\/+$/, "");
  const children = [{ path: CORE_SITEMAP_PATH, urls: corePaths }];
  for (const s of sets) {
    if (s.paths.length) children.push({ path: setSitemapPath(s.code), urls: s.paths });
  }
  const files = children.map((c) => ({
    path: c.path,
    urls: c.urls,
    xml: urlset(o, c.urls, lastmodOf),
    lastmod: maxDate(c.urls.map(lastmodOf)),
  }));
  const index =
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="${NS}">\n` +
    files.map((f) => entry("sitemap", o + f.path, f.lastmod)).join("\n") +
    `\n</sitemapindex>\n`;
  return [
    { path: SITEMAP_INDEX_PATH, xml: index, urls: files.map((f) => o + f.path) },
    ...files.map(({ path, xml, urls }) => ({ path, xml, urls: urls.map((u) => o + u) })),
  ];
}

/** Every <loc> value in a sitemap or sitemap index, unescaped. */
export function parseLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => xmlUnescape(m[1]));
}

export function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/.test(xml);
}

/** A URL path to the file Hosting serves for it: "/" -> "index.html",
 * "/cards/sor/005/" -> "cards/sor/005/index.html", "/sitemaps/core.xml" ->
 * "sitemaps/core.xml". */
export function fileForPath(path) {
  const rel = path.replace(/^\/+/, "");
  return rel === "" || rel.endsWith("/") ? rel + "index.html" : rel;
}
