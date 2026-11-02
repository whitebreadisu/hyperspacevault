// Deploy-step guards for the card-page generator (design note §3 "Guards"):
//   1. completeness: the catalog's non-token cards, sum(counts) and the
//      non-token rows of the existing GET /api/base-cards list all agree, so
//      a partial read fails the deploy before anything is uploaded;
//   2. shrink: the new page count is at least 95% of the card URLs the
//      target environment's LIVE sitemaps list today (first deploy: baseline
//      0), with a logged override for a legitimate shrink.
// Guard 3 (the lastmod manifest) is manifest.mjs; guards 4 and 5 are deploy
// ordering and a rollback note, not code.

import { isSitemapIndex, parseLocs } from "./sitemaps.mjs";

export class GuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "GuardError";
  }
}

export const SHRINK_THRESHOLD = 0.95;

/** A card page path: /cards/<set>/<num>/ (not /cards/ or /cards/<set>/). */
export const CARD_PATH_RE = /^\/cards\/[^/]+\/[^/]+\/$/;

const nonToken = (rows) => rows.filter((r) => !r.is_token);

/**
 * Guard 1. `pagesRendered` (optional) is the number of card pages the
 * generator wrote; when given it must equal the other three.
 * @returns {{ ok: true, count: number, line: string }}
 * @throws {GuardError}
 */
export function checkCompleteness({ catalog, baseCardList, pagesRendered }) {
  const cards = nonToken(catalog.cards);
  const sumCounts = Object.values(catalog.counts).reduce((a, b) => a + Number(b), 0);
  const listCount = nonToken(baseCardList).length;
  const problems = [];
  if (cards.length !== sumCounts) {
    problems.push(`catalog has ${cards.length} non-token cards but sum(counts) is ${sumCounts}`);
  }
  if (listCount !== sumCounts) {
    problems.push(
      `GET /api/base-cards has ${listCount} non-token rows but sum(counts) is ${sumCounts}`
    );
  }
  // Per set as well: equal totals could hide one set short and another long.
  const perSet = {};
  for (const c of cards) perSet[c.set_code] = (perSet[c.set_code] ?? 0) + 1;
  for (const code of new Set([...Object.keys(perSet), ...Object.keys(catalog.counts)])) {
    const have = perSet[code] ?? 0;
    const want = Number(catalog.counts[code] ?? 0);
    if (have !== want) problems.push(`set ${code}: ${have} non-token cards, counts says ${want}`);
  }
  if (pagesRendered != null && pagesRendered !== sumCounts) {
    problems.push(`rendered ${pagesRendered} card pages but sum(counts) is ${sumCounts}`);
  }
  if (problems.length) {
    throw new GuardError(`completeness guard failed: ${problems.join("; ")}`);
  }
  return {
    ok: true,
    count: sumCounts,
    line: `completeness: ${sumCounts} non-token cards = sum(counts) = GET /api/base-cards non-token rows`,
  };
}

function pathOf(loc) {
  try {
    return new URL(loc).pathname;
  } catch {
    return loc;
  }
}

async function getText(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: "application/xml,text/xml,*/*" } });
  return { status: res.status, ok: res.ok, text: res.ok ? await res.text() : "" };
}

/**
 * Counts the card URLs the target environment's live sitemaps list.
 * The live /sitemap.xml is either
 *   - the pre-card-pages plain `urlset` (one URL, no /cards/ URLs): the
 *     first deploy, baseline 0; or
 *   - the sitemap index this generator writes: every child sitemap is read
 *     (its path, on `origin`) and its card URLs counted.
 * Any other failure (network, 5xx, a 404 sitemap, an unreadable child) fails
 * closed: without a baseline the guard cannot tell a shrink from a first
 * deploy. The override still applies (checkShrink).
 *
 * @returns {Promise<{ baseline: number, source: string, sitemaps: number }>}
 */
export async function liveCardBaseline({ origin, fetch = globalThis.fetch }) {
  const base = origin.replace(/\/+$/, "");
  const top = await getText(fetch, `${base}/sitemap.xml`);
  if (!top.ok)
    throw new GuardError(`shrink guard: GET ${base}/sitemap.xml returned HTTP ${top.status}`);
  if (!isSitemapIndex(top.text)) {
    const cardUrls = parseLocs(top.text).filter((l) => CARD_PATH_RE.test(pathOf(l)));
    return {
      baseline: cardUrls.length,
      source: cardUrls.length ? "live urlset" : "live urlset without card URLs (first deploy)",
      sitemaps: 0,
    };
  }
  let baseline = 0;
  const children = parseLocs(top.text);
  for (const loc of children) {
    const url = base + pathOf(loc);
    const child = await getText(fetch, url);
    if (!child.ok) throw new GuardError(`shrink guard: GET ${url} returned HTTP ${child.status}`);
    baseline += parseLocs(child.text).filter((l) => CARD_PATH_RE.test(pathOf(l))).length;
  }
  return {
    baseline,
    source: `live sitemap index (${children.length} sitemaps)`,
    sitemaps: children.length,
  };
}

/**
 * Guard 2's decision. Returns the job-summary line; throws when the new
 * count is below `threshold` of the baseline and no override is set.
 * @param {{ baseline: number, count: number, allowShrink?: boolean,
 *           overrideName?: string, source?: string, threshold?: number }} o
 * @returns {{ ok: boolean, overridden: boolean, line: string }}
 */
export function checkShrink({
  baseline,
  count,
  allowShrink = false,
  overrideName = "allow shrink",
  source = "live sitemaps",
  threshold = SHRINK_THRESHOLD,
}) {
  if (baseline === 0) {
    return {
      ok: true,
      overridden: false,
      line: `shrink guard: ${count} card pages; baseline 0 from ${source} - passed (first deploy)`,
    };
  }
  const pct = ((count / baseline) * 100).toFixed(1);
  const head = `shrink guard: ${count} card pages vs baseline ${baseline} from ${source} (${pct}%)`;
  if (count >= threshold * baseline) {
    return {
      ok: true,
      overridden: false,
      line: `${head} - passed${allowShrink ? ` (${overrideName} set, not needed)` : ""}`,
    };
  }
  const below = `below ${Math.round(threshold * 100)}%`;
  if (allowShrink) {
    return {
      ok: true,
      overridden: true,
      line: `${head} - ${below}, ALLOWED by override (${overrideName})`,
    };
  }
  throw new GuardError(`${head} - ${below}; set ${overrideName} for a legitimate shrink`);
}
