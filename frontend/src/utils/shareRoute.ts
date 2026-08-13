// BL-205: the app is deliberately router-less (VerifyEmailAction.tsx's own
// docstring: "reads window.location.search on boot" for its one URL-driven
// case) -- this is the equivalent one-purpose parser for the `/shared/{token}`
// path, read once at boot the same way VerifyEmailAction reads its query
// params once at boot.

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
