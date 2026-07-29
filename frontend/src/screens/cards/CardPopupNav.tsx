import { useEffect } from "react";

/** BL-155 decomposition: prev/next browsing, pulled out of CardPopup.tsx
 * verbatim -- the CardPopupNavigation contract, the ArrowLeft/ArrowRight
 * keyboard hook, and the two chevron buttons themselves. The close button
 * stays in CardPopup.tsx (the shell): it's a general modal control, not
 * BL-148 navigation, even though it renders visually alongside these two
 * buttons in the same `.cp-header__controls` cluster. */

/** BL-148: prev/next through CardsPage's current filtered+sorted result
 * list. `undefined` on the whole prop (see CardPopup.tsx's Props.navigation)
 * means no navigation context at all -- the affordance doesn't render. Once
 * present, `canPrev`/`canNext` independently gate each button's `disabled`
 * state (boundary behavior is DISABLE, not wrap -- the conventional default)
 * and also gate the ArrowLeft/ArrowRight keyboard shortcuts below; `onPrev`/
 * `onNext` are the actual handlers, only ever invoked when their own
 * `can*` flag is true. */
export interface CardPopupNavigation {
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/** BL-148: ArrowLeft/ArrowRight browse the current filter result the popup
 * was opened from -- a separate listener from Escape's (kept local, not
 * part of useModalDismiss's scope). Guarded against firing while focus
 * sits in an input/textarea/contenteditable -- there's nothing
 * text-editable in THIS popup today, but the guard costs nothing and
 * keeps the shortcut from misbehaving if one is ever added here (e.g. a
 * future search box) or if focus has been programmatically parked in a
 * background element while the popup is open. */
export function useArrowKeyNavigation(navigation?: CardPopupNavigation) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!navigation) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTypingTarget) return;

      if (e.key === "ArrowLeft" && navigation.canPrev) navigation.onPrev();
      if (e.key === "ArrowRight" && navigation.canNext) navigation.onNext();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigation]);
}

/** BL-148: prev/next nav flanks the close button in one absolutely-positioned
 * cluster (replacing cp-close's own standalone absolute positioning -- see
 * CardPopup.css's .cp-header__controls comment) so all three stay aligned
 * via a plain flex row instead of hand-matched offsets. Deliberately not
 * SWUButton and deliberately quieter than the × close button (no background,
 * lower opacity, a smaller thin-chevron glyph) per the owner's explicit
 * "quieter than the popup's other controls" constraint. No position
 * indicator ("12 / 87") -- kept out to leave the header's reserved control
 * width small, which is also what keeps this cluster clear of the wrapped
 * title text at narrow (phone) viewports. */
export function CardPopupNavButtons({ navigation }: { navigation: CardPopupNavigation }) {
  return (
    <>
      <button
        type="button"
        className="cp-nav-btn cp-nav-btn--prev"
        aria-label="Previous card"
        disabled={!navigation.canPrev}
        onClick={navigation.onPrev}
      >
        ‹
      </button>
      <button
        type="button"
        className="cp-nav-btn cp-nav-btn--next"
        aria-label="Next card"
        disabled={!navigation.canNext}
        onClick={navigation.onNext}
      >
        ›
      </button>
    </>
  );
}
