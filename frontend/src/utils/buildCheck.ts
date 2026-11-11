// App Spec §20: getting open tabs current. Pure pieces of the
// "new version ready" check and the chunk-failure recovery; the effects that
// call them live in components/UpdateBanner.tsx.
//
// Each deploy build publishes /build.json ({ build, version }, served
// no-cache) and bakes the same build id into the bundle (__BUILD_ID__,
// vite.config.ts). A tab whose baked id differs from the published one is
// running an older build.

/** The build id this bundle was built from: the commit SHA on a deploy
 * build, "local" anywhere else (vite.config.ts). */
export const BAKED_BUILD_ID: string = __BUILD_ID__;

/** The published identity file. */
export const BUILD_FILE_URL = "/build.json";

/** A focus / visible event checks at most this often. */
export const FOCUS_THROTTLE_MS = 5 * 60 * 1000;

/** While the tab is visible it also checks on this timer. */
export const INTERVAL_MS = 30 * 60 * 1000;

export interface BuildInfo {
  build: string;
  version: string;
}

/** The build file's body, or null when it is not one (an HTML fallback from
 * a dev server, a truncated response, a missing field). */
export function parseBuildFile(body: unknown): BuildInfo | null {
  if (!body || typeof body !== "object") return null;
  const { build, version } = body as Record<string, unknown>;
  if (typeof build !== "string" || build.trim() === "") return null;
  if (typeof version !== "string") return null;
  return { build, version };
}

/** True when the published build is not the one this tab runs. */
export function isDifferentBuild(baked: string, published: BuildInfo | null): boolean {
  return published != null && published.build !== baked;
}

export type CheckReason = "focus" | "interval";

/** Whether a check may run now. A focus / visible event is throttled to one
 * check per FOCUS_THROTTLE_MS since the last check of any kind; the interval
 * timer always may (it fires once per INTERVAL_MS). `last` is null before
 * the first check, so the first focus after load checks at once. */
export function shouldCheck(reason: CheckReason, now: number, last: number | null): boolean {
  if (reason === "interval" || last == null) return true;
  return now - last >= FOCUS_THROTTLE_MS;
}

/** Fetches the build file past every cache. Any failure (network, status,
 * non-JSON body) is null: the check is silent when it cannot answer. */
export async function fetchBuildInfo(
  fetcher: typeof fetch = fetch,
  url: string = BUILD_FILE_URL
): Promise<BuildInfo | null> {
  try {
    const res = await fetcher(url, { cache: "no-store" });
    if (!res.ok) return null;
    return parseBuildFile(await res.json());
  } catch {
    return null;
  }
}

// ── (b) chunk-failure recovery ─────────────────────────────────────────────

/** The sessionStorage key of the one guarded reload for a build. Keyed by the
 * baked build id so the guard is per build: a reload that lands on the same
 * (still broken) build finds it set and does not reload again. */
export function chunkReloadKey(buildId: string): string {
  return `hsv:chunk-reload:${buildId}`;
}

export interface GuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What a chunk failure does: "reload" the first time for this build (the
 * guard is set before the caller reloads), "banner" once the guard has fired.
 * Storage that cannot be read or written counts as fired, so a tab without
 * sessionStorage can never loop. */
export function chunkFailureAction(
  storage: GuardStorage | null,
  buildId: string
): "reload" | "banner" {
  if (!storage) return "banner";
  const key = chunkReloadKey(buildId);
  try {
    if (storage.getItem(key) != null) return "banner";
    storage.setItem(key, "1");
    return storage.getItem(key) != null ? "reload" : "banner";
  } catch {
    return "banner";
  }
}

/** Browser messages for a dynamic import whose module could not be fetched
 * (Chromium, WebKit, Firefox). */
const CHUNK_FAILURE_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

/** True when a rejection reason is a failed dynamic import. */
export function isChunkLoadError(reason: unknown): boolean {
  const message =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return CHUNK_FAILURE_RE.test(message);
}
