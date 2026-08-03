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

/** BL-192: the popup's OWN left-hand printings rail -- a different axis from
 * BL-148's ArrowLeft/ArrowRight (which browse CardsPage's filtered result
 * list, a card at a time). `orderedVariantIds` is the same flat order the
 * rail renders (CardPopupRail.tsx's `orderVariants`, re-exported from
 * cardPopupShared.ts) so "next row down" here always matches "next row
 * down" visually. Deliberately keyed on `selectedVariantId` (a number) and
 * an ARRAY OF IDS, never on VariantDetail object identity -- CardPopup's
 * useInventoryMutation gives the mutated variant a brand-new object on every
 * +/- click (see CardPopup.tsx's backImageSrc doc comment), so an
 * identity-based lookup here would silently break the very first time a
 * user steps a quantity before cycling. */
export interface VariantCycleContext {
  orderedVariantIds: number[];
  selectedVariantId: number | null;
  onSelect: (variantId: number) => void;
}

/** BL-192: ArrowUp/ArrowDown cycle the selection through `orderedVariantIds`,
 * WRAPPING at both ends -- deliberately the opposite boundary behavior from
 * useArrowKeyNavigation's ArrowLeft/ArrowRight above (which DISABLE at list
 * boundaries, no wrap). That asymmetry is intentional, not a bug to
 * reconcile: prev/next CARD browsing has a real list edge (there's no "card
 * before the first search result"), while cycling PRINTINGS of the same
 * card is a closed loop with no natural edge. Typing guard mirrors
 * useArrowKeyNavigation's, EXTENDED to also skip `SELECT` targets (no
 * select element lives in this popup today, but the guard costs nothing and
 * this hook's own doc comment is the natural place to note the divergence
 * from the sibling hook's guard list). `e.preventDefault()` fires ONLY once
 * the shortcut actually resolves to a selection -- the popup body itself
 * scrolls on ArrowUp/ArrowDown, and un-prevented arrows must keep that
 * native scroll on every other path (no context, empty list, current
 * selection not found in the list). Stays live while the expanded full
 * history panel is open below the rail -- Escape already routes layered
 * dismissal for that panel, and cycling printings remains a valid action
 * the whole time it's expanded. */
export function useVariantCycleKeys(context?: VariantCycleContext) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!context) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isTypingTarget) return;

      const { orderedVariantIds, selectedVariantId, onSelect } = context;
      if (orderedVariantIds.length === 0) return;
      const currentIndex =
        selectedVariantId != null ? orderedVariantIds.indexOf(selectedVariantId) : -1;
      if (currentIndex === -1) return;

      const delta = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (currentIndex + delta + orderedVariantIds.length) % orderedVariantIds.length;

      e.preventDefault();
      onSelect(orderedVariantIds[nextIndex]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [context]);
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
