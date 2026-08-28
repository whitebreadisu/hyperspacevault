// BL-235: PostHog product analytics -- the single seam between the app and
// posthog-js. Components import { capture } from here and never touch the
// SDK directly, so the taxonomy stays enforceable (event names are a closed
// union) and the whole subsystem no-ops wherever analytics isn't running.
//
// The full taxonomy contract (questions each event answers, property rules,
// riders) lives in the App Spec's analytics section; event names/properties
// here must stay in lockstep with it.
import posthog from "posthog-js";

// The v1 event registry. Adding an event = extend this union AND the App
// Spec section in the same PR. Names are permanent (renames orphan history);
// deprecate and add instead.
export type AnalyticsEvent =
  // navigation & lifecycle
  | "screen_viewed"
  | "signup_completed"
  | "login_completed"
  | "feedback_submitted"
  // vault browsing
  | "view_mode_changed"
  | "filter_applied"
  | "filters_cleared"
  | "finish_scope_changed"
  | "search_performed"
  | "sort_changed"
  // card detail & prices
  | "card_popup_opened"
  | "price_history_opened"
  | "popup_card_navigated"
  // inventory editing
  | "quantity_changed"
  | "add_cards_committed"
  | "add_cards_abandoned"
  // heavier features
  | "import_dry_run"
  | "import_committed"
  | "export_performed"
  | "deck_check_run"
  | "share_created"
  | "share_link_viewed";

// Property values are enums/counts only -- no raw user-typed text, no PII
// (taxonomy property standard). The type can't prove "no free text", but it
// keeps accidental objects/arrays out.
export type AnalyticsProperties = Record<string, string | number | boolean>;

// Publishable project token (PostHog US Cloud) -- phc_ keys are designed to
// ship in frontend bundles; capability-bearing personal keys are phx_ and
// never belong here.
const POSTHOG_TOKEN = "phc_ydajqUnNvaUnixWs95mAoVwtw8G2DMXr7Sz4iUvSwGxW";

// Init is gated to the real production hostnames, not just PROD builds:
// localhost dev, CI, previews, and any future dev-channel host stay out of
// the dataset entirely (no env plumbing to forget).
const ANALYTICS_HOSTNAMES = ["hyperspacevault.com", "www.hyperspacevault.com"];

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  if (!import.meta.env.PROD) return;
  if (!ANALYTICS_HOSTNAMES.includes(window.location.hostname)) return;

  posthog.init(POSTHOG_TOKEN, {
    // First-party path: same-origin through the Hosting /api/** rewrite to
    // the backend relay (app/routers/relay.py). Adblock-resilience rider.
    api_host: `${window.location.origin}/api/relay`,
    // Dashboard links (toolbar etc.) still point at PostHog itself.
    ui_host: "https://us.posthog.com",
    // Anonymous-events rider: never call identify(); with identified_only,
    // no person profiles are created for anonymous traffic.
    person_profiles: "identified_only",
    // localStorage only -- no analytics cookies.
    persistence: "localStorage",
    autocapture: true,
    // SPA with pane switching, not URL routing -- screen_viewed (App.tsx)
    // is the navigation signal; $pageview would only ever fire once.
    capture_pageview: false,
    capture_pageleave: true,
    session_recording: {
      // Masking rider: every input masked in replay, not just passwords.
      maskAllInputs: true,
    },
  });
  posthog.register({ app_version: __APP_VERSION__ });
  initialized = true;
}

/** True when analytics is live in this session (prod hostname + init ran). */
export function analyticsActive(): boolean {
  return initialized;
}

export function capture(event: AnalyticsEvent, properties?: AnalyticsProperties): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

// Opt-out rider (Settings > Usage analytics). posthog-js persists the choice
// itself (localStorage), so it survives reloads and needs no backend state;
// it is per-browser by design -- analytics identity is per-browser too.
export function hasOptedOut(): boolean {
  return initialized && posthog.has_opted_out_capturing();
}

export function setOptedOut(optedOut: boolean): void {
  if (!initialized) return;
  if (optedOut) {
    posthog.opt_out_capturing();
  } else {
    posthog.opt_in_capturing();
  }
}
