// Generated-output check for the public pages (design note §8 "Generator CI
// check"). Reads a built dist and fails on any of:
//   - a card, set or index page without exactly one <h1>, a canonical (to
//     https://www.hyperspacevault.com + the page's own path), a <title> or a
//     meta description;
//   - JSON-LD that does not parse (card pages must carry at least one);
//   - a card page without both layout trees (#pc-desktop, #pc-phone) or
//     without parseable embedded #card-data JSON;
//   - a robots noindex meta present when --expect-index, or absent when
//     --expect-noindex;
//   - `cdn.starwarsunlimited.com` in any page, sitemap, manifest or any
//     /assets/ file a page loads;
//   - a price figure ($ amount) in the meta description, og:description,
//     twitter:description or JSON-LD (C4), or an Offer in JSON-LD;
//   - a known swuapi markup token (`<uq>`, `<bullet>`) left literal in a
//     page's visible text or attribute values (escaped there as
//     `&lt;uq&gt;`) or in a description / JSON-LD (App Spec §10); any other
//     `<tag>` there is a warning only (see below);
//   - a sitemap URL with no file, a page file in no sitemap, a sitemap index
//     whose children are missing, mixed origins, duplicate URLs, or a
//     manifest that does not cover every page;
//   - a sitemap <loc> not on --expect-origin, or a sitemap over 50,000 URLs
//     or 50 MB.
//
//   node scripts/public-pages/check-output.mjs <distDir> (--expect-noindex | --expect-index)
//       [--expect-origin <url>] [--summary <file>]
//
// An unknown markup tag (one with no rendering rule) is a warning, not a
// problem: printed as a GitHub Actions ::warning:: line and, with --summary,
// appended to that file (the step summary); the exit code stays 0.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fileForPath, isSitemapIndex, parseLocs } from "./lib/sitemaps.mjs";
import { MANIFEST_PATH } from "./lib/manifest.mjs";
import { OFFICIAL_CDN, namesOfficialCdn } from "./lib/officialCdn.mjs";
import cardTextTokens from "../../src/utils/cardTextTokens.json" with { type: "json" };

export const CANONICAL_ORIGIN = "https://www.hyperspacevault.com";
export { OFFICIAL_CDN };
/** sitemaps.org limits per sitemap file (and per index). */
export const MAX_SITEMAP_URLS = 50_000;
export const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const PRICE_RE = /\$\s*\d/;
/** A markup tag in decoded text: open, close or self-closing, with optional
 * attributes and hyphenated names (`<uq>`, `</bullet>`, `<uq/>`,
 * `<icon name="x">`, `<foo-bar>`). `<3` or `a < b` is not one. */
const TOKEN_RE = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi;
/** The tokens the renderer has a rule for, from the renderer's own list
 * (src/utils/cardTextTokens.json, read by utils/cardText.ts): one left literal
 * is a renderer bug and fails. Any other tag is one swuapi added since: a
 * warning, so a new tag never blocks a deploy or a promote, while the page
 * shows it as text until it gets a rule. */
export const KNOWN_TOKENS = new Set(cardTextTokens.known.map((t) => t.toLowerCase()));
export const isKnownToken = (t) => KNOWN_TOKENS.has(t.toLowerCase());
/** Element names a raw (unescaped) known token would parse as. */
const KNOWN_ELEMENT_NAMES = new Set([...KNOWN_TOKENS].map((t) => t.replace(/[</>]/g, "")));

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const toPosix = (p) => p.split(sep).join("/");

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3]) : null;
}

const NAMED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

/** Decodes the named entities above (any case: `&LT;` is legal HTML) and
 * every numeric one (`&#60;`, `&#x3c;`), in one pass so `&amp;lt;` stays
 * `&lt;`. */
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function tags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))].map((m) => m[0]);
}

function metaContent(html, key, value) {
  return tags(html, "meta")
    .filter((t) => (attr(t, key) ?? "").toLowerCase() === value)
    .map((t) => decode(attr(t, "content") ?? ""));
}

function scripts(html, type) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    if ((attr(m[1], "type") ?? "").toLowerCase() === type) out.push({ attrs: m[1], body: m[2] });
  }
  return out;
}

/** A page tag, quote-aware (a quoted attribute value may hold a raw `>`). */
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<!--[\s\S]*?-->|<![^>]*>/g;
const ATTR_RE = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
/** The meta descriptions checkPage reads as snippets: not page text again. */
const SNIPPET_META = /^(description|og:description|twitter:description)$/i;

/** Markup tokens a reader of the page could see: in its decoded text and
 * decoded attribute values, outside <script> and <style> bodies (the
 * #card-data JSON holds the raw source text on purpose), plus a known token
 * that reached the page unescaped as an element (`<uq>`). The snippet metas
 * are left to the snippet check. */
export function visibleMarkupTokens(html) {
  const outside = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const found = new Set();
  const scan = (text) => {
    for (const t of decode(text).match(TOKEN_RE) ?? []) found.add(t);
  };
  let at = 0;
  for (const m of outside.matchAll(TAG_RE)) {
    scan(outside.slice(at, m.index));
    at = m.index + m[0].length;
    if (!m[2]) continue; // a comment or doctype
    const name = m[2].toLowerCase();
    if (KNOWN_ELEMENT_NAMES.has(name)) found.add(`<${m[1]}${name}>`);
    const attrs = [...(m[3] ?? "").matchAll(ATTR_RE)];
    const isSnippet =
      name === "meta" &&
      attrs.some(
        ([, k, a, b, c]) => /^(name|property)$/i.test(k) && SNIPPET_META.test(a ?? b ?? c)
      );
    for (const [, k, a, b, c] of attrs) {
      if (isSnippet && k.toLowerCase() === "content") continue;
      scan(a ?? b ?? c ?? "");
    }
  }
  scan(outside.slice(at));
  return [...found];
}

/** "cards/sor/005/index.html" -> "card"; "cards/sor/index.html" -> "set";
 * "cards/index.html" -> "index"; anything else -> null. */
export function pageKind(rel) {
  if (/^cards\/index\.html$/.test(rel)) return "index";
  if (/^cards\/[^/]+\/index\.html$/.test(rel)) return "set";
  if (/^cards\/[^/]+\/[^/]+\/index\.html$/.test(rel)) return "card";
  return null;
}

export function pathForFile(rel) {
  return "/" + rel.replace(/index\.html$/, "");
}

/** Problems in one page. `rel` is its dist-relative posix path; non-failing
 * findings (an unknown markup tag) go to `warnings` when given. */
export function checkPage(html, { rel, expectNoindex, warnings = [] }) {
  const kind = pageKind(rel);
  const where = rel;
  const problems = [];
  const p = (msg) => problems.push(`${where}: ${msg}`);
  const w = (msg) => warnings.push(`${where}: ${msg}`);
  /** Known tokens fail, unknown tags warn. */
  const tokenFindings = (found, label) => {
    const known = found.filter(isKnownToken);
    const unknown = found.filter((t) => !isKnownToken(t));
    if (known.length) p(`literal markup token in ${label}: ${known.join(", ")}`);
    if (unknown.length)
      w(`unknown markup tag in ${label} (no rendering rule): ${unknown.join(", ")}`);
  };

  const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1 !== 1) p(`${h1} <h1> elements (want exactly 1)`);

  const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => m[1].trim());
  if (titles.length !== 1 || !titles[0]) p(`${titles.length} <title> elements or an empty title`);

  const canon = tags(html, "link").filter(
    (t) => (attr(t, "rel") ?? "").toLowerCase() === "canonical"
  );
  const want = CANONICAL_ORIGIN + pathForFile(rel);
  if (canon.length !== 1) p(`${canon.length} canonical links (want 1)`);
  else if (decode(attr(canon[0], "href") ?? "") !== want) {
    p(`canonical ${attr(canon[0], "href")} (want ${want})`);
  }

  const desc = metaContent(html, "name", "description");
  if (desc.length !== 1 || !desc[0].trim()) p("missing or empty meta description");

  const robots = metaContent(html, "name", "robots").join(",").toLowerCase();
  const noindex = /\bnoindex\b/.test(robots);
  if (expectNoindex && !noindex) p("no robots noindex meta (dev build must carry one)");
  if (!expectNoindex && noindex)
    p("robots noindex meta present (a prod page with noindex deindexes the site)");

  const snippets = [
    ...desc.map((d) => ["meta description", d]),
    ...metaContent(html, "property", "og:description").map((d) => ["og:description", d]),
    ...metaContent(html, "name", "twitter:description").map((d) => ["twitter:description", d]),
  ];
  const ld = scripts(html, "application/ld+json");
  if (kind === "card" && ld.length === 0) p("no JSON-LD");
  for (const s of ld) {
    try {
      const parsed = JSON.parse(s.body);
      const text = JSON.stringify(parsed);
      snippets.push(["JSON-LD", text]);
      if (/"@type":"(Aggregate)?Offer"|"price"\s*:/.test(text))
        p("JSON-LD carries an Offer or a price");
    } catch (err) {
      p(`JSON-LD does not parse (${err instanceof Error ? err.message : err})`);
    }
  }
  for (const [label, text] of snippets) {
    if (PRICE_RE.test(text)) p(`price figure in ${label}: ${text.match(/\$\s*[\d.,]+/)?.[0]}`);
    tokenFindings([...new Set(text.match(TOKEN_RE) ?? [])], label);
  }
  tokenFindings(visibleMarkupTokens(html), "the page text");

  if (kind === "card") {
    if (!/\bid=["']pc-desktop["']/.test(html)) p("no desktop layout tree (#pc-desktop)");
    if (!/\bid=["']pc-phone["']/.test(html)) p("no phone layout tree (#pc-phone)");
    const data = scripts(html, "application/json").filter(
      (s) => attr(s.attrs, "id") === "card-data"
    );
    if (data.length !== 1) p(`${data.length} #card-data scripts (want 1)`);
    else {
      try {
        JSON.parse(data[0].body);
      } catch {
        p("#card-data JSON does not parse");
      }
    }
  }

  if (namesOfficialCdn(html)) p(`names ${OFFICIAL_CDN}`);
  return problems;
}

function assetRefs(html) {
  const refs = new Set();
  for (const t of [...tags(html, "script"), ...tags(html, "link")]) {
    const v = attr(t, "src") ?? attr(t, "href");
    if (v && v.startsWith("/assets/")) refs.add(v.split(/[?#]/)[0]);
  }
  return refs;
}

/**
 * @param {string} distDir
 * @param {{ expectNoindex: boolean, expectOrigin?: string }} opts  every sitemap
 *   <loc> must start with `expectOrigin` (the origin the deploy wrote) when given
 * @returns {{ problems: string[], warnings: string[], pages: number, sitemapUrls: number, kinds: Record<string, number> }}
 */
export function checkOutput(
  distDir,
  { expectNoindex, expectOrigin, maxUrls = MAX_SITEMAP_URLS, maxBytes = MAX_SITEMAP_BYTES }
) {
  const wantOrigin = expectOrigin ? expectOrigin.replace(/[/]+$/, "") + "/" : null;
  const offOrigin = (loc, where) => {
    if (wantOrigin && !loc.startsWith(wantOrigin))
      problems.push(`${where} lists ${loc}, not on ${wantOrigin}`);
  };
  const limits = (xml, where) => {
    const n = parseLocs(xml).length;
    if (n > maxUrls) problems.push(`${where} has ${n} URLs (limit ${maxUrls})`);
    const bytes = Buffer.byteLength(xml);
    if (bytes > maxBytes) problems.push(`${where} is ${bytes} bytes (limit ${maxBytes})`);
  };
  const dist = resolve(distDir);
  const problems = [];
  const warnings = [];
  const files = walk(join(dist, "cards")).map((f) => toPosix(relative(dist, f)));
  const pageFiles = files.filter((f) => pageKind(f));
  const kinds = { card: 0, set: 0, index: 0 };
  const assets = new Set();

  if (pageFiles.length === 0) problems.push("no pages under cards/");
  for (const rel of pageFiles) {
    kinds[pageKind(rel)] += 1;
    const html = readFileSync(join(dist, rel), "utf8");
    problems.push(...checkPage(html, { rel, expectNoindex, warnings }));
    for (const a of assetRefs(html)) assets.add(a);
  }
  if (pageFiles.length > 0 && kinds.card === 0) problems.push("no card pages under cards/");

  for (const rel of files.filter((f) => !pageKind(f))) {
    if (namesOfficialCdn(readFileSync(join(dist, rel), "utf8")))
      problems.push(`${rel}: names ${OFFICIAL_CDN}`);
  }
  for (const a of assets) {
    const f = join(dist, fileForPath(a));
    if (!existsSync(f)) problems.push(`page asset ${a} is not in dist`);
    else if (namesOfficialCdn(readFileSync(f, "utf8")))
      problems.push(`page asset ${a} names ${OFFICIAL_CDN}`);
  }

  // Sitemaps: the index, its children, and the two-way page <-> URL match.
  const sitemapUrls = new Set();
  const origins = new Set();
  const indexFile = join(dist, "sitemap.xml");
  if (!existsSync(indexFile)) problems.push("sitemap.xml is missing");
  else {
    const index = readFileSync(indexFile, "utf8");
    if (!isSitemapIndex(index)) problems.push("sitemap.xml is not a sitemap index");
    limits(index, "sitemap.xml");
    for (const loc of parseLocs(index)) {
      offOrigin(loc, "sitemap.xml");
      const u = new URL(loc);
      origins.add(u.origin);
      const childFile = join(dist, fileForPath(u.pathname));
      if (!existsSync(childFile)) {
        problems.push(`sitemap.xml lists ${u.pathname}, which is not in dist`);
        continue;
      }
      const child = readFileSync(childFile, "utf8");
      if (namesOfficialCdn(child)) problems.push(`${u.pathname}: names ${OFFICIAL_CDN}`);
      limits(child, u.pathname);
      if (/<changefreq>|<priority>/.test(child))
        problems.push(`${u.pathname}: carries changefreq or priority`);
      for (const l of parseLocs(child)) {
        offOrigin(l, u.pathname);
        const cu = new URL(l);
        origins.add(cu.origin);
        if (sitemapUrls.has(cu.pathname)) problems.push(`${cu.pathname} is listed twice`);
        sitemapUrls.add(cu.pathname);
        if (!existsSync(join(dist, fileForPath(cu.pathname)))) {
          problems.push(`${u.pathname} lists ${cu.pathname}, which has no file`);
        }
      }
    }
  }
  if (origins.size > 1) problems.push(`sitemaps mix origins: ${[...origins].join(", ")}`);
  for (const rel of pageFiles) {
    if (!sitemapUrls.has(pathForFile(rel))) problems.push(`${rel} is in no sitemap`);
  }

  const manifestFile = join(dist, fileForPath(MANIFEST_PATH));
  if (!existsSync(manifestFile)) problems.push(`${MANIFEST_PATH} is missing`);
  else {
    try {
      const m = JSON.parse(readFileSync(manifestFile, "utf8"));
      for (const rel of pageFiles) {
        if (!m.pages?.[pathForFile(rel)]?.hash)
          problems.push(`${MANIFEST_PATH} has no hash for ${pathForFile(rel)}`);
      }
    } catch {
      problems.push(`${MANIFEST_PATH} does not parse`);
    }
  }

  return { problems, warnings, pages: pageFiles.length, sitemapUrls: sitemapUrls.size, kinds };
}

function main(argv) {
  const si = argv.indexOf("--summary");
  const summary = si >= 0 ? argv[si + 1] : undefined;
  if (si >= 0 && (!summary || summary.startsWith("--"))) {
    console.error("--summary needs a file");
    return 2;
  }
  const oi = argv.indexOf("--expect-origin");
  const expectOrigin = oi >= 0 ? argv[oi + 1] : undefined;
  if (oi >= 0 && (!expectOrigin || expectOrigin.startsWith("--"))) {
    console.error("--expect-origin needs a URL");
    return 2;
  }
  const dir = argv.find(
    (a, i) => !a.startsWith("--") && !(oi >= 0 && i === oi + 1) && !(si >= 0 && i === si + 1)
  );
  const noindex = argv.includes("--expect-noindex");
  const index = argv.includes("--expect-index");
  if (!dir || noindex === index) {
    console.error(
      "usage: check-output.mjs <distDir> (--expect-noindex | --expect-index) [--expect-origin <url>] [--summary <file>]"
    );
    return 2;
  }
  const r = checkOutput(dir, { expectNoindex: noindex, expectOrigin });
  const head =
    `check-output: ${r.pages} pages (${r.kinds.card} card, ${r.kinds.set} set, ${r.kinds.index} index), ` +
    `${r.sitemapUrls} sitemap URLs, expect ${noindex ? "noindex" : "index"}` +
    (expectOrigin ? ` on ${expectOrigin}` : "");
  for (const line of r.warnings) console.log(`::warning title=check-output::${line}`);
  if (summary && r.warnings.length) {
    appendFileSync(
      summary,
      [
        "",
        `### check-output: ${r.warnings.length} warning(s)`,
        "",
        ...r.warnings.map((l) => `- ⚠ ${l}`),
        "",
      ].join("\n")
    );
  }
  if (r.problems.length) {
    console.error(`${head}: ${r.problems.length} problems`);
    for (const line of r.problems.slice(0, 100)) console.error(`  - ${line}`);
    if (r.problems.length > 100) console.error(`  ... and ${r.problems.length - 100} more`);
    return 1;
  }
  console.log(`${head}: OK` + (r.warnings.length ? ` (${r.warnings.length} warnings)` : ""));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
