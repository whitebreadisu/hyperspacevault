import { useCallback, useEffect, useState } from "react";
import { RELEASE_NOTES } from "../content/releaseNotes";
import { hasUnread, latestEntryKey, saveLastSeenKey } from "../utils/releaseNotesSeen";

/** BL-247 S1-07 (R5-2): the phone's release-notes unread cue. Same storage
 * and semantics as desktop (App.tsx notesUnread / openNotes): unread while
 * the newest entry's key is not the stored one. The cue lives on the title
 * (badge when collapsed) and the chooser's Updates button -- never on the
 * More tab. Opening the chooser alone does not clear it; opening Updates
 * from any path does (`clear()` from the chooser in the same tap, and the
 * route effect below for every other path). */
export function useReleaseCue(path: string): { unread: boolean; clear: () => void } {
  const [unread, setUnread] = useState(() => hasUnread(RELEASE_NOTES));
  const clear = useCallback(() => {
    const latest = latestEntryKey(RELEASE_NOTES);
    if (latest != null) saveLastSeenKey(latest);
    setUnread(false);
  }, []);
  const onUpdates = path === "more/updates";
  useEffect(() => {
    if (onUpdates) clear();
  }, [onUpdates, clear]);
  return { unread, clear };
}
