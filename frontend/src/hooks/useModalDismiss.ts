import { useEffect } from "react";
import type { MouseEvent } from "react";

/**
 * The one Escape-key dismissal hook for modals, popovers and dropdowns. Each
 * call site keeps its own Escape semantics through the options below; the
 * hook does not flatten them into one behavior.
 *
 * ── `onEscape` ──────────────────────────────────────────────────────────
 * Called whenever Escape fires while the hook is enabled. It is
 * deliberately NOT assumed to mean "close the modal" -- several call sites
 * route Escape to collapse a nested sub-state *first* and only close on a
 * later press once nothing nested is open:
 *   - CardPopup: Escape collapses the expanded price-history panel before
 *     it closes the popup itself.
 *   - AddCardsModal: Escape dismisses the close-guard confirm dialog
 *     before it raises that same confirm (via requestClose) on a batch
 *     that still has entered rows.
 * Callers with this kind of routing pass a closure that reads their own
 * state and decides; simple callers just pass `onClose`.
 *
 * ── `enabled` (default true) ────────────────────────────────────────────
 * Most modals are only ever mounted while open (the parent conditionally
 * renders them), so the listener can simply live for the component's
 * whole mounted lifetime -- `enabled` stays at its default. Components
 * that stay mounted while closed pass it explicitly, so the listener is
 * attached only while they are open and Escape never fires (or captures a
 * keypress) while closed:
 *   - FinishFilter / MultiSelect / UserMenu / VariantScopeControls'
 *     menu: always-mounted dropdowns, `enabled={open}`.
 *   - InventorySummary: `enabled` while a breakdown is expanded.
 *   - VerifyEmailAction: always-mounted (it renders null for the ordinary
 *     no-action-link case), gated on `status !== null`.
 *
 * Submitting-guards (Escape is a no-op while a destructive/network action
 * is in flight) take one of two forms. DeleteAccountModal and FeedbackModal
 * keep the listener attached and put the guard inside the `onEscape`
 * closure they pass (`() => { if (!submitting) onClose(); }`), so the
 * listener is not detached and reattached on every submitting flip.
 * ShareManageModal instead passes `enabled: !submitting`.
 *
 * ── `onBackdropClick` (optional) ────────────────────────────────────────
 * Two call sites (CardPopup, AddCardsModal) dismiss via a target-equality
 * check on the overlay's own `onMouseDown` (`if (e.target ===
 * e.currentTarget) close()`), so a mousedown that starts inside the modal
 * panel and is dragged/released over the overlay doesn't falsely count as
 * a backdrop click. Passing `onBackdropClick` returns a ready-made handler
 * for that exact pattern -- wire it to the overlay div's `onMouseDown`.
 *
 * The other modals (AboutModal, AuthModal, ChangePasswordModal,
 * DeleteAccountModal, FeedbackModal, ShareManageModal, VerifyEmailAction)
 * dismiss via a different, simpler mechanism instead -- a plain
 * `onClick={onClose}` on the overlay with
 * `onClick={(e) => e.stopPropagation()}` on the inner card, so a click that
 * starts and ends inside the card never bubbles out to the overlay at all.
 * That pattern is just JSX prop wiring (no duplicated *logic* to extract)
 * and stays at each of those sites, including the ones that guard it on
 * `submitting` (`onClick={submitting ? undefined : onClose}`).
 *
 * Explicitly NOT in scope: focus-trap / a11y -- this hook does not manage
 * focus.
 */
export interface UseModalDismissOptions {
  /** Whether the Escape listener is attached. Default `true`. */
  enabled?: boolean;
  /** If provided, returns `handleBackdropMouseDown` wired for the
   * target-equality backdrop-click pattern (see file docstring). */
  onBackdropClick?: () => void;
}

export interface UseModalDismissResult {
  /** Wire to the overlay element's `onMouseDown`. Only present when
   * `onBackdropClick` was passed. */
  handleBackdropMouseDown?: (e: MouseEvent) => void;
}

export function useModalDismiss(
  onEscape: () => void,
  options: UseModalDismissOptions = {}
): UseModalDismissResult {
  const { enabled = true, onBackdropClick } = options;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onEscape]);

  if (!onBackdropClick) return {};

  return {
    handleBackdropMouseDown: (e: MouseEvent) => {
      if (e.target === e.currentTarget) onBackdropClick();
    },
  };
}
