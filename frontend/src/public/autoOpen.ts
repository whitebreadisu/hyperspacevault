import { cardAppHref } from "../utils/cardParam";
import { hasSeenApp } from "../utils/appSeen";

// The returning-visitor redirect (design note §4 D4, App Spec §22): a browser
// that has opened the app before goes straight from a card page to the same
// card in the app. The server-rendered page is unchanged, so a crawler and a
// first-time visitor see the page; the decision runs only in the page script,
// before hydration. A `page` query parameter (any value, or bare) keeps the
// visitor on the page.

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
