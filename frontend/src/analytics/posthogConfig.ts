// PostHog settings shared by the app's analytics seam (analytics.ts, through
// posthog-js) and the public card pages' sender (src/public/publicAnalytics.ts,
// a plain fetch). No SDK import here, so the public page bundle stays free of
// posthog-js.

// Publishable project token (PostHog US Cloud) -- phc_ keys are designed to
// ship in frontend bundles; capability-bearing personal keys are phx_ and
// never belong here.
export const POSTHOG_TOKEN = "phc_ydajqUnNvaUnixWs95mAoVwtw8G2DMXr7Sz4iUvSwGxW";

// Init is gated to the real production hostnames, not just PROD builds:
// localhost dev, CI, previews, and any future dev-channel host stay out of
// the dataset entirely (no env plumbing to forget).
export const ANALYTICS_HOSTNAMES = ["hyperspacevault.com", "www.hyperspacevault.com"];

// First-party path: same-origin through the Hosting /api/** rewrite to the
// backend relay (backend/app/routers/relay.py), which forwards to PostHog's
// ingestion host. Adblock-resilience rider (ADR-0027).
export const RELAY_PATH = "/api/relay";

// posthog-js keeps its browser identity under this localStorage key. Read
// only -- nothing outside posthog-js writes it.
export const POSTHOG_STORE_KEY = `ph_${POSTHOG_TOKEN}_posthog`;

// The public pages' own anonymous id (src/public/publicAnalytics.ts), under a
// page-only key. When a visitor who arrived on a public page opens the app
// for the first time, the app's posthog-js starts from that id (its
// supported `bootstrap.distinctID` option), so "card page viewed, then
// sign-up" joins in one browser (App Spec §22).
export const PUBLIC_ID_KEY = "hsv_public_id";

/** The bootstrap the app's posthog init passes: the public pages' id, but
 * only when that id exists AND posthog-js has no stored identity yet; null
 * otherwise (then the init options are exactly the usual ones). */
export function publicBootstrap(
  store: Pick<Storage, "getItem"> | null
): { distinctID: string } | null {
  try {
    const id = store?.getItem(PUBLIC_ID_KEY);
    if (!id) return null;
    const ph = store?.getItem(POSTHOG_STORE_KEY);
    if (ph) {
      const stored = (JSON.parse(ph) as { distinct_id?: unknown }).distinct_id;
      if (typeof stored === "string" && stored) return null;
    }
    return { distinctID: id };
  } catch {
    return null;
  }
}
