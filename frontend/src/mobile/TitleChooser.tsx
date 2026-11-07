import { useEffect, useId, useRef } from "react";
import { MIcon } from "./icons";
import { SWUButton } from "../components/SWUButton";
import { BrandLogo } from "./BrandLogo";
import logoFull2x from "../assets/brand/hsv-logo-full@2x.webp";
import logoFull3x from "../assets/brand/hsv-logo-full@3x.webp";

// The brand chooser -- a small centred card of the transactional family
// (desktop AuthModal.css .auth-modal-card), X top-right, two SWUButtons:
// About & Legal and [HSV] Updates. The Updates button carries the unread
// pulse while an update is unread (App Spec §25.4, §5.12).
// Phone: tapping the brand stack (expanded) or the logo badge (collapsed)
// opens it; the initials logo heads it (shell.css .m-chooser).
// Desktop (`desktop`): the header's logo and tag line open it; the full logo
// heads it, 52 px buttons, desktop's modal scrim (index.css .hsv-chooser).

interface Props {
  unread: boolean;
  onClose: () => void;
  onAbout: () => void;
  onUpdates: () => void;
  desktop?: boolean;
}

export function TitleChooser({ unread, onClose, onAbout, onUpdates, desktop = false }: Props) {
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

  const size = desktop ? "md" : "touch";
  return (
    <div className={desktop ? "m-chooser hsv-chooser" : "m-chooser"}>
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
          {desktop ? (
            <img
              className="hsv-chooser__logo"
              src={logoFull2x}
              srcSet={`${logoFull2x} 2x, ${logoFull3x} 3x`}
              alt="Hyperspace Vault"
              width={158}
              height={46}
            />
          ) : (
            <BrandLogo size="heading" />
          )}
        </h2>
        <div className="m-chooser__btns">
          <SWUButton size={size} onClick={onAbout} className="m-chooser__btn">
            About & Legal
          </SWUButton>
          <SWUButton
            size={size}
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
