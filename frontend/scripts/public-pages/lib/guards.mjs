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

/** The shrink guard's floor, in whole percent (integer arithmetic, no float
 * edge at exactly 95%). */
export const SHRINK_PERCENT = 95;

/** A card page path: /cards/<set>/<num>/ (not /cards/ or /cards/<set>/). */
export const CARD_PATH_RE = /^\/cards\/[^/]+\/[^/]+\/$/;

const nonToken = (rows) => rows.filter((r) => !r.is_token);

/**
 * Guard 1. `pagesRendered` (optional) is the number of card pages the
 * generator wrote; when given it must equal the other three.
 * @returns {{ ok: true, count: number, line: string }}
 * @throws {GuardError}
 */
export function checkCompleteness({
  catalog,
  baseCardList,
  pagesRendered,
  listLabel = "GET /api/base-cards",
}) {
  const cards = nonToken(catalog.cards);
  const sumCounts = Object.values(catalog.counts).reduce((a, b) => a + Number(b), 0);
  const listCount = nonToken(baseCardList).length;
  const problems = [];
  if (cards.length !== sumCounts) {
    problems.push(`catalog has ${cards.length} non-token cards but sum(counts) is ${sumCounts}`);
  }
  if (listCount !== sumCounts) {
    problems.push(`${listLabel} has ${listCount} non-token rows but sum(counts) is ${sumCounts}`);
  }
  // Per set as well: equal totals could hide one set short and another long.
  const perSet = {};
  for (const c of cards) perSet[c.set_code] = (perSet[c.set_code] ?? 0) + 1;
  for (const code of new Set([...Object.keys(perSet), ...Object.keys(catalog.counts)])) {
    const have = perSet[code] ?? 0;
    const want = Number(catalog.counts[code] ?? 0);
    if (have !== want) problems.push(`set ${code}: ${have} non-token cards, counts says ${want}`);
  }
  // An empty catalog is never complete: no shrink baseline or override can
  // make a deploy of zero card pages acceptable.
  if (cards.length === 0 || sumCounts <= 0) {
    problems.push(
      `catalog has ${cards.length} non-token cards (sum(counts) ${sumCounts}); zero card pages is never a deploy`
    );
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
    line:
      `completeness: ${sumCounts} non-token cards = sum(counts) = ${listLabel} non-token rows` +
      (pagesRendered != null ? ` = card pages rendered` : ""),
  };
}

function pathOf(loc) {
  try {
    return new URL(loc).pathname;
  } catch {
    return loc;
  }
}

/** Every network read gives up after this long. */
export const FETCH_TIMEOUT_MS = 30_000;

async function getText(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { accept: "application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, ok: res.ok, text: res.ok ? await res.text() : "" };
}

/**
 * Counts the card URLs the target environment's live sitemaps list.
 * The live /sitemap.xml must be one of:
 *   - the pre-card-pages plain `urlset` (complete, at most one <loc>, no
 *     card URL): the first deploy, baseline 0;
 *   - a complete `urlset` that does list card URLs: those are counted;
 *   - the sitemap index this generator writes (complete, at least one
 *     child): every child (its path, on `origin`) must be a complete urlset,
 *     and its card URLs are counted.
 * Anything else fails closed: a network error, a non-200, an HTML or empty
 * body, a truncated document, an index with no children, a urlset with two
 * or more non-card URLs. Without a trustworthy baseline the guard cannot
 * tell a shrink from a first deploy. The override still applies (checkShrink).
 *
 * @returns {Promise<{ baseline: number, source: string, sitemaps: number }>}
 */
export async function liveCardBaseline({ origin, fetch = globalThis.fetch }) {
  const base = origin.replace(/\/+$/, "");
  const topUrl = `${base}/sitemap.xml`;
  const top = await getText(fetch, topUrl);
  if (!top.ok) throw new GuardError(`shrink guard: GET ${topUrl} returned HTTP ${top.status}`);
  if (isSitemapIndex(top.text)) {
    if (!/<\/sitemapindex>/.test(top.text)) {
      throw new GuardError(`shrink guard: ${topUrl} is a truncated sitemap index`);
    }
    const children = parseLocs(top.text);
    if (children.length === 0) {
      throw new GuardError(`shrink guard: ${topUrl} is a sitemap index with no sitemaps`);
    }
    let baseline = 0;
    for (const loc of children) {
      const url = base + pathOf(loc);
      const child = await getText(fetch, url);
      if (!child.ok) throw new GuardError(`shrink guard: GET ${url} returned HTTP ${child.status}`);
      if (!isCompleteUrlset(child.text)) {
        throw new GuardError(`shrink guard: ${url} is not a complete urlset`);
      }
      baseline += parseLocs(child.text).filter((l) => CARD_PATH_RE.test(pathOf(l))).length;
    }
    return {
      baseline,
      source: `live sitemap index (${children.length} sitemaps)`,
      sitemaps: children.length,
    };
  }
  if (!isCompleteUrlset(top.text)) {
    throw new GuardError(
      `shrink guard: ${topUrl} is neither a sitemap index nor a complete urlset`
    );
  }
  const locs = parseLocs(top.text);
  const cardUrls = locs.filter((l) => CARD_PATH_RE.test(pathOf(l)));
  if (cardUrls.length > 0) return { baseline: cardUrls.length, source: "live urlset", sitemaps: 0 };
  if (locs.length <= 1) {
    return {
      baseline: 0,
      source: "live one-URL urlset without card URLs (first deploy)",
      sitemaps: 0,
    };
  }
  throw new GuardError(
    `shrink guard: ${topUrl} is a urlset of ${locs.length} URLs and no card URLs; not the pre-card-pages sitemap`
  );
}

function isCompleteUrlset(xml) {
  return /<urlset[\s>]/.test(xml) && /<\/urlset>/.test(xml);
}

/**
 * Guard 2's decision. Returns the job-summary line; throws when the new
 * count is below `percent`% of the baseline and no override is set.
 * @param {{ baseline: number, count: number, allowShrink?: boolean,
 *           overrideName?: string, source?: string, percent?: number }} o
 * @returns {{ ok: boolean, overridden: boolean, line: string }}
 */
export function checkShrink({
  baseline,
  count,
  allowShrink = false,
  overrideName = "allow shrink",
  source = "live sitemaps",
  percent = SHRINK_PERCENT,
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
  if (count * 100 >= percent * baseline) {
    return {
      ok: true,
      overridden: false,
      line: `${head} - passed${allowShrink ? ` (${overrideName} set, not needed)` : ""}`,
    };
  }
  const below = `below ${percent}%`;
  if (allowShrink) {
    return {
      ok: true,
      overridden: true,
      line: `${head} - ${below}, ALLOWED by override (${overrideName})`,
    };
  }
  throw new GuardError(`${head} - ${below}; set ${overrideName} for a legitimate shrink`);
}
