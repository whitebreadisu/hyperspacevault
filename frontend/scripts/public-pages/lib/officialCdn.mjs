// The "no hotlinking" rule's scan (design note §5a): generated output must
// never name the official card-image CDN. This is a scan of raw text (HTML,
// XML, JSON, JS), not a URL parse, so the host counts wherever it appears:
// in a src or href, inside url(), in a string literal, in prose. Every
// host-shaped token in the text is compared whole, case-insensitively, with
// the host or any subdomain of it -- a stricter test than a substring match
// would be for the official host itself, without flagging a different host
// that merely contains its letters.

export const OFFICIAL_CDN = "cdn.starwarsunlimited.com";

const HOST_TOKEN_RE = /[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** True when `text` names the official CDN host (or a subdomain of it). */
export function namesOfficialCdn(text) {
  for (const [token] of text.matchAll(HOST_TOKEN_RE)) {
    const host = token.toLowerCase().replace(/^-+/, "");
    if (host === OFFICIAL_CDN || host.endsWith("." + OFFICIAL_CDN)) return true;
  }
  return false;
}
