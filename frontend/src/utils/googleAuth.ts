/** BL-118: shared between AuthModal (sign-in) and DeleteAccountModal
 * (provider reauth) so both surfaces describe Google popup/OAuth failures
 * identically instead of forking two copies of the same error-code map. */

// Errors the user caused themselves by dismissing the Google popup --
// AuthModal's own submit-error banner would read as an alarming failure for
// something that isn't one, so these resolve to `null` (no message shown)
// rather than a generic fallback string.
const SILENT_CODES = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

const FRIENDLY_CODES: Record<string, string> = {
  "auth/account-exists-with-different-credential":
    "An account already exists with that email using a different sign-in method.",
  "auth/network-request-failed": "Network error. Please check your connection and try again.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
};

/** Returns the friendly message to show, or `null` if the failure shouldn't
 * surface any message at all (see SILENT_CODES above). */
export function describeGoogleAuthError(err: unknown): string | null {
  const code = err instanceof Error ? (err as { code?: string }).code : undefined;
  if (code && SILENT_CODES.has(code)) return null;
  const friendly = code ? FRIENDLY_CODES[code] : undefined;
  if (!friendly) {
    // BL-211: the generic fallback hides which failure actually happened --
    // during the Safari/ITP diagnosis the underlying code was invisible even
    // with a live repro in hand. Keep a console record so the next report is
    // debuggable from the reporter's own DevTools.
    console.warn("[auth] Google sign-in failed with unmapped error:", code ?? "(no code)", err);
  }
  return friendly ?? "Something went wrong signing in with Google. Please try again.";
}

/** ADR-0016 §3: the recent-auth gate and the Change Password entry point
 * both need to know whether an account has a password credential at all --
 * a Google-only user (born via Google sign-in, never linked a password) has
 * no `password` entry in providerData, so password-based reauth/change-
 * password UI isn't reachable for them. Defaults to `true` for a null/
 * undefined user or a providerData-less mock (existing tests construct bare
 * `{ email }` user fixtures) so this never regresses call sites that predate
 * BL-118 and don't model providerData at all. */
export function hasPasswordProvider(
  user: { providerData?: Array<{ providerId: string }> } | null | undefined
): boolean {
  if (!user?.providerData) return true;
  return user.providerData.some((p) => p.providerId === "password");
}

// BL-263: the main document initialises Auth without the popup/redirect
// resolver, so a Google redirect sign-in (the blocked-popup fallback) is no
// longer completed by Auth's own start-up -- AuthContext completes it with
// getRedirectResult(auth, googleResolver). Calling that on every load would
// fetch apis.google.com on every page view, so AuthModal marks a redirect as
// pending just before it navigates away, and AuthContext reads (and clears)
// the mark on the way back. sessionStorage survives the same-tab round trip
// to Google and back.
const REDIRECT_PENDING_KEY = "hsv:google-redirect-pending";

/** Record that a Google redirect sign-in is about to leave the page. */
export function markGoogleRedirectPending(): void {
  try {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, "1");
  } catch {
    // Storage unavailable: takeGoogleRedirectPending() then answers true.
  }
}

/** True when this load may be a Google redirect returning, and clears the
 * mark. Answers true when storage cannot be read, so a redirect result is
 * never dropped -- the cost of a wrong true is one background fetch of the
 * resolver, never a wait. */
export function takeGoogleRedirectPending(): boolean {
  try {
    const pending = sessionStorage.getItem(REDIRECT_PENDING_KEY) !== null;
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    return pending;
  } catch {
    return true;
  }
}
