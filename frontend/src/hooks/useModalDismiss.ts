import { useEffect } from "react";
import type { MouseEvent } from "react";

/**
 * BL-153 (A3-06): extracted from 11 call sites that each hand-rolled the
 * same `useEffect(() => { document.addEventListener("keydown", ...) ...
 * }, [...])` block for Escape-key dismissal (App.tsx is the 12th file the
 * audit's grep matched, but it never rendered its own listener -- every
 * modal it opens already owned one, which is exactly the duplication this
 * hook replaces). This is a refactor, not a UX change: every call site's
 * existing Escape semantics are preserved via the two options below, NOT
 * flattened into one behavior.
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
 * whole mounted lifetime -- `enabled` stays at its default. Two different
 * shapes need it explicit:
 *   - FinishFilter / MultiSelect / UserMenu: always-mounted dropdowns that
 *     track their own `open` boolean -- the original code's early-out
 *     (`if (!open) return undefined`) meant the listener was only ever
 *     attached while the dropdown was open, so Escape never fires (or
 *     accidentally captures a keypress) while closed. `enabled={open}`
 *     reproduces that exactly.
 *   - VerifyEmailAction: always-mounted (it renders null for the ordinary
 *     no-action-link case), gated on `status !== null` the same way.
 *
 * Submitting-guards (DeleteAccountModal, FeedbackModal -- Escape is a
 * no-op while a destructive/network action is in flight) are NOT modeled
 * as `enabled`: the listener stays attached (matching the original
 * always-attached effect with the guard *inside* the handler), the guard
 * just lives inside the `onEscape` closure the caller passes in
 * (`() => { if (!submitting) onClose(); }`). Using `enabled` there would
 * detach/reattach the listener on every submitting flip instead of just
 * no-op'ing it, a behavior difference from the original.
 *
 * ── `onBackdropClick` (optional) ────────────────────────────────────────
 * Two call sites (CardPopup, AddCardsModal) dismiss via a target-equality
 * check on the overlay's own `onMouseDown` (`if (e.target ===
 * e.currentTarget) close()`), so a mousedown that starts inside the modal
 * panel and is dragged/released over the overlay doesn't falsely count as
 * a backdrop click. Passing `onBackdropClick` returns a ready-made handler
 * for that exact pattern -- wire it to the overlay div's `onMouseDown`.
 *
 * The other six call sites (AboutModal, AuthModal, ChangePasswordModal,
 * DeleteAccountModal, FeedbackModal, VerifyEmailAction) dismiss via a
 * different, simpler mechanism instead -- a plain `onClick={onClose}` on
 * the overlay with `onClick={(e) => e.stopPropagation()}` on the inner
 * card, so a click that starts and ends inside the card never bubbles out
 * to the overlay at all. That pattern is just JSX prop wiring (no
 * duplicated *logic* to extract) and is left as-is at each of those sites,
 * including the two that guard it on `submitting`
 * (`onClick={submitting ? undefined : onClose}`).
 *
 * Explicitly NOT in scope: focus-trap / a11y (BL-150 audit A3-06 notes it
 * as a separate gap) -- this hook does not manage focus.
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
