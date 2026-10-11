import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MIcon } from "../icons";
import { MSWUButton } from "../MSWUButton";
import { useSheetHost } from "../Sheet";
import "./verify.css";

// BL-249 S3-14: desktop's close-guard confirm (AddCardsModal.tsx:738-775,
// copy verbatim; AddCardsModal.css .ac-confirm: steel ring, 14 px cut,
// circuit tile at 420) as rev4 MVerify.jsx DiscardConfirm drew it on the
// phone: centred over a scrim, X top-right (it returns to the batch), two
// 44 px SWUButtons. "Discard & Close" carries the destructive fill #c0202e
// on the button itself (F-2: `.swu-btn` sets its own resting
// --color-primary, which shadows any value inherited from a wrapper --
// desktop's `.ac-confirm__danger` wrapper rule renders navy for that
// reason). "Return to Batch" keeps the resting navy. Rendered into the
// SheetHost so it covers the tool and any open sheet (the Verify cards
// sheet's "Discard batch" asks the same question). Escape and the scrim
// return to the batch.

export interface DiscardConfirmProps {
  onDiscard: () => void;
  onReturn: () => void;
}

export function DiscardConfirm({ onDiscard, onReturn }: DiscardConfirmProps) {
  const host = useSheetHost();
  const ret = useRef(onReturn);
  useEffect(() => {
    ret.current = onReturn;
  }, [onReturn]);
  const xBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Capture phase: the sheet under the confirm must not also close.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      ret.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    if (host) xBtn.current?.focus({ preventScroll: true });
  }, [host]);

  if (!host) return null;
  return createPortal(
    <div
      className="m-d2-confirm-layer"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="m-d2-confirm-title"
      aria-describedby="m-d2-confirm-body"
    >
      <div className="m-d2-confirm-scrim" onClick={onReturn} />
      <div className="m-d2-confirm">
        <div className="m-d2-confirm__in">
          <div className="m-d2-confirm__head">
            <div className="m-d2-confirm__title" id="m-d2-confirm-title">
              Discard this batch?
            </div>
            <button
              ref={xBtn}
              type="button"
              className="m-iconbtn m-d2-confirm__x"
              onClick={onReturn}
              aria-label="Return to Batch"
            >
              <MIcon name="close" />
            </button>
          </div>
          <p className="m-d2-confirm__body" id="m-d2-confirm-body">
            None of the cards you have entered will be added to inventory if you close now.
          </p>
          <div className="m-d2-confirm__actions">
            <span className="m-d2-confirm__danger">
              <MSWUButton size="touch" onClick={onDiscard}>
                Discard &amp; Close
              </MSWUButton>
            </span>
            <MSWUButton size="touch" onClick={onReturn}>
              Return to Batch
            </MSWUButton>
          </div>
        </div>
      </div>
    </div>,
    host
  );
}
