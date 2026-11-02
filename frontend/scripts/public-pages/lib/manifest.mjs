// The lastmod manifest (design note §3 guard 3, §5 "Sitemaps").
//
// The generator publishes /sitemaps/manifest.json: every public page's URL
// path -> { hash, lastmod }. The next deploy fetches the LIVE copy from the
// target environment (the live site is the only state store, so CI stays
// stateless) and sets a page's sitemap <lastmod> as follows:
//   - no live manifest (first deploy, or the live site predates card pages):
//     no lastmod anywhere. Stamping today's date on every URL would claim a
//     change nobody can verify, and Google treats an inaccurate lastmod as a
//     reason to ignore the site's lastmods; omitting it is always valid.
//   - same hash as the live entry: the live entry's lastmod is carried
//     forward (it may be null), so an unchanged page keeps its date;
//   - a different hash, or a URL the live manifest does not have: today
//     (UTC date of the deploy).
//
// The hash must not move when only the build moves. contentHash() therefore
// hashes the page with its volatile bytes removed:
//   - every <script> and <link> tag that references /assets/ (the page
//     bundle, its chunks, CSS and preloads: Vite's hashed names, and the set
//     of chunks itself, change whenever any app code changes);
//   - the hash in any other /assets/ reference (an <img> of an aspect icon:
//     "/assets/SWH_Aspects_Vigilance-BC5CGWLo.png" -> ".../SWH_Aspects_Vigilance.png");
//   - the <meta name="build-sha"> tag (changes on every commit);
//   - every price "as of" date: the visible "as of Nov 1, 2026" label and
//     each `"as_of":"2026-11-01"` field in the embedded #card-data JSON
//     (the daily price sync re-dates unchanged prices every day);
//   - anything matching the caller's extra `volatile` patterns.
// What remains is the card content and the SEO head: name, text, printings,
// price VALUES, links, JSON-LD. A price value change is a real change to a
// page titled "Price and printings", so it bumps lastmod; a re-dated but
// unchanged price does not.

import { createHash } from "node:crypto";

export const MANIFEST_PATH = "/sitemaps/manifest.json";
export const MANIFEST_VERSION = 1;

const ASSET_TAG_RE = /<(?:script|link)\b[^>]*?\/assets\/[^>]*>(?:\s*<\/script>)?/gi;
const ASSET_HASH_RE = /(\/assets\/[^"'\s>]*?)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)/g;
const BUILD_SHA_RE = /<meta\b[^>]*\bname=["']build-sha["'][^>]*>/gi;
const AS_OF_LABEL_RE = /\bas of (?:<!-- -->)?[A-Z][a-z]{2} \d{1,2}, \d{4}/g;
const AS_OF_FIELD_RE = /"as_of":"[^"]*"/g;

/** The page with its build-volatile bytes removed (see the header). */
export function normalizeForHash(html, volatile = []) {
  let out = html
    .replace(ASSET_TAG_RE, "")
    .replace(BUILD_SHA_RE, "")
    .replace(ASSET_HASH_RE, "$1$2")
    .replace(AS_OF_LABEL_RE, "as of")
    .replace(AS_OF_FIELD_RE, '"as_of":""');
  for (const re of volatile) out = out.replace(re, "");
  return out;
}

/** "sha256:<first 32 hex>" of the normalized page. */
export function contentHash(html, volatile = []) {
  const h = createHash("sha256").update(normalizeForHash(html, volatile), "utf8").digest("hex");
  return `sha256:${h.slice(0, 32)}`;
}

/** "2026-11-02" in UTC. */
export function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Live manifest entries may be a bare hash string (tolerated) or {hash, lastmod}. */
function liveEntry(v) {
  if (typeof v === "string") return { hash: v, lastmod: null };
  if (v && typeof v === "object" && typeof v.hash === "string") {
    return { hash: v.hash, lastmod: typeof v.lastmod === "string" ? v.lastmod : null };
  }
  return null;
}

/** Every network read gives up after this long. */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * Reads the target environment's live manifest. Only a 404 means "no live
 * manifest" (`manifest: null`: the deploy goes ahead with no lastmod).
 * Anything else that is not a 200 with a { pages } object throws (a 5xx, a
 * 403, a body that is not JSON or has no pages map, a network error or a
 * timeout): a manifest that exists but cannot be read must not silently
 * reset every lastmod.
 * @returns {Promise<{ manifest: object | null, reason: string }>}
 */
export async function fetchLiveManifest({ origin, fetch = globalThis.fetch }) {
  const url = origin.replace(/\/+$/, "") + MANIFEST_PATH;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return { manifest: null, reason: "no live manifest (HTTP 404)" };
  if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`GET ${url}: the live manifest is not JSON`);
  }
  if (!body || typeof body !== "object" || !body.pages || typeof body.pages !== "object") {
    throw new Error(`GET ${url}: the live manifest has no pages map`);
  }
  return { manifest: body, reason: `live manifest with ${Object.keys(body.pages).length} pages` };
}

/**
 * @param {object} o
 * @param {object | null} o.live       the live manifest, or null
 * @param {Record<string, string>} o.hashes  path -> contentHash() of this build
 * @param {string} o.today             "YYYY-MM-DD"
 * @returns {{ manifest: object, lastmodOf: (path: string) => string | null,
 *             stats: { changed: number, added: number, unchanged: number, firstDeploy: boolean } }}
 */
export function buildManifest({ live, hashes, today }) {
  const pages = {};
  const stats = { changed: 0, added: 0, unchanged: 0, firstDeploy: live == null };
  for (const path of Object.keys(hashes).sort()) {
    const hash = hashes[path];
    if (live == null) {
      pages[path] = { hash, lastmod: null };
      continue;
    }
    const prev = liveEntry(live.pages[path]);
    if (!prev) {
      stats.added += 1;
      pages[path] = { hash, lastmod: today };
    } else if (prev.hash !== hash) {
      stats.changed += 1;
      pages[path] = { hash, lastmod: today };
    } else {
      stats.unchanged += 1;
      pages[path] = { hash, lastmod: prev.lastmod };
    }
  }
  return {
    manifest: { version: MANIFEST_VERSION, pages },
    lastmodOf: (path) => pages[path]?.lastmod ?? null,
    stats,
  };
}

/** One line for the job summary. */
export function manifestSummary(stats) {
  if (stats.firstDeploy)
    return "lastmod: no live manifest, so no lastmod this deploy (first deploy)";
  return `lastmod: ${stats.changed} changed, ${stats.added} new, ${stats.unchanged} unchanged vs the live manifest`;
}
