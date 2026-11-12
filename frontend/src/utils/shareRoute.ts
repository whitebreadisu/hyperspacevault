// The app is deliberately router-less (VerifyEmailAction.tsx reads
// window.location.search once on boot for its URL-driven case) -- this is
// the equivalent one-purpose parser for a share link's path (App Spec
// §19.1), read once at boot by App.tsx and the phone's useShare: a vault
// link is `/shared/{token}`, a stash link `/shared/stash/{token}`
// (api/sharedView.ts stashShareUrl builds it).

const SHARE_PATH_RE = /^\/shared\/([^/]+)\/?$/;
const STASH_SHARE_PATH_RE = /^\/shared\/stash\/([^/]+)\/?$/;

/** Which read a share link's token takes: the vault reads or the stash read. */
export type ShareKind = "vault" | "stash";

export interface ShareRoute {
  kind: ShareKind;
  token: string;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed percent-escape (e.g. a stray "%") -- treat as no route
    // rather than throwing out of what's meant to be a total function.
    return null;
  }
}

/** Extracts the token from a `/shared/{token}` pathname, or null for any
 * other path (including malformed variants -- an empty segment, extra path
 * segments, and a stash link's `/shared/stash/{token}`). `pathname` is
 * passed in rather than read here so callers can feed
 * `window.location.pathname` in the app and a literal string in tests. */
export function parseShareRouteToken(pathname: string): string | null {
  const match = SHARE_PATH_RE.exec(pathname);
  return match ? decode(match[1]) : null;
}

/** Either share link: a stash link (`/shared/stash/{token}`) or a vault
 * link (`/shared/{token}`), with its token; null for any other path. */
export function parseShareRoute(pathname: string): ShareRoute | null {
  const stash = STASH_SHARE_PATH_RE.exec(pathname);
  if (stash) {
    const token = decode(stash[1]);
    return token ? { kind: "stash", token } : null;
  }
  // `/shared/stash` with no token is a stash link missing its token, not a
  // vault link whose token is "stash".
  if (/^\/shared\/stash\/?$/.test(pathname)) return null;
  const token = parseShareRouteToken(pathname);
  return token ? { kind: "vault", token } : null;
}
