// A share link's token is its only credential (App Spec §19.1). posthog-js
// puts the page URL into every event ($current_url, $pathname, $referrer,
// the $initial_* person properties, autocapture's element hrefs, pageleave)
// and into session-replay meta events, so on a `/shared/{token}` or
// `/shared/stash/{token}` page each of those carries the token. The SDK's
// before_send hook (analytics.ts) runs every event, replay snapshots
// included, through redactShareEvent, which replaces the token with
// `:token` in every readable string it holds: a share path, plain or
// percent-encoded, and any other place the same token repeats (a query or
// a hash). Replay DOM data that posthog-js has already compressed (full
// snapshots and mutations, with the default compress_events) is an opaque
// string and is NOT read; it holds no token today because the only token
// text the app renders is the owner's link field, an input that replay
// masks (maskAllInputs). scrubStoredShareTokens cleans posthog-js's own
// persisted state the same way before init.

// A share path's token, plain or percent-encoded (`%2F`, either case). The
// token segment ends at the next `/`, `?`, `#`, `%`, `&`, whitespace or
// quote; a bare `/shared/stash` (no token) is not a vault token.
const PLAIN_RE = /\/shared\/(?:stash\/)?(?!stash(?:[/?#"'\s]|$))([^/?#%&"'\s]+)/g;
const ENCODED_RE = /%2Fshared%2F(?:stash%2F)?(?!stash(?:%2F|[&"'\s]|$))([^/?#%&"'\s]+)/gi;
const TOKEN_MARK = ":token";

/** The tokens a string's share paths carry. */
function tokensIn(text: string): string[] {
  const out: string[] = [];
  for (const re of [PLAIN_RE, ENCODED_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      let t = m[1];
      try {
        t = decodeURIComponent(t);
      } catch {
        /* keep the raw segment */
      }
      if (t && t !== TOKEN_MARK && t !== "stash") out.push(t);
    }
  }
  return out;
}

/** `t` URI-encoded, or null when it cannot be (a lone surrogate throws). */
function encoded(t: string): string | null {
  try {
    return encodeURIComponent(t);
  } catch {
    return null;
  }
}

function replaceAll(text: string, find: string, by: string): string {
  return find ? text.split(find).join(by) : text;
}

/** `text` with every share token replaced by `:token`: the tokens its own
 * share paths name, plus `known` tokens (the page's, the tab session's),
 * wherever they appear, raw or URI-encoded. */
export function redactShareText(text: string, known: readonly string[] = []): string {
  const lower = text.toLowerCase();
  const hasPath = text.includes("/shared/") || lower.includes("%2fshared%2f");
  if (
    !hasPath &&
    !known.some((t) => {
      if (!t) return false;
      const enc = encoded(t);
      return text.includes(t) || (enc != null && text.includes(enc));
    })
  )
    return text;
  const tokens = new Set([...known.filter(Boolean), ...(hasPath ? tokensIn(text) : [])]);
  let out = text;
  for (const t of tokens) {
    out = replaceAll(out, t, TOKEN_MARK);
    const enc = encoded(t);
    if (enc != null && enc !== t) out = replaceAll(out, enc, TOKEN_MARK);
  }
  return out;
}

/** Recursion bound for redactShareValue: deeper values are dropped. */
export const MAX_REDACT_DEPTH = 40;
const DROP = Symbol("drop");

function walk(
  value: unknown,
  known: readonly string[],
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof value === "string") return redactShareText(value, known);
  if (!value || typeof value !== "object") return value;
  // Too deep, or a cycle: the property is dropped rather than sent unread.
  if (depth >= MAX_REDACT_DEPTH || seen.has(value)) return DROP;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      let changed = false;
      const out: unknown[] = [];
      for (const v of value) {
        const r = walk(v, known, depth + 1, seen);
        if (r !== v) changed = true;
        if (r !== DROP) out.push(r);
      }
      return changed ? out : value;
    }
    // Keys are redacted too: posthog-js keys some data by the page URL
    // ($heatmap_data). Two keys that redact to the same key merge: arrays
    // concatenate, anything else -- the later key's value wins.
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = redactShareText(k, known);
      const r = walk(v, known, depth + 1, seen);
      if (r !== v || key !== k) changed = true;
      if (r === DROP) continue;
      const prev = out[key];
      out[key] = key in out && Array.isArray(prev) && Array.isArray(r) ? [...prev, ...r] : r;
    }
    return changed ? out : value;
  } finally {
    seen.delete(value);
  }
}

/** Every string inside `value` (objects and arrays, recursively), object
 * keys included, redacted;
 * other values unchanged. Returns the same reference when nothing changed.
 * Bounded: a cycle or anything nested deeper than MAX_REDACT_DEPTH is
 * dropped (never thrown). */
export function redactShareValue<T>(value: T, known: readonly string[] = []): T {
  const r = walk(value, known, 0, new WeakSet());
  return (r === DROP ? undefined : r) as T;
}

/** The share tokens this tab knows: the page's own (a share path) and the
 * tab session's (a share opened earlier in the tab, now on another path). */
export function knownShareTokens(
  pathname: string = window.location.pathname,
  sessionToken: string | null = null
): string[] {
  const out = tokensIn(pathname);
  if (sessionToken) out.push(sessionToken);
  return out;
}

/** The before_send hook: the event with no share token in its properties,
 * `$set` or `$set_once` -- every event, session-replay snapshots included
 * (their readable strings; see the file comment for compressed data). */
export function redactShareEvent<
  E extends { event: string; properties?: unknown; $set?: unknown; $set_once?: unknown },
>(cr: E | null, known: readonly string[] = []): E | null {
  if (!cr) return cr;
  const out = { ...cr };
  if (cr.properties !== undefined) out.properties = redactShareValue(cr.properties, known);
  if (cr.$set !== undefined) out.$set = redactShareValue(cr.$set, known);
  if (cr.$set_once !== undefined) out.$set_once = redactShareValue(cr.$set_once, known);
  return out;
}

/** Cleans posthog-js's persisted state (`key` in each store) of share
 * tokens before init: `$initial_person_info` keeps the first page's raw URL
 * for good, and a share page may have been that page. Best-effort; returns
 * whether anything changed. */
export function scrubStoredShareTokens(
  key: string,
  stores: (Pick<Storage, "getItem" | "setItem"> | null)[],
  known: readonly string[] = []
): boolean {
  let changed = false;
  for (const store of stores) {
    try {
      const raw = store?.getItem(key);
      if (!raw) continue;
      const lower = raw.toLowerCase();
      if (
        !raw.includes("/shared/") &&
        !lower.includes("%2fshared%2f") &&
        !known.some((t) => t && raw.includes(t))
      )
        continue;
      const parsed: unknown = JSON.parse(raw);
      const clean = redactShareValue(parsed, known);
      if (clean !== parsed) {
        store!.setItem(key, JSON.stringify(clean ?? {}));
        changed = true;
      }
    } catch {
      /* unreadable or unparsable: leave it */
    }
  }
  return changed;
}
