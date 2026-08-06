// BL-184: "New Arrivals" unread tracking. Persists which release-notes entry
// the viewer has already seen via localStorage, following the SAME
// best-effort degrade-gracefully shape as utils/variantScope.ts's
// loadPriceKind/savePriceKind (itself modeled on utils/headerStarfield.ts's
// applyHeaderStarfield): storage access is wrapped in try/catch, and a
// throwing/absent/corrupt store never bubbles out to the caller.
//
// Unlike loadPriceKind (which degrades to a known-good default), a storage
// read failure here degrades to "unread" -- hasUnread's caller-facing
// contract (Header's nav item + version-label cue) is a cue that's allowed
// to be a false positive (a private-mode visitor sees a cue they can't make
// go away, mildly annoying) but never a false negative (silently hiding a
// real release from someone who can't tell the app remembered them).

import type { ReleaseNotesEntry } from "../content/releaseNotes";

const LAST_SEEN_STORAGE_KEY = "swu.releaseNotes.lastSeen";

/** The newest entry's key -- entries are stored newest-first (see
 * releaseNotes.ts), so this is simply the first one. `null` for an empty
 * list (no releases published yet -- never actually true in prod, but keeps
 * this total rather than throwing on an edge case a test might construct). */
export function latestEntryKey(entries: ReleaseNotesEntry[]): string | null {
  return entries.length > 0 ? entries[0].key : null;
}

export function loadLastSeenKey(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_STORAGE_KEY);
  } catch {
    /* storage unavailable -- see the "degrades to unread" note above */
    return null;
  }
}

export function saveLastSeenKey(key: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, key);
  } catch {
    /* best-effort, same as loadPriceKind/savePriceKind's own store */
  }
}

/** True whenever the newest entry's key doesn't match what's stored --
 * covers "never opened the notes view" (nothing stored) and "a newer entry
 * shipped since the last visit" (stored key is stale) identically. */
export function hasUnread(entries: ReleaseNotesEntry[]): boolean {
  const latest = latestEntryKey(entries);
  if (latest == null) return false;
  return loadLastSeenKey() !== latest;
}
