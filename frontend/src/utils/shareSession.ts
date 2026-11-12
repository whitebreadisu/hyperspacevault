// Tab-session-scoped storage for the viewer-mode share the current tab has
// open (App Spec §19.1): sessionStorage survives navigation, dies with the
// tab, and reappears whenever the link is opened; the newest share replaces
// the previous; there is no saved-shares list. Follows
// the SAME degrade-gracefully shape as releaseNotesSeen.ts's
// loadLastSeenKey/saveLastSeenKey (itself modeled on headerStarfield.ts):
// storage access is wrapped in try/catch, and a throwing/absent/corrupt
// store never bubbles out to the caller.
//
// "Newest replaces the previous, no saved-shares list" falls out of the
// storage shape for free: there is exactly ONE key, holding at most one
// {token, name} pair -- saving a second share overwrites the first, there
// is nowhere a list could accumulate.

const SHARE_SESSION_KEY = "swu.share.session";

export interface ShareSession {
  token: string;
  /** The viewer's label for it: the share name, or for a stash link
   * "<share name> · <stash name>". */
  name: string;
  /** "stash" for a stash link (its token takes the stash read); absent or
   * "vault" for the vault link -- a session stored before stash links read
   * as a vault link. */
  kind?: "vault" | "stash";
  /** A stash link's share name alone (the phone's signed-out bar chip). */
  shareName?: string;
}

function isShareSession(value: unknown): value is ShareSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as ShareSession;
  return (
    typeof v.token === "string" &&
    typeof v.name === "string" &&
    (v.kind === undefined || v.kind === "vault" || v.kind === "stash") &&
    (v.shareName === undefined || typeof v.shareName === "string")
  );
}

/** The tab's current share session, or null when none is open / storage is
 * unavailable / the stored value is corrupt -- every caller treats null as
 * "no share for this tab," the same total-function shape hasUnread's
 * storage-read side uses. */
export function loadShareSession(): ShareSession | null {
  try {
    const raw = window.sessionStorage.getItem(SHARE_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isShareSession(parsed) ? parsed : null;
  } catch {
    /* storage unavailable, or the stored value wasn't valid JSON */
    return null;
  }
}

/** Opening a share link ALWAYS (re)establishes the session -- overwriting
 * whatever was stored before, even mid-tab (the newest share replaces the
 * previous, App Spec §19.1). Best-effort, same as saveLastSeenKey: a throwing
 * store never bubbles out to the caller. */
export function saveShareSession(session: ShareSession): void {
  try {
    window.sessionStorage.setItem(SHARE_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* best-effort, same as saveLastSeenKey's own store */
  }
}
