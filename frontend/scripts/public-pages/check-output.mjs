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
//   - a sitemap URL with no file, a page file in no sitemap, a sitemap index
//     whose children are missing, mixed origins, duplicate URLs, or a
//     manifest that does not cover every page.
//
//   node scripts/public-pages/check-output.mjs <distDir> (--expect-noindex | --expect-index)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fileForPath, isSitemapIndex, parseLocs } from "./lib/sitemaps.mjs";
import { MANIFEST_PATH } from "./lib/manifest.mjs";

export const CANONICAL_ORIGIN = "https://www.hyperspacevault.com";
export const OFFICIAL_CDN = "cdn.starwarsunlimited.com";
const PRICE_RE = /\$\s*\d/;

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

function decode(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if ((attr(m[1], "type") ?? "").toLowerCase() === type) out.push({ attrs: m[1], body: m[2] });
  }
  return out;
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

/** Problems in one page. `rel` is its dist-relative posix path. */
export function checkPage(html, { rel, expectNoindex }) {
  const kind = pageKind(rel);
  const where = rel;
  const problems = [];
  const p = (msg) => problems.push(`${where}: ${msg}`);

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
  }

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

  if (html.includes(OFFICIAL_CDN)) p(`names ${OFFICIAL_CDN}`);
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
 * @param {{ expectNoindex: boolean }} opts
 * @returns {{ problems: string[], pages: number, sitemapUrls: number, kinds: Record<string, number> }}
 */
export function checkOutput(distDir, { expectNoindex }) {
  const dist = resolve(distDir);
  const problems = [];
  const files = walk(join(dist, "cards")).map((f) => toPosix(relative(dist, f)));
  const pageFiles = files.filter((f) => pageKind(f));
  const kinds = { card: 0, set: 0, index: 0 };
  const assets = new Set();

  if (pageFiles.length === 0) problems.push("no pages under cards/");
  for (const rel of pageFiles) {
    kinds[pageKind(rel)] += 1;
    const html = readFileSync(join(dist, rel), "utf8");
    problems.push(...checkPage(html, { rel, expectNoindex }));
    for (const a of assetRefs(html)) assets.add(a);
  }
  for (const rel of files.filter((f) => !pageKind(f))) {
    if (readFileSync(join(dist, rel), "utf8").includes(OFFICIAL_CDN))
      problems.push(`${rel}: names ${OFFICIAL_CDN}`);
  }
  for (const a of assets) {
    const f = join(dist, fileForPath(a));
    if (!existsSync(f)) problems.push(`page asset ${a} is not in dist`);
    else if (readFileSync(f, "utf8").includes(OFFICIAL_CDN))
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
    for (const loc of parseLocs(index)) {
      const u = new URL(loc);
      origins.add(u.origin);
      const childFile = join(dist, fileForPath(u.pathname));
      if (!existsSync(childFile)) {
        problems.push(`sitemap.xml lists ${u.pathname}, which is not in dist`);
        continue;
      }
      const child = readFileSync(childFile, "utf8");
      if (child.includes(OFFICIAL_CDN)) problems.push(`${u.pathname}: names ${OFFICIAL_CDN}`);
      if (/<changefreq>|<priority>/.test(child))
        problems.push(`${u.pathname}: carries changefreq or priority`);
      for (const l of parseLocs(child)) {
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

  return { problems, pages: pageFiles.length, sitemapUrls: sitemapUrls.size, kinds };
}

function main(argv) {
  const dir = argv.find((a) => !a.startsWith("--"));
  const noindex = argv.includes("--expect-noindex");
  const index = argv.includes("--expect-index");
  if (!dir || noindex === index) {
    console.error("usage: check-output.mjs <distDir> (--expect-noindex | --expect-index)");
    return 2;
  }
  const r = checkOutput(dir, { expectNoindex: noindex });
  const head =
    `check-output: ${r.pages} pages (${r.kinds.card} card, ${r.kinds.set} set, ${r.kinds.index} index), ` +
    `${r.sitemapUrls} sitemap URLs, expect ${noindex ? "noindex" : "index"}`;
  if (r.problems.length) {
    console.error(`${head}: ${r.problems.length} problems`);
    for (const line of r.problems.slice(0, 100)) console.error(`  - ${line}`);
    if (r.problems.length > 100) console.error(`  ... and ${r.problems.length - 100} more`);
    return 1;
  }
  console.log(`${head}: OK`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
