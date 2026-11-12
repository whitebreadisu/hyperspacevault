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
import {
  ANALYTICS_HOSTNAMES,
  POSTHOG_STORE_KEY,
  POSTHOG_TOKEN,
  RELAY_PATH,
  publicBootstrap,
} from "./posthogConfig";
import {
  knownShareTokens,
  redactShareEvent,
  redactShareText,
  scrubStoredShareTokens,
} from "./redactShare";
import { loadShareSession } from "../utils/shareSession";

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
  | "card_link_copied"
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
  | "pad_keypad_toggled"
  // the "new version ready" banner (App Spec §20), desktop and phone
  | "app_update_banner"
  // the feature tour's tips (App Spec §20), desktop and phone
  | "feature_tour";

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
  // The Vault's Stashes page, both layouts.
  "stashes",
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

/** app_update_banner.action: the banner first rendered for a build on this
 * page load, or one of its two buttons was clicked. */
export const UPDATE_BANNER_ACTIONS = ["shown", "refresh", "dismiss"] as const;
export type UpdateBannerAction = (typeof UPDATE_BANNER_ACTIONS)[number];

/** app_update_banner.source: a build-file check found a newer build, or a
 * chunk failure hit the guard that had already reloaded once. */
export const UPDATE_BANNER_SOURCES = ["check", "chunk"] as const;
export type UpdateBannerSource = (typeof UPDATE_BANNER_SOURCES)[number];

/** feature_tour.action: a tip first showed on this visit, its Next / Done /
 * Skip tour was pressed, its target was used, or it was closed by an
 * empty-page click or Escape without being marked seen. */
export const FEATURE_TOUR_ACTIONS = [
  "shown",
  "next",
  "done",
  "skip",
  "target_used",
  "dismissed",
] as const;
export type FeatureTourAction = (typeof FEATURE_TOUR_ACTIONS)[number];

/** feature_tour.page: the tour page the tip belongs to. */
export const FEATURE_TOUR_PAGES = ["collection", "card", "stashes"] as const;

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

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The share tokens this tab knows right now (the page's, the session's).
 * Never throws: on any failure the list is empty and redaction falls back
 * to the share-path patterns alone. */
function shareTokens(): string[] {
  try {
    return knownShareTokens(window.location.pathname, loadShareSession()?.token ?? null);
  } catch {
    return [];
  }
}

/** redactShareEvent, never throwing: if redaction with the known tokens
 * fails, it is retried with the path patterns only; if that fails too the
 * event is dropped, never sent unredacted. */
function safeRedact<E extends { event: string }>(cr: E | null): E | null {
  try {
    return redactShareEvent(cr, shareTokens());
  } catch {
    try {
      return redactShareEvent(cr);
    } catch {
      return null;
    }
  }
}

export function initAnalytics(): void {
  if (initialized) return;
  if (!import.meta.env.PROD) return;
  if (!ANALYTICS_HOSTNAMES.includes(window.location.hostname)) return;

  // A first visit that arrived through a public card page starts from that
  // page's anonymous id; every other init is exactly as before.
  const bootstrap = publicBootstrap(localStore());
  // posthog-js keeps the first page's raw URL ($initial_person_info) for good;
  // a share page may have been that page. Clean what it stored before it
  // loads it.
  try {
    scrubStoredShareTokens(POSTHOG_STORE_KEY, [localStore(), sessionStore()], shareTokens());
  } catch {
    /* never stops init; events are still redacted by before_send */
  }
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
    // A share link's token never leaves the browser: every URL-bearing
    // property is redacted to `/shared/:token` (redactShare.ts).
    before_send: (cr) => safeRedact(cr),
    // No heatmaps: nothing in the app uses them, and posthog-js keys their
    // data by the page URL (redacted by key too, belt and braces).
    capture_heatmaps: false,
    // No /flags request at all: the app uses no feature flags, and that
    // request carries the persisted $initial_* person properties outside
    // before_send. (advanced_disable_flags would also stop the remote
    // config load, which session replay needs to start.)
    advanced_disable_feature_flags: true,
    ...(bootstrap ? { bootstrap } : {}),
  });
  // On a share page, record the first-page info posthog-js would record on
  // its first capture -- with the token redacted. Its own write is
  // write-once, so this one stands.
  try {
    const tokens = shareTokens();
    if (tokens.length && window.location.pathname.startsWith("/shared/")) {
      posthog.register_once({
        $initial_person_info: {
          r: redactShareText(document.referrer || "$direct", tokens).substring(0, 1000),
          u: redactShareText(window.location.href, tokens).substring(0, 1000),
        },
      });
    }
  } catch {
    /* never stops init; before_send still redacts the $initial_* values */
  }
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
