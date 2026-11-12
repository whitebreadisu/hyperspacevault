// A share link's token is its only credential (App Spec §19.1), so it never
// reaches analytics. posthog-js puts the page URL into every event
// ($current_url, $pathname, $referrer, the $initial_* person properties,
// autocapture's element hrefs, pageleave): on a `/shared/{token}` or
// `/shared/stash/{token}` page each of those carries the token. The SDK's
// before_send hook (analytics.ts) runs every event through redactShareEvent,
// which replaces the token segment with `:token` in every string it holds.

// A vault link's token, or a stash link's (`stash/` then the token). The
// token segment ends at the next `/`, `?`, `#`, whitespace or quote.
const SHARE_TOKEN_RE = /\/shared\/(stash\/)?(?!stash(?:[/?#"'\s]|$))[^/?#"'\s]+/g;

/** `text` with every share token replaced by `:token`. */
export function redactShareText(text: string): string {
  if (!text.includes("/shared/")) return text;
  return text.replace(SHARE_TOKEN_RE, (_m, stash: string | undefined) =>
    stash ? "/shared/stash/:token" : "/shared/:token"
  );
}

/** Every string inside `value` (objects and arrays, recursively) redacted;
 * other values unchanged. Returns the same reference when nothing changed. */
export function redactShareValue<T>(value: T): T {
  if (typeof value === "string") return redactShareText(value) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = redactShareValue(v);
      if (r !== v) changed = true;
      return r;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = redactShareValue(v);
      if (r !== v) changed = true;
      out[k] = r;
    }
    return (changed ? out : value) as T;
  }
  return value;
}

/** The before_send hook: the event with no share token in its properties,
 * `$set` or `$set_once`. Session-replay snapshots are large, so they are
 * walked only while this page is a share page (the only time their URLs
 * and DOM can hold a token). */
export function redactShareEvent<
  E extends { event: string; properties?: unknown; $set?: unknown; $set_once?: unknown },
>(cr: E | null, pathname: string = window.location.pathname): E | null {
  if (!cr) return cr;
  if (cr.event === "$snapshot" && !pathname.startsWith("/shared/")) return cr;
  const out = { ...cr };
  if (cr.properties !== undefined) out.properties = redactShareValue(cr.properties);
  if (cr.$set !== undefined) out.$set = redactShareValue(cr.$set);
  if (cr.$set_once !== undefined) out.$set_once = redactShareValue(cr.$set_once);
  return out;
}
