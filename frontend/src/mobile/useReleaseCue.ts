import { useCallback, useState } from "react";
import { RELEASE_NOTES } from "../content/releaseNotes";
import { hasUnread, latestEntryKey, saveLastSeenKey } from "../utils/releaseNotesSeen";

/** BL-247 S1-07 / BL-250 S4-04 (R5-2 + D2-0): the phone's release-notes
 * unread cue. Same storage and semantics as desktop (App.tsx notesUnread /
 * openNotes): unread while the newest entry's key is not the stored one.
 *
 * - The title (badge when collapsed) carries the cue, and the chooser's
 *   Updates button; the More tab never does.
 * - The Updates row inside More pulses only if More was opened before the
 *   title this session (`first`): whichever of the two the user reached first
 *   decides, once.
 * - Opening the chooser alone does not clear. Only the real Updates screen
 *   clears, on its mount (`clear()`; S1 review F7: the S1 placeholder path
 *   cleared on the route alone and is gone). */
export type CueFirst = "more" | "title" | null;

export interface CueState {
  unread: boolean;
  first: CueFirst;
}

export type CueEvent = "more" | "title" | "seen";

/** The cue's state machine (pure; vitest S4-04). */
export function cueStep(s: CueState, ev: CueEvent): CueState {
  if (ev === "seen") return s.unread ? { ...s, unread: false } : s;
  if (s.first != null) return s;
  return { ...s, first: ev };
}

/** The More row pulses while unread when More came first -- or is being
 * opened now, before the title was ever tapped (first still null). */
export function moreRowPulses(s: CueState): boolean {
  return s.unread && s.first !== "title";
}

export interface ReleaseCue {
  unread: boolean;
  /** The Updates row inside More pulses (only meaningful while More shows). */
  moreCue: boolean;
  clear: () => void;
  noteMore: () => void;
  noteTitle: () => void;
}

export function useReleaseCue(): ReleaseCue {
  const [s, setS] = useState<CueState>(() => ({ unread: hasUnread(RELEASE_NOTES), first: null }));
  const clear = useCallback(() => {
    const latest = latestEntryKey(RELEASE_NOTES);
    if (latest != null) saveLastSeenKey(latest);
    setS((p) => cueStep(p, "seen"));
  }, []);
  const noteMore = useCallback(() => setS((p) => cueStep(p, "more")), []);
  const noteTitle = useCallback(() => setS((p) => cueStep(p, "title")), []);
  return { unread: s.unread, moreCue: moreRowPulses(s), clear, noteMore, noteTitle };
}
