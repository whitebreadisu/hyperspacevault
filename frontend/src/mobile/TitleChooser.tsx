import { useEffect, useId, useRef } from "react";
import { MIcon } from "./icons";
import { SWUButton } from "../components/SWUButton";

// BL-247 S1-07 (R5-2): tapping the title (expanded) or the [HSV] badge
// (collapsed) opens this chooser -- a small centred card of the
// transactional family (desktop AuthModal.css .auth-modal-card, phone values
// rev4 m-rev4-d2.css:137-199), X top-right, two SWUButtons. The Updates
// button carries the unread pulse while an update is unread.

interface Props {
  unread: boolean;
  onClose: () => void;
  onAbout: () => void;
  onUpdates: () => void;
}

export function TitleChooser({ unread, onClose, onAbout, onUpdates }: Props) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="m-chooser">
      <div className="m-chooser__scrim" onClick={onClose} />
      <div
        ref={cardRef}
        className="auth-modal-card m-chooser__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button type="button" className="m-chooser__x" onClick={onClose} aria-label="Close">
          <MIcon name="close" size={22} />
        </button>
        <h2 className="auth-card__title" id={titleId}>
          [HSV] Hyperspace Vault
        </h2>
        <div className="m-chooser__btns">
          <SWUButton size="touch" onClick={onAbout} className="m-chooser__btn">
            About & Legal
          </SWUButton>
          <SWUButton
            size="touch"
            onClick={onUpdates}
            className={"m-chooser__btn" + (unread ? " m-chooser__btn--cue" : "")}
          >
            <span className={unread ? "m-cue" : undefined} data-cue="[HSV] Updates">
              [HSV] Updates
            </span>
          </SWUButton>
        </div>
      </div>
    </div>
  );
}
