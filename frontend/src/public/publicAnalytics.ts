import {
  ANALYTICS_HOSTNAMES,
  POSTHOG_STORE_KEY,
  POSTHOG_TOKEN,
  PUBLIC_ID_KEY,
  RELAY_PATH,
} from "../analytics/posthogConfig";

// The public pages' own analytics (design note §6 "Analytics from shared
// components", C7; App Spec §22). A hard allowlist of exactly two events,
// sent through the app's first-party relay WITHOUT posthog-js: one small POST
// per event to PostHog's capture endpoint. No autocapture, no pageview, no
// session replay, no person profile. Production hostnames only, as the app's
// initAnalytics(). The app's own capture() is never initialised on a public
// page, so the shared components' calls to it stay no-ops; this module is the
// only thing a public page sends, apart from the card page's inline head
// script, which sends `card_page_cta` `auto_open` under the same allowlisted
// shape, gates and identity (autoOpen.ts AUTO_OPEN_JS). Public decks add `deck_page_viewed` here
// later (§7).

export type ReferrerKind = "search" | "social" | "internal" | "other" | "none";
export type CtaAction =
  "create_account" | "sign_in" | "open_app" | "open_card_in_app" | "auto_open";

export interface PublicEvents {
  card_page_viewed: { set: string; number: string; referrer_kind: ReferrerKind };
  card_page_cta: { action: CtaAction };
}
export type PublicEventName = keyof PublicEvents;

const REFERRER_KINDS: readonly string[] = ["search", "social", "internal", "other", "none"];
const CTA_ACTIONS: readonly string[] = [
  "create_account",
  "sign_in",
  "open_app",
  "open_card_in_app",
  "auto_open",
];

/** Each allowed event and the check for its properties: exactly these
 * keys, enum or short code values only (never free text). */
const ALLOWLIST: Record<string, (p: Record<string, unknown>) => boolean> = {
  card_page_viewed: (p) =>
    sameKeys(p, ["set", "number", "referrer_kind"]) &&
    typeof p.set === "string" &&
    /^[A-Z0-9]{2,8}$/.test(p.set) &&
    typeof p.number === "string" &&
    /^\d{1,4}$/.test(p.number) &&
    REFERRER_KINDS.includes(p.referrer_kind as string),
  card_page_cta: (p) => sameKeys(p, ["action"]) && CTA_ACTIONS.includes(p.action as string),
};

function sameKeys(p: Record<string, unknown>, keys: string[]): boolean {
  const have = Object.keys(p).sort();
  const want = [...keys].sort();
  return have.length === want.length && have.every((k, i) => k === want[i]);
}

/** True only for an allowlisted name with exactly its allowed properties. */
export function isAllowedPublicEvent(name: string, props: unknown): boolean {
  const check = Object.prototype.hasOwnProperty.call(ALLOWLIST, name) ? ALLOWLIST[name] : null;
  if (!check || props == null || typeof props !== "object" || Array.isArray(props)) return false;
  return check(props as Record<string, unknown>);
}

/** Where a visitor came from, as an enum (never the referring URL). */
export function referrerKind(referrer: string, ownHost: string): ReferrerKind {
  if (!referrer) return "none";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  const bare = (h: string) => h.replace(/^www\./, "");
  if (bare(host) === bare(ownHost.toLowerCase())) return "internal";
  if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|yandex|baidu|startpage|brave)\./.test(host))
    return "search";
  if (
    /(^|\.)(reddit\.com|discord\.com|discordapp\.com|x\.com|twitter\.com|t\.co|facebook\.com|instagram\.com|bsky\.app|youtube\.com|tiktok\.com)$/.test(
      host
    )
  )
    return "social";
  return "other";
}

// Identity: a browser that already used the app sends under posthog-js's
// stored id (read only). Otherwise the page keeps its own anonymous id under
// a page-only key; the app's posthog init starts from it on that browser's
// first app visit (posthogConfig.ts publicBootstrap), which joins "card page
// viewed, then sign-up" (design note §1). The page never writes posthog-js's
// storage.
// posthog-js's opt-out record (Settings > Usage analytics).
const PH_OPT = `__ph_opt_in_out_${POSTHOG_TOKEN}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function optedOut(store: Storage | null): boolean {
  try {
    const v = store?.getItem(PH_OPT);
    return v === "0" || v === "false";
  } catch {
    return false;
  }
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function distinctId(store: Storage | null): string {
  try {
    const raw = store?.getItem(POSTHOG_STORE_KEY);
    if (raw) {
      const id = (JSON.parse(raw) as { distinct_id?: unknown }).distinct_id;
      if (typeof id === "string" && id) return id;
    }
    const own = store?.getItem(PUBLIC_ID_KEY);
    if (own) return own;
    const id = newId();
    store?.setItem(PUBLIC_ID_KEY, id);
    return id;
  } catch {
    return newId();
  }
}

/** Whether this page may send at all: a production build on a production
 * hostname (the app's initAnalytics() gate). */
export function publicAnalyticsEnabled(
  hostname: string = typeof window === "undefined" ? "" : window.location.hostname,
  prod: boolean = import.meta.env.PROD
): boolean {
  return prod && ANALYTICS_HOSTNAMES.includes(hostname);
}

export type Transport = (url: string, body: string) => void;

const defaultTransport: Transport = (url, body) => {
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    try {
      navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }));
    } catch {
      /* analytics never breaks the page */
    }
  }
};

/** Sends one allowlisted event; returns whether it was sent. Anything outside
 * the allowlist is dropped (and returns false) whatever the environment. */
export function publicCapture<N extends PublicEventName>(
  name: N,
  props: PublicEvents[N],
  opts: { enabled?: boolean; transport?: Transport } = {}
): boolean {
  if (!isAllowedPublicEvent(name, props)) return false;
  const enabled = opts.enabled ?? publicAnalyticsEnabled();
  if (!enabled) return false;
  const store = storage();
  if (optedOut(store)) return false;
  const body = JSON.stringify({
    api_key: POSTHOG_TOKEN,
    event: name,
    distinct_id: distinctId(store),
    timestamp: new Date().toISOString(),
    properties: {
      ...props,
      $lib: "hsv-public-pages",
      // Anonymous-events rider: no person profile for this traffic.
      $process_person_profile: false,
    },
  });
  (opts.transport ?? defaultTransport)(`${window.location.origin}${RELAY_PATH}/i/v0/e/`, body);
  return true;
}

/** The CTA click helper the page frame's links and buttons call. */
export function ctaClicked(action: CtaAction): void {
  publicCapture("card_page_cta", { action });
}
