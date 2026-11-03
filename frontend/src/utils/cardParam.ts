// The `?card=<set>-<number>` boot parameter (design note §9 "Optional
// extra"): every action on a public card page opens a card inside the app
// through it -- this card from the bar, the wordmark and the sign-up plate,
// the neighbouring card from prev / next -- e.g. `/?card=sor-006`. On boot the desktop app opens
// that card's popup and the phone app navigates to `#/card/<base_card_id>`.
// The value names the card by set code and base number, never by database id
// (ids differ between dev and prod); it resolves through the base-cards list
// the app already loads. Absent, malformed or unknown = nothing happens.

export interface CardParam {
  /** Upper-case set code, as the catalogue spells it ("SOR"). */
  setCode: string;
  /** The base number without padding ("6"). */
  number: string;
}

const PARAM = /^([a-z0-9]{2,8})-(\d{1,4})$/i;

/** `sor-006`: lower-case set code, number zero-padded to 3 (the public
 * pages' URL rule). Both parts are URI-encoded, so an unexpected character
 * can never change the query (real codes and numbers are unchanged). */
export function formatCardParam(setCode: string, num: string): string {
  const n = /^\d+$/.test(num) ? num.padStart(3, "0") : num;
  return `${encodeURIComponent(setCode.toLowerCase())}-${encodeURIComponent(n)}`;
}

/** `/?card=sor-006` */
export function cardAppHref(setCode: string, num: string): string {
  return `/?card=${formatCardParam(setCode, num)}`;
}

/** Reads `card` from a query string; null when absent or malformed. */
export function parseCardParam(search: string): CardParam | null {
  const raw = new URLSearchParams(search).get("card");
  if (raw == null) return null;
  const m = PARAM.exec(raw.trim());
  if (!m) return null;
  return { setCode: m[1].toUpperCase(), number: String(Number(m[2])) };
}

interface ListedCard {
  set_code: string;
  base_card_number: string;
  is_token?: boolean;
}

/** The non-token card at that set and number (unique per design note §2),
 * or null. */
export function resolveCardParam<T extends ListedCard>(
  cards: readonly T[],
  param: CardParam
): T | null {
  for (const c of cards) {
    if (c.is_token) continue;
    if (c.set_code.toUpperCase() !== param.setCode) continue;
    if (!/^\d+$/.test(c.base_card_number)) continue;
    if (String(Number(c.base_card_number)) === param.number) return c;
  }
  return null;
}

/** Drops `card` from the address bar without a history entry, keeping the
 * path, every other parameter and the hash. */
export function clearCardParam(): void {
  clearParam("card");
}

function clearParam(name: string): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

// `&signup=1` (design note §9 "Optional extra"): the public card page's
// "Create free account" adds it, `/?card=sor-005&signup=1`, so the app opens
// its sign-in dialog in create-account mode (alongside the card when `card`
// is there too). Read once at boot, only on `/`; any other value or absent =
// nothing happens.

/** True when the query carries `signup=1`. */
export function parseSignupParam(search: string): boolean {
  return new URLSearchParams(search).get("signup") === "1";
}

/** The boot read: on `/` only. */
export function bootSignupParam(): boolean {
  return window.location.pathname === "/" && parseSignupParam(window.location.search);
}

/** Drops `signup` from the address bar the way clearCardParam drops `card`. */
export function clearSignupParam(): void {
  clearParam("signup");
}

/** An app link with `signup=1` added: `/?card=sor-005` -> `/?card=sor-005&signup=1`. */
export function withSignup(href: string): string {
  return href + (href.includes("?") ? "&" : "?") + "signup=1";
}
