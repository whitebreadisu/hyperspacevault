// BL-205 (SWU_Application_Spec.md §19.1): tab-session-scoped storage for the
// viewer-mode share the current tab has open -- "sessionStorage: survives
// navigation, dies with the tab, and reappears whenever the link is opened
// ... newest share replaces the previous ... no saved-shares list." Follows
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
  name: string;
}

function isShareSession(value: unknown): value is ShareSession {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ShareSession).token === "string" &&
    typeof (value as ShareSession).name === "string"
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
 * whatever was stored before, even mid-tab (owner ruling: "newest share
 * replaces the previous"). Best-effort, same as saveLastSeenKey: a throwing
 * store never bubbles out to the caller. */
export function saveShareSession(session: ShareSession): void {
  try {
    window.sessionStorage.setItem(SHARE_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* best-effort, same as saveLastSeenKey's own store */
  }
}
