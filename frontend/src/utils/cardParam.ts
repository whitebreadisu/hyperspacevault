// The `?card=<set>-<number>` boot parameter (design note §9 "Optional
// extra", owner-reviewed 2026-11-02): a public card page's prev / next arrows
// open a card inside the app, `/?card=sor-006`. On boot the desktop app opens
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
 * pages' URL rule). */
export function formatCardParam(setCode: string, num: string): string {
  const n = /^\d+$/.test(num) ? num.padStart(3, "0") : num;
  return `${setCode.toLowerCase()}-${n}`;
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
  const url = new URL(window.location.href);
  if (!url.searchParams.has("card")) return;
  url.searchParams.delete("card");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
