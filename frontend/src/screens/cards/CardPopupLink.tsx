import { useEffect, useRef, useState } from "react";
import { capture } from "../../analytics/analytics";
import { copyText } from "../../utils/shareLink";

/** How long the confirmation stays. */
export const LINK_NOTE_MS = 1800;

/** The popup header's copy-link control (App Spec §5.3): the quiet chevron
 * treatment (CardPopup.css .cp-nav-btn), a link glyph, and a short readout
 * under the cluster once the link is on the clipboard. It only handles its
 * own click, so the popup's Escape and arrow keys are untouched. */
export function CardPopupLinkButton({ url }: { url: string }) {
  const [note, setNote] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // False once the popup is gone, so a copy that settles after a close sets
  // no state and starts no timer.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const onClick = async () => {
    const ok = await copyText(url);
    if (ok) capture("card_link_copied", { method: "copy", surface: "popup" });
    if (!alive.current) return;
    setNote(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (alive.current) setNote(null);
    }, LINK_NOTE_MS);
  };

  return (
    <>
      <button
        type="button"
        className="cp-nav-btn cp-link-btn"
        data-tour="card-share"
        data-tour-align="end"
        aria-label="Copy link to this card"
        title="Copy link to this card"
        onClick={onClick}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="square"
          strokeLinejoin="miter"
          aria-hidden="true"
        >
          <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.6 6" />
          <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" />
        </svg>
      </button>
      <span
        className={"cp-link-note" + (note === "failed" ? " cp-link-note--failed" : "")}
        role="status"
        aria-live="polite"
      >
        {note === "copied" ? "Link copied" : note === "failed" ? "Link not copied" : ""}
      </span>
    </>
  );
}
