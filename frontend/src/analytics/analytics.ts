// PostHog product analytics (ADR-0027) -- the single seam between the app and
// posthog-js. Components import { capture } from here and never touch the
// SDK directly, so the taxonomy stays enforceable (event names are a closed
// union) and the whole subsystem no-ops wherever analytics isn't running.
//
// The full taxonomy contract (questions each event answers, property rules,
// riders) lives in App Spec §22; event names/properties here must stay in
// lockstep with it.
import posthog from "posthog-js";
import { isPhoneLayout, watchPhoneLayout } from "../mobile/useIsPhone";
import { ANALYTICS_HOSTNAMES, POSTHOG_TOKEN, RELAY_PATH } from "./posthogConfig";

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
  | "share_link_viewed"
  // the phone camera (enums + booleans only; never OCR text, keys, card
  // names or images)
  | "scan_recognised"
  | "scan_decision"
  | "scan_pick_shown"
  | "scan_fallback_keypad"
  // the phone keypad's fold tab (user-chosen deck size)
  | "pad_keypad_toggled";

// Property values are enums/counts only -- no raw user-typed text, no PII
// (taxonomy property standard). The type can't prove "no free text", but it
// keeps accidental objects/arrays out.
export type AnalyticsProperties = Record<string, string | number | boolean>;

// The project token, the production-hostname gate and the relay path live in
// posthogConfig.ts, shared with the public card pages' small sender
// (src/public/publicAnalytics.ts), which does not load posthog-js.

let initialized = false;

/** The values screen_viewed.screen takes (App Spec §22). Additive only: a
 * value is never renamed. Desktop sends vault, deck_check, new_arrivals,
 * shared_view, settings and import_export; App Spec §22 lists which values
 * the phone sends. */
export const SCREEN_VIEWED_SCREENS = [
  "vault",
  "card",
  "tool",
  // The camera mode of the tool (the isolated /scan/ document).
  "camera",
  "more",
  "feedback",
  "about",
  "updates",
  "settings",
  "password",
  "delete",
  "sharing",
  "import_export",
  "shared_view",
  "deck_check",
  "new_arrivals",
] as const;
export type ScreenViewedScreen = (typeof SCREEN_VIEWED_SCREENS)[number];

/** The values view_mode_changed.mode takes. Additive only -- desktop sends
 * "table" / "gallery" (InventorySummary's view toggle); the rest are the
 * phone Vault's view + size pairs. */
export const VIEW_MODE_CHANGED_MODES = [
  "table",
  "gallery",
  "rows_none",
  "rows_sm",
  "rows_md",
  "rows_lg",
  "gallery_1",
  "gallery_2",
  "gallery_3",
] as const;
export type ViewModeChangedMode = (typeof VIEW_MODE_CHANGED_MODES)[number];

/** `layout` is the phone gate itself -- the one function `isPhoneLayout()`
 * (mobile/useIsPhone.ts; App Spec §25.0, ADR-0030), which is not a single
 * media query (narrow viewport, OR a touch-primary device whose screen's
 * short side is at most 500 px), so it cannot be mirrored as a literal here.
 * A phone held on its side reports `phone`. */
function currentLayout(): "phone" | "desktop" {
  return isPhoneLayout() ? "phone" : "desktop";
}

/** Registers the `layout` super-property (rides every event) and keeps it
 * current when the gate flips. */
function registerLayout(): void {
  posthog.register({ layout: currentLayout() });
  watchPhoneLayout((phone) => posthog.register({ layout: phone ? "phone" : "desktop" }));
}

export function initAnalytics(): void {
  if (initialized) return;
  if (!import.meta.env.PROD) return;
  if (!ANALYTICS_HOSTNAMES.includes(window.location.hostname)) return;

  posthog.init(POSTHOG_TOKEN, {
    // First-party path: same-origin through the Hosting /api/** rewrite to
    // the backend relay (app/routers/relay.py). Adblock-resilience rider.
    api_host: `${window.location.origin}${RELAY_PATH}`,
    // Dashboard links (toolbar etc.) still point at PostHog itself.
    ui_host: "https://us.posthog.com",
    // Anonymous-events rider: never call identify(); with identified_only,
    // no person profiles are created for anonymous traffic.
    person_profiles: "identified_only",
    // localStorage only -- no analytics cookies.
    persistence: "localStorage",
    autocapture: true,
    // SPA with pane switching, not URL routing -- screen_viewed (App.tsx,
    // and the phone router in MobileApp) is the navigation signal; $pageview
    // would only ever fire once.
    capture_pageview: false,
    capture_pageleave: true,
    session_recording: {
      // Masking rider: every input masked in replay, not just passwords.
      maskAllInputs: true,
    },
  });
  posthog.register({ app_version: __APP_VERSION__ });
  registerLayout();
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
