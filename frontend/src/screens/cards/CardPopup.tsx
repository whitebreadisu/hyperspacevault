import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBaseCardDetail } from "../../api/baseCards";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";
import { useLimits } from "../../context/LimitsContext";
import { typeCategoryOf } from "../../utils/limits";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import type { PriceRailMode } from "./CardPopupRail";
import { CardPopupView } from "./CardPopupView";
import { useCardFlip } from "./useCardFlip";
import { CardPopupExpandedHistory } from "./CardPopupPriceHistory";
import {
  CardPopupNavButtons,
  useArrowKeyNavigation,
  useVariantCycleKeys,
  type VariantCycleContext,
} from "./CardPopupNav";
import { CardPopupInventoryControls, useInventoryMutation } from "./CardPopupInventory";
import type { CardPopupNavigation } from "./CardPopupNav";
import { orderVariants } from "./cardPopupShared";
import { CardPopupLinkButton } from "./CardPopupLink";
import { cardPageUrl } from "../../public/publicCatalog";
import { defaultPrinting } from "../../utils/printingSlug";
import { capture } from "../../analytics/analytics";
import "./CardPopup.css";

export type { CardPopupNavigation };

/** Card popup shell. Composes the popup from:
 *   - CardPopupView.tsx -- the view (header, rail, image column, info). It
 *     takes the card as props, so the public card page (src/public) renders
 *     the same view; this file is the app's container around it.
 *   - useCardFlip.ts -- the leader flip and image-morph state.
 *   - CardPopupRail.tsx -- the printings rail (grouping/ordering, the
 *     Market/Low price-mode toggle, the compact price-history embed).
 *   - CardPopupPriceHistory.tsx -- both PriceHistoryPanel mount points
 *     (compact embed + expand-below full panel).
 *   - CardPopupNav.tsx -- the CardPopupNavigation contract, the
 *     ArrowLeft/ArrowRight keyboard hook, and the chevron buttons.
 *   - CardPopupInventory.tsx -- the owned-quantity stepper (InventoryPlate),
 *     the signed-out nudge, and the increment/decrement mutation hook.
 *   - cardPopupShared.ts -- variantLabel, shared between the rail and the
 *     inventory stepper's aria-labels.
 * This file owns data fetching, the modal frame, keyboard and dismissal,
 * inventory and analytics. */

/** ONE modal: a printings picker (left) that selects a printing, a card image
 * + inventory stepper for that printing (center), and read-only card info
 * (right). */

/** Default the initial/displayed-on-load selection to the Standard printing
 * (utils/printingSlug.ts defaultPrinting: the lowest-id Standard, else the
 * lowest id), the printing a card link without `v` names. */
function pickRepresentative(variants: VariantDetail[]): VariantDetail | null {
  return defaultPrinting(variants);
}

/** When the Vault's variant scope is active, the popup should open on the
 * SAME finish the collector is scoped to -- the whole click-through path
 * (table row -> popup) stays in their chosen finish (companion to the scoped
 * number/sort in the table and the rail's keyboard cycling). Uses the
 * codebase-universal `(v.finish ?? v.variant_type) === scope` rule
 * (utils/variantScope.ts) and the same find-FIRST-match caveat as
 * scopedOwnedCount/scopedCardNumber -- normally exactly one variant carries a
 * given raw finish. Falls back to pickRepresentative when there's no scope or
 * the card carries no printing of the scoped finish (mid-session edge;
 * filtered rows normally all match). */
function pickInitialVariant(
  variants: VariantDetail[],
  initialFinish: string | null | undefined,
  initialVariantId?: number | null
): VariantDetail | null {
  if (initialVariantId != null) {
    const linked = variants.find((v) => v.variant_id === initialVariantId);
    if (linked) return linked;
  }
  if (initialFinish != null) {
    const scoped = variants.find((v) => (v.finish ?? v.variant_type) === initialFinish);
    if (scoped) return scoped;
  }
  return pickRepresentative(variants);
}

interface Props {
  baseCardId: number;
  isAuthenticated: boolean;
  /** True for a shared-vault viewer (App Spec §19.1) -- see
   * CardPopupInventory's InventoryPlate `readOnly` doc comment for what it
   * changes (the stepper's -/+ buttons are removed, not disabled). Only
   * meaningful together with `isAuthenticated=true` (CardsPage's `hasData`);
   * defaults to false. */
  readOnly?: boolean;
  /** Per-variant quantities to display INSTEAD of the detail response's. The
   * detail endpoint (get_optional_db) embeds quantities for the CALLER's auth
   * context, which in a shared vault is the wrong tenant twice over -- zeros
   * for an anonymous viewer, and the viewer's OWN counts for a signed-in one.
   * CardsPage already holds the share owner's full quantities map (the
   * /api/shared/{token}/quantities rows the table renders from), so
   * viewer-mode passes it down and the popup trusts it over the response.
   * Undefined = normal owner/anonymous behavior, response quantities
   * untouched. */
  quantityOverrides?: Record<number, number>;
  /** code -> full set name, built from getSets() -- already fetched by
   * CardsPage for VariantsTooltip, reused here rather than re-fetching. */
  setNameByCode: Record<string, string>;
  onClose: () => void;
  onChanged?: () => void;
  /** Inert-teaser pattern: opens the shell's AuthModal. The signed-out
   * inventory plate's "Sign in" button routes through this. */
  onRequestSignIn?: () => void;
  /** See CardPopupNavigation above. Optional -- the popup itself doesn't know
   * or care whether it was opened from a list. */
  navigation?: CardPopupNavigation;
  /** The Vault's active variant scope (CardsPage's `scope` state), a raw
   * finish string or null. When set, the popup's initial selection on EVERY
   * detail fetch (including prev/next navigation between cards) prefers the
   * variant matching this finish over pickRepresentative -- see
   * pickInitialVariant above. Optional/undefined behaves exactly like null
   * (no scope). */
  initialFinish?: string | null;
  /** The exact printing to open on (a `?card=...&v=` link, App Spec §5.3);
   * wins over initialFinish when the card carries it. */
  initialVariantId?: number | null;
  /** card_popup_opened's `source` (App Spec §22) -- which surface opened this
   * popup instance. Optional, defaulting to "table"; CardsPage (the only
   * production caller) always passes it explicitly. */
  source?: "table" | "gallery" | "deck_check" | "new_arrivals" | "link";
  /** True while a shell dialog is open over the popup (App.tsx: the sign-in
   * dialog, e.g. a `?card=...&signup=1` boot). Escape and the arrow keys then
   * belong to that dialog: the popup's own handlers are detached, so one
   * Escape closes only the dialog on top. */
  keysSuspended?: boolean;
}

export function CardPopup({
  baseCardId,
  isAuthenticated,
  readOnly = false,
  quantityOverrides,
  setNameByCode,
  onClose,
  onChanged,
  onRequestSignIn,
  navigation,
  initialFinish,
  initialVariantId = null,
  source = "table",
  keysSuspended = false,
}: Props) {
  const { limits, capMode } = useLimits();
  const [detail, setDetail] = useState<BaseCardDetail | null>(null);
  const [variants, setVariants] = useState<VariantDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  // The rail header's Market/Low toggle -- which price KIND each printing row
  // shows. Applies to every row uniformly; there's no per-row override.
  const [priceMode, setPriceMode] = useState<PriceRailMode>("market");
  // Whether the FULL history panel is expanded below the popup's grid. The
  // COMPACT panel is always mounted (while a printing is selected) and needs
  // no state of its own -- it just tracks selectedVariant directly.
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.variant_id === selectedVariantId) ?? pickRepresentative(variants),
    [variants, selectedVariantId]
  );
  // The flip and image-morph state (useCardFlip.ts). `resetFlip` returns to
  // the front face with no flip in flight and the aspects unknown.
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const flip = useCardFlip(selectedVariant, imageWrapRef);
  const resetFlip = flip.reset;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getBaseCardDetail(baseCardId)
      .then((data) => {
        if (cancelled) return;
        const displayVariants = quantityOverrides
          ? data.variants.map((v) => ({
              ...v,
              quantity: quantityOverrides[v.variant_id] ?? 0,
            }))
          : data.variants;
        capture("card_popup_opened", { source, set_code: data.set_code });
        setDetail(data);
        setVariants(displayVariants);
        setSelectedVariantId(
          pickInitialVariant(displayVariants, initialFinish, initialVariantId)?.variant_id ?? null
        );
        // A different base card (and even a different printing of the same
        // card -- see selectVariant below) can have different image geometry,
        // so stale aspects from the previous card must not leak into this
        // one's height morph.
        resetFlip();
        setLoading(false);
        // A different base card's history has nothing to do with whatever was
        // expanded for the previous one.
        setHistoryExpanded(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load card");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // initialFinish is read here for the scoped preselection above. The popup
    // is a modal (background interaction blocked), so this never re-fires
    // from a mid-session scope change on its own -- it rides along with the
    // SAME baseCardId-driven re-fetch that already runs on prev/next
    // navigation, resolving against whatever scope is current at that moment.
    // quantityOverrides joins the deps for the same ride-along reason: a
    // shared vault's quantities map is fetched once and stable, so this
    // re-fires only if that one fetch resolves while the popup is already
    // open -- exactly when the stale zeros SHOULD be replaced. `source` joins
    // the deps too -- CardsPage always sets it in the same call as baseCardId
    // (see openPopup), so in practice it never changes independently, but the
    // capture() call above does read it. initialVariantId likewise: CardsPage
    // sets and clears it in the same update as baseCardId. resetFlip is a
    // stable callback.
  }, [baseCardId, initialFinish, initialVariantId, quantityOverrides, source, resetFlip]);

  const close = useCallback(() => {
    if (changed) onChanged?.();
    onClose();
  }, [changed, onChanged, onClose]);

  // Escape-key dismissal via the shared hook. History-first routing: with the
  // FULL history panel expanded, Escape collapses it back to compact-only; the
  // popup itself only closes on a second Escape. The full panel is an embedded
  // expand-below section, not a stacked overlay, so the target is a boolean
  // collapse. Backdrop-click dismiss reuses the same target-equality pattern
  // AddCardsModal uses -- see useModalDismiss's docstring.
  const onEscape = useCallback(() => {
    if (historyExpanded) {
      setHistoryExpanded(false);
    } else {
      close();
    }
  }, [historyExpanded, close]);
  const { handleBackdropMouseDown } = useModalDismiss(onEscape, {
    onBackdropClick: close,
    enabled: !keysSuspended,
  });

  // Prev/next browsing via ArrowLeft/ArrowRight (guarded against typing
  // targets, no-op with no navigation context) -- see CardPopupNav.tsx's
  // useArrowKeyNavigation doc comment.
  useArrowKeyNavigation(keysSuspended ? undefined : navigation);

  const selectVariant = useCallback(
    (variantId: number) => {
      setSelectedVariantId(variantId);
      // Different printings can have different image geometry (scan quality,
      // crop) even for the same card -- stale aspects would morph toward the
      // WRONG target height for a beat until the newly selected printing's
      // image(s) load and overwrite them.
      resetFlip();
    },
    [resetFlip]
  );

  // Up/down arrows cycle the rail selection -- routed through the SAME
  // selectVariant used by a rail click (never setSelectedVariantId directly),
  // so a keyboard cycle triggers everything a click does (image swap,
  // per-variant quantity state, price-history re-fetch, and the flip/aspect
  // reset above). orderVariants here is the identical ordering rule
  // CardPopupRail renders (cardPopupShared.ts), so "down" always means the
  // same "next row" the rail shows -- kept as its own memo (rather than
  // reading CardPopupRail's internal one) since the rail only renders once
  // `detail` has resolved, but this hook must stay wired even while loading.
  const orderedVariantIds = useMemo(
    () => (detail ? orderVariants(variants, detail.set_code).map((v) => v.variant_id) : []),
    [variants, detail]
  );
  // Keyboard-only scrollIntoView -- a rail click never needs it (the user is
  // already looking at the row they clicked). Looked up by the data-variant-id
  // attribute rather than waiting for the next render's
  // `.cp-rail__item--active` class, since the target row's DOM node already
  // exists (every printing renders at once; only the active class moves) --
  // no need to wait on the setSelectedVariantId re-render.
  const selectVariantViaKeyboard = useCallback(
    (variantId: number) => {
      selectVariant(variantId);
      const row = document.querySelector<HTMLElement>(
        `.cp-rail__item[data-variant-id="${variantId}"]`
      );
      row?.scrollIntoView({ block: "nearest" });
    },
    [selectVariant]
  );
  const variantCycleContext: VariantCycleContext | undefined =
    orderedVariantIds.length > 0
      ? { orderedVariantIds, selectedVariantId, onSelect: selectVariantViaKeyboard }
      : undefined;
  useVariantCycleKeys(variantCycleContext);

  const typeCategory = typeCategoryOf(detail?.type ?? "Unit");

  const { pending, mutationError, handleIncrement, handleDecrement } = useInventoryMutation(
    selectedVariant,
    setVariants,
    setChanged
  );

  return (
    <>
      <div className="cp-overlay modal-overlay" onMouseDown={handleBackdropMouseDown}>
        <div className="cp-shell">
          <div className="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-title">
            {loading && <div className="cp-status">Loading…</div>}
            {!loading && error && <div className="cp-status cp-status--error">{error}</div>}
            {!loading && !error && detail && selectedVariant && (
              <CardPopupView
                baseCardId={baseCardId}
                detail={detail}
                variants={variants}
                selectedVariant={selectedVariant}
                setNameByCode={setNameByCode}
                isAuthenticated={isAuthenticated}
                priceMode={priceMode}
                onPriceModeChange={setPriceMode}
                onSelectVariant={selectVariant}
                onExpandHistory={() => setHistoryExpanded(true)}
                flip={flip}
                imageWrapRef={imageWrapRef}
                headerControls={
                  <div className="cp-header__controls">
                    {navigation && <CardPopupNavButtons navigation={navigation} />}
                    {!detail.is_token && (
                      <CardPopupLinkButton url={cardPageUrl(detail, selectedVariant)} />
                    )}
                    <button type="button" className="cp-close" onClick={close} aria-label="Close">
                      ×
                    </button>
                  </div>
                }
                notice={
                  mutationError && (
                    <div className="cp-status cp-status--error cp-mutation-error">
                      {mutationError}
                    </div>
                  )
                }
                inventorySlot={
                  <CardPopupInventoryControls
                    isAuthenticated={isAuthenticated}
                    readOnly={readOnly}
                    variant={selectedVariant}
                    typeCategory={typeCategory}
                    limits={limits}
                    capMode={capMode}
                    pending={pending}
                    onIncrement={handleIncrement}
                    onDecrement={handleDecrement}
                    onRequestSignIn={onRequestSignIn}
                  />
                }
                afterBody={
                  // The FULL history panel appends BELOW the popup's 3-column
                  // grid (inside the modal's own scroll region) when the
                  // compact panel's expand affordance is used. Never an
                  // overlay; closing it (× or Escape) returns to compact-only,
                  // see the Escape-routing effect above.
                  historyExpanded && (
                    <CardPopupExpandedHistory
                      baseCardId={baseCardId}
                      variant={selectedVariant}
                      onClose={() => setHistoryExpanded(false)}
                    />
                  )
                }
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
