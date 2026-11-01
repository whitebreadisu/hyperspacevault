// The app is deliberately router-less (VerifyEmailAction.tsx reads
// window.location.search once on boot for its URL-driven case) -- this is
// the equivalent one-purpose parser for the `/shared/{token}` path of a
// share link (App Spec §19.1), read once at boot by App.tsx.

const SHARE_PATH_RE = /^\/shared\/([^/]+)\/?$/;

/** Extracts the token from a `/shared/{token}` pathname, or null for any
 * other path (including malformed variants -- an empty segment, extra path
 * segments). `pathname` is passed in rather than read here so callers can
 * feed `window.location.pathname` in the app and a literal string in tests. */
export function parseShareRouteToken(pathname: string): string | null {
  const match = SHARE_PATH_RE.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed percent-escape (e.g. a stray "%") -- treat as no route
    // rather than throwing out of what's meant to be a total function.
    return null;
  }
}
