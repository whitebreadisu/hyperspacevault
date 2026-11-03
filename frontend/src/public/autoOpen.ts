import { cardAppHref } from "../utils/cardParam";
import { APP_SEEN_KEY, hasSeenApp } from "../utils/appSeen";
import {
  ANALYTICS_HOSTNAMES,
  POSTHOG_STORE_KEY,
  POSTHOG_TOKEN,
  PUBLIC_ID_KEY,
  RELAY_PATH,
} from "../analytics/posthogConfig";

// The returning-visitor redirect (design note §4 D4, App Spec §22): a browser
// that has opened the app before goes straight from a card page to the same
// card in the app. The server-rendered page is unchanged, so a crawler and a
// first-time visitor see the page; the decision runs only in the browser: the
// inline head script below (before anything paints), with the page script's
// check before hydration as the fallback. A `page` query parameter (any
// value, or bare) keeps the visitor on the page.

/** Where to send this visit, or null to stay on the page. */
export function autoOpenTarget(
  search: string,
  seen: boolean,
  card: { set_code: string; base_card_number: string }
): string | null {
  if (!seen) return null;
  if (new URLSearchParams(search).has("page")) return null;
  return cardAppHref(card.set_code, card.base_card_number);
}

/** The page entry's check: reads the marker (a throwing storage reads as
 * unseen) and the address bar. */
export function autoOpenFromLocation(
  card: { set_code: string; base_card_number: string },
  storage?: Storage | null
): string | null {
  return autoOpenTarget(window.location.search, hasSeenApp(storage), card);
}

/** The head script's progress, on `window.__hsvAutoOpen`: "pending" while
 * its navigation is under way, "stalled" once it gave up (location.replace
 * threw, or no navigation within AUTO_OPEN_STALL_MS); absent when the head
 * script did not act. */
export type HeadState = "pending" | "stalled";
export const AUTO_OPEN_FLAG = "__hsvAutoOpen";
/** Fired on window when the head script gives up, so a waiting page script
 * hydrates late. */
export const AUTO_OPEN_STALLED_EVENT = "hsv:auto-open-stalled";
/** How long a redirect may take before the page is shown again. */
export const AUTO_OPEN_STALL_MS = 4000;

export type BootStep = "wait" | "redirect" | "hydrate";

/** The page script's boot decision (card.tsx). `headState` is the head
 * script's flag; `fallbackTarget` is autoOpenFromLocation's answer.
 *   - pending: the head script is navigating and already sent the event:
 *     wait for its stalled signal, never send or redirect again;
 *   - stalled: the head script tried and gave up: show the page;
 *   - absent: the head script did not act; the fallback decides. */
export function bootStep(headState: unknown, fallbackTarget: string | null): BootStep {
  if (headState === "pending") return "wait";
  if (headState === "stalled") return "hydrate";
  return fallbackTarget ? "redirect" : "hydrate";
}

/** What the inline head script needs, baked into each card page at
 * generation time (head.ts serialises it with scriptJson). */
export interface AutoOpenConfig {
  href: string;
  key: string;
  hosts: readonly string[];
  token: string;
  phKey: string;
  idKey: string;
  optKey: string;
  relay: string;
  flag: string;
  stalled: string;
  stallMs: number;
}

export function autoOpenConfig(
  card: { set_code: string; base_card_number: string },
  hosts: readonly string[] = ANALYTICS_HOSTNAMES,
  stallMs: number = AUTO_OPEN_STALL_MS
): AutoOpenConfig {
  return {
    href: cardAppHref(card.set_code, card.base_card_number),
    key: APP_SEEN_KEY,
    hosts,
    token: POSTHOG_TOKEN,
    phKey: POSTHOG_STORE_KEY,
    idKey: PUBLIC_ID_KEY,
    optKey: `__ph_opt_in_out_${POSTHOG_TOKEN}`,
    relay: `${RELAY_PATH}/i/v0/e/`,
    flag: AUTO_OPEN_FLAG,
    stalled: AUTO_OPEN_STALLED_EVENT,
    stallMs,
  };
}

/** The first thing in a card page's <head>, so a returning browser leaves
 * before the page paints: the same decision as autoOpenTarget (marker set, no
 * `page` parameter; storage that throws = stay), then the `auto_open` event
 * by sendBeacon under publicCapture's gates and identity (production
 * hostname, opt-out honoured, posthog-js's id else the page-only id), then
 * location.replace. It sets the flag to "pending" so the page script neither
 * hydrates nor sends again while the navigation is under way (bootStep).
 * When replace throws, or nothing has navigated after stallMs, it shows the
 * page again, sets "stalled" and fires the stalled event, and the page
 * script hydrates. A function expression taking the config object; head.ts
 * appends the call. */
export const AUTO_OPEN_JS = `(function (C) {
  var s;
  try {
    s = window.localStorage;
    if (s.getItem(C.key) !== "1" || new URLSearchParams(location.search).has("page")) return;
  } catch (e) {
    return;
  }
  var root = document.documentElement;
  var stall = function () {
    window[C.flag] = "stalled";
    root.style.visibility = "";
    window.dispatchEvent(new Event(C.stalled));
  };
  window[C.flag] = "pending";
  root.style.visibility = "hidden";
  try {
    var o = s.getItem(C.optKey);
    if (C.hosts.indexOf(location.hostname) >= 0 && o !== "0" && o !== "false" && navigator.sendBeacon) {
      var id = null;
      try {
        id = JSON.parse(s.getItem(C.phKey) || "null").distinct_id;
      } catch (e) {}
      if (typeof id !== "string" || !id) id = s.getItem(C.idKey);
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16) + "-" + Math.random().toString(16).slice(2);
        s.setItem(C.idKey, id);
      }
      var body = JSON.stringify({
        api_key: C.token,
        event: "card_page_cta",
        distinct_id: id,
        timestamp: new Date().toISOString(),
        properties: { action: "auto_open", $lib: "hsv-public-pages", $process_person_profile: false }
      });
      navigator.sendBeacon(location.origin + C.relay, new Blob([body], { type: "application/json" }));
    }
  } catch (e) {}
  try {
    location.replace(C.href);
  } catch (e) {
    stall();
    return;
  }
  setTimeout(stall, C.stallMs);
})`;
