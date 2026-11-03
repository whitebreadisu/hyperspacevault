import { useCallback, useEffect, useRef, useState } from "react";
import { shareOrCopy } from "../../utils/shareLink";
import { capturePhone } from "../phoneAnalytics";

/** How long the top bar's readout shows the copy confirmation. */
export const SHARE_NOTE_MS = 1800;

export type ShareNote = "copied" | "failed" | null;

/** The card detail's share control (App Spec §25.2): the system share sheet
 * with the card's name and link, else a copy. A copy shows a confirmation in
 * the top bar's readout for a moment; a share the user cancels does nothing
 * and sends nothing. `card_link_copied` (§22) on a completed share or copy. */
export function useCardShare(): { note: ShareNote; share: (title: string, url: string) => void } {
  const [note, setNote] = useState<ShareNote>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const share = useCallback((title: string, url: string) => {
    void shareOrCopy(title, url).then((outcome) => {
      if (outcome === "shared")
        capturePhone("card_link_copied", { method: "share", surface: "phone" });
      if (outcome === "copied")
        capturePhone("card_link_copied", { method: "copy", surface: "phone" });
      if (outcome !== "copied" && outcome !== "failed") return;
      setNote(outcome);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setNote(null), SHARE_NOTE_MS);
    });
  }, []);

  return { note, share };
}
