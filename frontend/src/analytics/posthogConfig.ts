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
