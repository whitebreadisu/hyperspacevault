// Reads the public catalog for the card-page generator (design note §3
// "Data source"): GET <backend_url>/api/public/cards straight from the Cloud
// Run URL (the `backend_url` terraform output), which bypasses the Hosting
// CDN, so it always reads the revision that is serving right now.
//
// Cloud Run rollout is not instant, so the read is retried until the
// response's `build_sha` equals the SHA being deployed (every 10 s, up to
// 5 min by default). On timeout the deploy fails: a page set built from the
// previous revision's catalog is never shipped as the new one.
//
// Pure apart from the injected `fetch`, `sleep` and `now` (tests pass fakes).

export const DEFAULT_INTERVAL_MS = 10_000;
export const DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** One request gives up after this long (a hung socket counts as a failed
 * attempt). Longer than the 30 s of the other reads: the bulk route returns
 * the whole catalog (a few MB) from dev's single small instance. */
export const FETCH_TIMEOUT_MS = 60_000;

export class CatalogFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogFetchError";
  }
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function joinUrl(base, path) {
  return base.replace(/\/+$/, "") + path;
}

/** Throws unless `catalog` has the PublicCatalog top-level shape
 * (frontend/src/public/publicCatalog.ts). */
export function assertCatalogShape(catalog) {
  if (!catalog || typeof catalog !== "object")
    throw new CatalogFetchError("catalog is not an object");
  if (typeof catalog.build_sha !== "string")
    throw new CatalogFetchError("catalog.build_sha is not a string");
  if (!Array.isArray(catalog.sets)) throw new CatalogFetchError("catalog.sets is not an array");
  if (!Array.isArray(catalog.cards)) throw new CatalogFetchError("catalog.cards is not an array");
  if (!catalog.counts || typeof catalog.counts !== "object" || Array.isArray(catalog.counts)) {
    throw new CatalogFetchError("catalog.counts is not an object");
  }
  return catalog;
}

/**
 * Polls `<backendUrl>/api/public/cards` until `build_sha === expectSha`.
 *
 * @param {object} o
 * @param {string} o.backendUrl  Cloud Run URL (no trailing path)
 * @param {string} o.expectSha   the SHA being deployed
 * @param {typeof fetch} [o.fetch]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {() => number} [o.now]  ms clock
 * @param {number} [o.intervalMs]
 * @param {number} [o.timeoutMs]
 * @param {(line: string) => void} [o.log]
 * @returns {Promise<{catalog: object, attempts: number, waitedMs: number}>}
 */
export async function fetchCatalog({
  backendUrl,
  expectSha,
  fetch = globalThis.fetch,
  sleep = realSleep,
  now = Date.now,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = () => {},
}) {
  if (!backendUrl) throw new CatalogFetchError("fetchCatalog: backendUrl is required");
  if (!expectSha) throw new CatalogFetchError("fetchCatalog: expectSha is required");
  const url = joinUrl(backendUrl, "/api/public/cards");
  const started = now();
  let attempts = 0;
  let last = "no response";
  for (;;) {
    attempts += 1;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        last = `HTTP ${res.status}`;
      } else {
        const catalog = assertCatalogShape(await res.json());
        if (catalog.build_sha === expectSha) {
          return { catalog, attempts, waitedMs: now() - started };
        }
        last = `build_sha ${catalog.build_sha} (want ${expectSha})`;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    const elapsed = now() - started;
    if (elapsed + intervalMs > timeoutMs) {
      throw new CatalogFetchError(
        `GET ${url}: no response with build_sha ${expectSha} after ${attempts} attempts ` +
          `in ${Math.round(elapsed / 1000)} s; last: ${last}`
      );
    }
    log(`public catalog not ready (${last}); retrying in ${intervalMs / 1000} s`);
    await sleep(intervalMs);
  }
}

/** The existing list endpoint `GET /api/base-cards` (catalog-only rows, each
 * with `is_token`), read from the same Cloud Run URL for the completeness
 * guard. One attempt with a short retry: by now fetchCatalog has proven the
 * new revision serves. */
export async function fetchBaseCardList({
  backendUrl,
  fetch = globalThis.fetch,
  sleep = realSleep,
  retries = 2,
  intervalMs = 5_000,
}) {
  const url = joinUrl(backendUrl, "/api/base-cards");
  let last = "no response";
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const rows = await res.json();
        if (!Array.isArray(rows)) throw new CatalogFetchError(`GET ${url}: not an array`);
        return rows;
      }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (i < retries) await sleep(intervalMs);
  }
  throw new CatalogFetchError(`GET ${url} failed: ${last}`);
}
