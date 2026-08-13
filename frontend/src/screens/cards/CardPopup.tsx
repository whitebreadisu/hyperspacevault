import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getBaseCardDetail } from "../../api/baseCards";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";
import { useLimits } from "../../context/LimitsContext";
import { typeCategoryOf } from "../../utils/limits";
import { cardImageProps } from "../../utils/cardImages";
import { AspectIcon } from "../../components/AspectIcon";
import { StatBadge } from "../../components/StatBadge";
import { SectionSeparator } from "../../components/SectionSeparator";
import { RarityBadge } from "../../components/RarityBadge";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { CardPopupRail, type PriceRailMode } from "./CardPopupRail";
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
import "./CardPopup.css";

export type { CardPopupNavigation };

/** BL-155 decomposition (2026-07-26): this file was previously a single
 * ~1,100-line, 31-hook monolith. Split along its natural seams into:
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
 * This file remains the composition shell: data fetching, the flip/image
 * measurement state (BL-132 J3), the header, and the (unnamed-seam) info
 * column. Zero intended behavior change -- see the PR description's
 * disposition log. */

/** BL-111 F5 (design handoff §5, "selected-panel"): ONE modal replacing both
 * the old CardDetailPopup and CardInventoryPopup -- a printings picker (left)
 * that selects a printing, a card image + inventory stepper for that
 * printing (center), and read-only card info (right). The image column runs
 * ~340px wide -- see cardImages.ts's slot doc for why "large" (a 640/original
 * density pair) beats width-descriptor "thumb" candidates at that size. */
const CP_IMAGE_SLOT = "large" as const;

/** Base-set codes with shipped starfield art (public/images/starfields/,
 * CLAUDE.md's Set Codes table) -- the same fixed roster the app-header's ASH
 * starfield assumes. Any other source_set_code (Weekly Play, Judge,
 * Convention, etc. container sets) has no art. */
const STARFIELD_SET_CODES = new Set([
  "SOR",
  "SHD",
  "TWI",
  "JTL",
  "LOF",
  "SEC",
  "LAW",
  "ASH",
  "IBH",
]);

/** Logo roster (public/images/set_*.png) = starfield roster + TS26, whose
 * owner-supplied logo landed with BL-166 while its starfield doesn't exist
 * yet -- the two asset classes are no longer the same set list.
 * AddCardsSetBar's SetMark renders from this roster ungated. */
const LOGO_SET_CODES = new Set([...STARFIELD_SET_CODES, "TS26"]);

function setLogoSrc(code: string): string | null {
  return LOGO_SET_CODES.has(code) ? `/images/set_${code}.png` : null;
}

function starfieldSrc(code: string): string | null {
  return STARFIELD_SET_CODES.has(code) ? `/images/starfields/starfield_${code}.jpg` : null;
}

/** Default the initial/displayed-on-load selection to the Standard printing
 * (same representative rule used everywhere else a "the" card image/variant
 * is needed -- CardsTable's VariantInventory, GalleryGrid's cellImage). */
function pickRepresentative(variants: VariantDetail[]): VariantDetail | null {
  if (variants.length === 0) return null;
  return variants.find((v) => v.finish === "Standard") ?? variants[0];
}

/** BL-193: when the Vault's variant scope (BL-173) is active, the popup
 * should open on the SAME finish the collector is scoped to -- the whole
 * click-through path (table row -> popup) stays in their chosen finish
 * (companion to BL-187's scoped number/sort and BL-192's rail cycling).
 * Uses the codebase-universal `(v.finish ?? v.variant_type) === scope` rule
 * (utils/variantScope.ts) and the same find-FIRST-match caveat as
 * scopedOwnedCount/scopedCardNumber -- normally exactly one variant carries
 * a given raw finish. Falls back to pickRepresentative when there's no scope
 * or the card carries no printing of the scoped finish (mid-session edge;
 * filtered rows normally all match). */
function pickInitialVariant(
  variants: VariantDetail[],
  initialFinish: string | null | undefined
): VariantDetail | null {
  if (initialFinish != null) {
    const scoped = variants.find((v) => (v.finish ?? v.variant_type) === initialFinish);
    if (scoped) return scoped;
  }
  return pickRepresentative(variants);
}

/** Canonical aspect display order (shared with FilterPanel's ASPECT_LIST /
 * the old CardDetailPopup) plus the header-glow color for each (design
 * handoff §5 mock: card-text section headers tint to the card's primary
 * aspect). Command's color doubles as the app's existing --aspect-command
 * token value, kept as a literal here since this map covers all 6 aspects,
 * not just Command. */
const ASPECT_ORDER = ["Vigilance", "Command", "Aggression", "Cunning", "Heroism", "Villainy"];
const ASPECT_GLOW: Record<string, string> = {
  Vigilance: "#3ea0d6",
  Command: "#178a3a",
  Aggression: "#c02b30",
  Cunning: "#e2a33c",
  Heroism: "#d8d3c3",
  Villainy: "#7c3aed",
};

function orderAspects(aspects: string[]): string[] {
  return [...aspects].sort((a, b) => {
    const ai = ASPECT_ORDER.indexOf(a);
    const bi = ASPECT_ORDER.indexOf(b);
    return (ai === -1 ? ASPECT_ORDER.length : ai) - (bi === -1 ? ASPECT_ORDER.length : bi);
  });
}

interface Props {
  baseCardId: number;
  isAuthenticated: boolean;
  /** BL-205: true for a shared-vault viewer -- see
   * CardPopupInventory's InventoryPlate `readOnly` doc comment for what it
   * changes (the stepper's -/+ buttons are removed, not disabled). Only
   * meaningful together with `isAuthenticated=true` (CardsPage's
   * `hasData`); defaults false so every existing caller renders unchanged. */
  readOnly?: boolean;
  /** BL-205 (owner HMR round 1): per-variant quantities to display INSTEAD
   * of the detail response's. The detail endpoint (get_optional_db) embeds
   * quantities for the CALLER's auth context, which in a shared vault is
   * the wrong tenant twice over -- zeros for an anonymous viewer, and the
   * viewer's OWN counts for a signed-in one. CardsPage already holds the
   * share owner's full quantities map (the /api/shared/{token}/quantities
   * rows the table renders from), so viewer-mode passes it down and the
   * popup trusts it over the response. Undefined = normal owner/anonymous
   * behavior, response quantities untouched. */
  quantityOverrides?: Record<number, number>;
  /** code -> full set name, built from getSets() -- already fetched by
   * CardsPage for VariantsTooltip, reused here rather than re-fetching. */
  setNameByCode: Record<string, string>;
  onClose: () => void;
  onChanged?: () => void;
  /** BL-56 §5.5's inert-teaser pattern: opens the shell's AuthModal. The
   * signed-out inventory plate's "Sign in" button routes through this. */
  onRequestSignIn?: () => void;
  /** BL-148: see CardPopupNavigation above. Optional so every existing
   * caller/test that doesn't wire it keeps working unchanged -- the popup
   * itself doesn't know or care whether it was opened from a list. */
  navigation?: CardPopupNavigation;
  /** BL-193: the Vault's active variant scope (CardsPage's `scope` state,
   * BL-173), a raw finish string or null. When set, the popup's initial
   * selection on EVERY detail fetch (including prev/next navigation between
   * cards) prefers the variant matching this finish over pickRepresentative
   * -- see pickInitialVariant above. Optional/undefined behaves exactly like
   * null (no scope) so every existing caller/test keeps working unchanged. */
  initialFinish?: string | null;
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
}: Props) {
  const { limits, capMode } = useLimits();
  const [detail, setDetail] = useState<BaseCardDetail | null>(null);
  const [variants, setVariants] = useState<VariantDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [showBack, setShowBack] = useState(false);
  // BL-111 dev-review wave 1 fix 2: two-phase flip -- "out" rotates the
  // CURRENTLY-shown side from 0deg to 90deg (edge-on), then at that
  // animationend the data swap (setShowBack, below) happens and "in" takes
  // over, rotating 90deg back to 0deg to reveal the new side. The old
  // implementation swapped `src` synchronously on click and only *then*
  // played a single 0->90->0 pulse, so the viewer never saw the old face
  // fold away -- the new face was already flipped-in from the first frame.
  // Splitting into two keyframe animations driven by onAnimationEnd (not a
  // setTimeout guessed to match the CSS duration) makes the swap land
  // deterministically at the midpoint. Never resting or animating past
  // 90deg preserves the no-mirror guarantee the original pulse relied on --
  // there's no real "back face" to a flat <img>, so nothing ever rotates
  // through the mirrored zone.
  const [flipPhase, setFlipPhase] = useState<"out" | "in" | null>(null);
  const [changed, setChanged] = useState(false);
  // BL-140 design-conformance pass: the rail header's Market/Low toggle --
  // which price KIND each printing row shows (not the retired PriceBlock's
  // Market/Cheapest deck-cost concept). Applies to every row uniformly;
  // there's no per-row override.
  const [priceMode, setPriceMode] = useState<PriceRailMode>("market");
  // Whether the FULL history panel is expanded below the popup's grid. The
  // COMPACT panel is always mounted (while a printing is selected) and needs
  // no state of its own -- it just tracks selectedVariant directly.
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // BL-132 J3: leader flip orientation morph. Leader backs are landscape
  // while fronts are portrait, so at the flip's midpoint (where `src` swaps,
  // see flipPhase's doc comment above) the image's rendered height used to
  // snap instantly to the new side's aspect -- the "blip" this fixes.
  // `frontAspect`/`backAspect` store each side's natural width/height RATIO
  // (a single number, not the raw pixel dimensions) so the height math below
  // stays a one-line divide; `imageWrapWidth` is the column's measured pixel
  // width, since aspect alone can't produce a height without it. All three
  // are null until measured, which is also the "don't know yet" state that
  // falls back to CSS auto-height (see the inline style below).
  const [frontAspect, setFrontAspect] = useState<number | null>(null);
  const [backAspect, setBackAspect] = useState<number | null>(null);
  const [imageWrapWidth, setImageWrapWidth] = useState<number | null>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);

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
        setDetail(data);
        setVariants(displayVariants);
        setSelectedVariantId(
          pickInitialVariant(displayVariants, initialFinish)?.variant_id ?? null
        );
        setShowBack(false);
        setFlipPhase(null);
        // BL-132 J3: a different base card (and even a different printing of
        // the same card -- see selectVariant below) can have different image
        // geometry, so stale aspects from the previous card must not leak
        // into this one's height morph.
        setFrontAspect(null);
        setBackAspect(null);
        setLoading(false);
        // BL-140: a different base card's history has nothing to do with
        // whatever was expanded for the previous one.
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
    // BL-193: initialFinish is read here for the scoped preselection above.
    // In practice the popup is a modal (background interaction blocked), so
    // this never re-fires from a mid-session scope change on its own -- it
    // rides along with the SAME baseCardId-driven re-fetch that already runs
    // on prev/next navigation (BL-148), just resolving against whatever
    // scope is current at that moment. quantityOverrides (BL-205) joins the
    // deps for the same ride-along reason: a shared vault's quantities map
    // is fetched once and stable, so this re-fires only if that one fetch
    // resolves while the popup is already open -- exactly when the stale
    // zeros SHOULD be replaced.
  }, [baseCardId, initialFinish, quantityOverrides]);

  const close = useCallback(() => {
    if (changed) onChanged?.();
    onClose();
  }, [changed, onChanged, onClose]);

  // BL-153: Escape-key dismissal via the shared hook. History-first routing
  // is unchanged -- with the FULL history panel expanded, Escape collapses
  // it back to compact-only; the popup itself only closes on a second
  // Escape. Only the target changed (a boolean collapse instead of clearing
  // an overlay's variant) since the full panel is now an embedded
  // expand-below section, not a stacked overlay (BL-140 design-conformance
  // pass). Backdrop-click dismiss reuses the same target-equality pattern
  // AddCardsModal uses -- see useModalDismiss's docstring.
  const onEscape = useCallback(() => {
    if (historyExpanded) {
      setHistoryExpanded(false);
    } else {
      close();
    }
  }, [historyExpanded, close]);
  const { handleBackdropMouseDown } = useModalDismiss(onEscape, { onBackdropClick: close });

  // BL-148: prev/next browsing via ArrowLeft/ArrowRight (guarded against
  // typing targets, no-op with no navigation context) -- see
  // CardPopupNav.tsx's useArrowKeyNavigation doc comment.
  useArrowKeyNavigation(navigation);

  const selectVariant = useCallback((variantId: number) => {
    setSelectedVariantId(variantId);
    setShowBack(false);
    setFlipPhase(null);
    // BL-132 J3: different printings can have different image geometry
    // (scan quality, crop) even for the same card -- stale aspects would
    // morph toward the WRONG target height for a beat until the newly
    // selected printing's image(s) load and overwrite them.
    setFrontAspect(null);
    setBackAspect(null);
  }, []);

  // BL-192: up/down arrows cycle the rail selection -- routed through the
  // SAME selectVariant used by a rail click (never setSelectedVariantId
  // directly), so a keyboard cycle triggers everything a click does (image
  // swap, per-variant quantity state, price-history re-fetch, and the
  // flip/aspect reset above). orderVariants here is the identical ordering
  // rule CardPopupRail renders (cardPopupShared.ts), so "down" always means
  // the same "next row" the rail shows -- kept as its own memo (rather than
  // reading CardPopupRail's internal one) since the rail only renders once
  // `detail` has resolved, but this hook must stay wired even while loading.
  const orderedVariantIds = useMemo(
    () => (detail ? orderVariants(variants, detail.set_code).map((v) => v.variant_id) : []),
    [variants, detail]
  );
  // BL-192: keyboard-only scrollIntoView -- a rail click never needs it (the
  // user is already looking at the row they clicked). Looked up by the
  // BL-192 data-variant-id attribute rather than waiting for the next
  // render's `.cp-rail__item--active` class, since the target row's DOM
  // node already exists (every printing renders at once; only the active
  // class moves) -- no need to wait on the setSelectedVariantId re-render.
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

  /** BL-111 dev-review wave 1 fix 2: kicks off the "out" half of the flip;
   * ignored while a flip is already in flight so rapid clicks can't
   * desync the phase machine from the visible animation. */
  const handleFlipClick = useCallback(() => {
    setFlipPhase((phase) => phase ?? "out");
  }, []);

  /** Deterministic phase advance, driven by the CSS animation actually
   * finishing (onAnimationEnd) rather than a timer guessed to match its
   * duration -- see the flipPhase state's doc comment above.
   * Deliberately NOT built as `setFlipPhase((phase) => { setShowBack(...);
   * return ... })` -- React (in StrictMode dev builds) double-invokes an
   * updater function to verify it's pure, and a `setShowBack` call living
   * INSIDE that updater fires on both invocations, silently toggling twice
   * (net no-op) while `flipPhase` itself still advances correctly on its
   * single applied result -- exactly the swap-never-visibly-happens bug
   * this shape produces. Reading `flipPhase` from the closure and calling
   * both setters directly in the handler (a normal event handler, not a
   * render-phase updater) sidesteps that footgun entirely. */
  const handleFlipAnimationEnd = useCallback(() => {
    if (flipPhase === "out") {
      setShowBack((b) => !b);
      setFlipPhase("in");
    } else if (flipPhase === "in") {
      setFlipPhase(null);
    }
  }, [flipPhase]);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.variant_id === selectedVariantId) ?? pickRepresentative(variants),
    [variants, selectedVariantId]
  );

  const displayedImages = selectedVariant
    ? cardImageProps(
        showBack ? selectedVariant.back_images : selectedVariant.front_images,
        showBack ? selectedVariant.back_image_url : selectedVariant.front_image_url,
        CP_IMAGE_SLOT
      )
    : null;

  const canFlip = !!(selectedVariant?.front_image_url && selectedVariant?.back_image_url);
  const hasDisplayedImage = displayedImages != null;

  /** BL-132 J3: the back image's resolved <img> src, memoized so the preload
   * effect below can key on a STRING rather than `selectedVariant` itself.
   * `selectedVariant` gets a brand-new object identity on every quantity
   * +/- click (handleIncrement/handleDecrement's setVariants maps to new
   * objects for ALL variants, including the one that didn't change) -- an
   * effect dependent on that object would re-run (and re-fetch the same
   * image) on every stepper click. The src string itself is stable across
   * those re-renders, so depending on it instead makes the preload fire only
   * when the actual image changes (variant selection or base card change).
   * Gated on `canFlip` -- there is nothing to preload for a card with no
   * back. */
  const backImageSrc = useMemo(() => {
    if (!canFlip || !selectedVariant) return null;
    const backImageProps = cardImageProps(
      selectedVariant.back_images,
      selectedVariant.back_image_url,
      CP_IMAGE_SLOT
    );
    return backImageProps?.src ?? null;
  }, [canFlip, selectedVariant]);

  /** BL-132 J3: warms the browser's image cache for the back side AND
   * captures its aspect ratio ahead of the flip, using a detached `new
   * Image()` rather than waiting for the visible <img>'s own onLoad (which
   * only fires once `showBack` actually flips `src` to this URL -- too late
   * to have the target height ready when the morph transition starts). Keyed
   * on the src STRING (see backImageSrc's doc comment) so it doesn't re-fire
   * on every quantity-stepper click. `cancelled` guards against a stale
   * response landing after a fast base-card/printing change has already
   * moved on to a different backImageSrc. */
  useEffect(() => {
    if (!backImageSrc) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (!img.naturalWidth || !img.naturalHeight) return;
      setBackAspect(img.naturalWidth / img.naturalHeight);
    };
    img.src = backImageSrc;
    return () => {
      cancelled = true;
    };
  }, [backImageSrc]);

  /** BL-132 J3: measures `.cp-image-wrap`'s rendered width so the height
   * morph (width / aspect) has a pixel width to work with -- aspect ratio
   * alone can't produce a height. Re-runs when the wrap first mounts (it
   * doesn't exist yet while `loading` is true) and on every window resize;
   * `hasDisplayedImage` as the dependency (rather than an empty array) is
   * what catches that first-mount case, since a useLayoutEffect with no
   * dependency on the image column's presence would run before the ref is
   * ever attached. (Extracted to its own boolean, rather than an inline
   * `!!displayedImages` in the deps array, purely so eslint's
   * exhaustive-deps rule can statically verify it -- it can't reason about
   * arbitrary inline expressions.) */
  useLayoutEffect(() => {
    const measure = () => {
      const w = imageWrapRef.current?.clientWidth;
      setImageWrapWidth(w && w > 0 ? w : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hasDisplayedImage]);

  /** BL-132 J3: captures the currently-visible <img>'s aspect from its own
   * onLoad. In practice this only ever observes the FRONT side loading --
   * the back side is warmed separately by the effect above (it isn't in the
   * DOM until the flip's data swap actually points `src` at it), and
   * selectVariant always resets `showBack` to false, so this element never
   * starts out already showing the back. Still branches on `showBack` rather
   * than writing to `frontAspect` unconditionally: the visible <img> IS
   * whichever side is currently selected, so keying off that flag is the
   * correct general rule and stays correct even if some future change makes
   * the back side reachable through this same onLoad path. */
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (!img.naturalWidth || !img.naturalHeight) return;
      const aspect = img.naturalWidth / img.naturalHeight;
      if (showBack) setBackAspect(aspect);
      else setFrontAspect(aspect);
    },
    [showBack]
  );

  // BL-132 J3: `flipPhase === "out"` means the flip has started but the data
  // swap (setShowBack, in handleFlipAnimationEnd) hasn't landed yet -- so the
  // side the morph should be heading TOWARD is the opposite of `showBack`
  // during "out", and `showBack` itself once "in" takes over (by which point
  // showBack already reflects the new side). This makes the height start
  // interpolating the instant the flip begins, rather than snapping only
  // after the swap -- the whole point of spreading the CSS transition across
  // both phases (0.36s = 0.18s + 0.18s, see .cp-image-flip's transition in
  // CardPopup.css).
  const targetShowsBack = flipPhase === "out" ? !showBack : showBack;
  const targetAspect = targetShowsBack ? backAspect : frontAspect;
  // Explicit height only once both the wrap's width and the target side's
  // aspect are known; otherwise no inline style at all, which falls back to
  // the element's natural CSS height (auto) -- the pre-J3 behavior, and also
  // what jsdom tests see (jsdom never fires a real image decode, so aspect
  // stays null and this path is exercised by default).
  const flipHeight =
    imageWrapWidth != null && targetAspect != null
      ? Math.round(imageWrapWidth / targetAspect)
      : null;

  const typeCategory = typeCategoryOf(detail?.type ?? "Unit");

  const { pending, mutationError, handleIncrement, handleDecrement } = useInventoryMutation(
    selectedVariant,
    setVariants,
    setChanged
  );

  const headerArt = detail ? starfieldSrc(detail.set_code) : null;
  const isBaseSelected = !!(
    detail &&
    selectedVariant &&
    selectedVariant.source_set_code === detail.set_code
  );
  const setLogo = selectedVariant
    ? (setLogoSrc(selectedVariant.source_set_code) ?? (detail ? setLogoSrc(detail.set_code) : null))
    : null;
  const setDisplayName =
    selectedVariant && detail
      ? isBaseSelected
        ? "Base set"
        : (setNameByCode[selectedVariant.source_set_code] ?? selectedVariant.source_set_code)
      : "";

  const aspects = detail ? orderAspects(detail.aspects) : [];
  const glow = aspects.length ? (ASPECT_GLOW[aspects[0]] ?? "#2563eb") : "#2563eb";
  const hasBackText = !!(detail?.double_sided && detail?.back_text);

  return (
    <>
      <div className="cp-overlay modal-overlay" onMouseDown={handleBackdropMouseDown}>
        <div className="cp-shell">
          <div className="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-title">
            {loading && <div className="cp-status">Loading…</div>}
            {!loading && error && <div className="cp-status cp-status--error">{error}</div>}
            {!loading && !error && detail && selectedVariant && (
              <>
                <div className="cp-header">
                  {headerArt && (
                    <div
                      className="cp-header__art"
                      style={{
                        backgroundImage: `linear-gradient(90deg, rgba(9, 11, 20, 0.62), rgba(9, 11, 20, 0.28)), url(${headerArt})`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="cp-header__row">
                    <h2 className="cp-title" id="cp-title">
                      {detail.name}
                    </h2>
                    {detail.subtitle && <div className="cp-subtitle">{detail.subtitle}</div>}
                    {setLogo && (
                      <img
                        className="cp-header__setlogo"
                        src={setLogo}
                        alt={`${detail.set_code} logo`}
                      />
                    )}
                  </div>
                  {/* BL-148: prev/next nav flanks the close button in one
                    absolutely-positioned cluster -- see CardPopupNav.tsx's
                    CardPopupNavButtons doc comment. */}
                  <div className="cp-header__controls">
                    {navigation && <CardPopupNavButtons navigation={navigation} />}
                    <button type="button" className="cp-close" onClick={close} aria-label="Close">
                      ×
                    </button>
                  </div>
                </div>

                <SectionSeparator className="cp-separator" />

                {mutationError && (
                  <div className="cp-status cp-status--error cp-mutation-error">
                    {mutationError}
                  </div>
                )}

                <div className="cp-body">
                  <CardPopupRail
                    baseCardId={baseCardId}
                    variants={variants}
                    baseSetCode={detail.set_code}
                    setNameByCode={setNameByCode}
                    selectedVariant={selectedVariant}
                    isAuthenticated={isAuthenticated}
                    priceMode={priceMode}
                    onPriceModeChange={setPriceMode}
                    onSelectVariant={selectVariant}
                    onExpandHistory={() => setHistoryExpanded(true)}
                  />

                  <div className="cp-center">
                    {displayedImages && (
                      <div className="cp-image-wrap" ref={imageWrapRef}>
                        {/* BL-111 F5 / dev-review wave 1 fix 2: a flat <img>
                          literally rotated to rest at rotateY(180deg) would
                          render mirrored (there's no real "back face" -- it's
                          the same plane seen from behind), so the transform
                          never rests or animates past 90deg. Two-phase flip:
                          `cp-image-flip--out` rotates the CURRENT side from
                          0deg to 90deg; its animationend (handleFlipAnimationEnd)
                          swaps `showBack` -- so `src` above only changes once
                          the image is edge-on and invisible -- then switches to
                          `cp-image-flip--in`, which rotates 90deg back to 0deg
                          to reveal the NEW side. The viewer watches the old
                          face fold away and only ever sees the new face as it
                          unfolds, never a mid-flight swap.

                          BL-132 J3: leader backs are landscape while fronts
                          are portrait, so the OLD behavior let this element's
                          height snap instantly the moment `src` swapped
                          mid-flip -- the "blip" this fixes. `flipHeight`
                          (computed above from imageWrapWidth/targetAspect)
                          drives an inline height that CSS transitions
                          smoothly across the full 0.36s flip instead; when
                          either input isn't known yet (aspect not measured,
                          or a non-flippable/non-leader card that never needs
                          this) there's no inline style at all and the
                          element just falls back to its natural CSS height,
                          identical to pre-J3 behavior.

                          Known nuance (dev-review flag, not fixed here): with
                          `overflow: hidden` now on this element (needed so a
                          mid-morph height doesn't clip through to reveal
                          image content past the rotated edge), the rotateY
                          perspective bulge can clip a few px at the very top/
                          bottom mid-flip. Minor and only visible mid-
                          animation; revisit if Jeremy flags it on dev. */}
                        <div
                          className={`cp-image-flip${flipPhase ? ` cp-image-flip--${flipPhase}` : ""}`}
                          onAnimationEnd={handleFlipAnimationEnd}
                          style={flipHeight != null ? { height: flipHeight } : undefined}
                        >
                          <img
                            className="cp-image"
                            src={displayedImages.src}
                            srcSet={displayedImages.srcSet}
                            onError={displayedImages.onError}
                            onLoad={handleImageLoad}
                            alt={`${detail.name}${detail.subtitle ? ` – ${detail.subtitle}` : ""}`}
                          />
                        </div>
                      </div>
                    )}
                    {canFlip && (
                      <button
                        type="button"
                        className="cp-flip"
                        disabled={flipPhase !== null}
                        onClick={handleFlipClick}
                      >
                        {showBack ? "Show front" : "Show back"}
                      </button>
                    )}
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
                  </div>

                  <div className="cp-info">
                    {/* Owner dev review 2026-07-26 round 2 (reference:
                        working/card popup rarity label change.JPG): the
                        rarity SYMBOL moves out of the meta line to a larger
                        icon anchored LEFT of the two-line set/rarity stack;
                        the colored label stays inline beside the card
                        number. */}
                    {/* BL-173 review round 4 (owner, 2026-07-27): the type +
                        aspect icons move INTO the set row, right-aligned --
                        type text LEFT of the aspect icons, icons sized to
                        the rarity icon's 34px height. The separate
                        .cp-info__aspects row is retired. */}
                    <div className="cp-info__set-row">
                      <RarityBadge rarity={detail.rarity} iconOnly size={34} />
                      <div className="cp-info__set-text">
                        <div className="cp-info__set-name">{setDisplayName}</div>
                        <div className="cp-info__meta">
                          <RarityBadge rarity={detail.rarity} labelOnly />
                          <span className="cp-info__cardnum">#{selectedVariant.card_number}</span>
                        </div>
                      </div>
                      <div className="cp-info__typeaspects">
                        <span className="cp-info__typeline">
                          {detail.type}
                          {detail.type2 ? ` · ${detail.type2}` : ""}
                        </span>
                        {/* Owner follow-up: sized to match the stat badges
                            (Cost/Power/HP render at 46 below), not the 34px
                            rarity icon. */}
                        {aspects.map((a) => (
                          <AspectIcon key={a} aspect={a} size={46} tooltip />
                        ))}
                      </div>
                    </div>

                    <div className="cp-text">
                      <div className="cp-text__inner">
                        {hasBackText && (
                          <div className="cp-text__header" style={{ color: glow }}>
                            {detail.type}
                          </div>
                        )}
                        {detail.front_text && <p className="cp-text__body">{detail.front_text}</p>}
                        {detail.epic_action && (
                          <p className="cp-text__body">
                            <span className="cp-text__epic-label">Epic Action: </span>
                            {detail.epic_action}
                          </p>
                        )}
                        {hasBackText && (
                          <div className="cp-text__back">
                            <div className="cp-text__header" style={{ color: glow }}>
                              {detail.type2 ?? "Back"}
                            </div>
                            <p className="cp-text__body">{detail.back_text}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* BL-132 J2: a null stat renders neither its badge nor its
                      label (an orphaned "COST" caption with nothing above it
                      would read as broken); if the card has none of the three
                      stats the whole strip disappears. Zero is a real value
                      and still renders. */}
                    {(detail.cost != null || detail.power != null || detail.hp != null) && (
                      <div className="cp-stats">
                        <div className="cp-stats__inner">
                          {detail.cost != null && (
                            <div className="cp-stats__item">
                              <StatBadge type="cost" value={detail.cost} size={46} />
                              <span className="cp-stats__label">COST</span>
                            </div>
                          )}
                          {detail.power != null && (
                            <div className="cp-stats__item">
                              <StatBadge type="power" value={detail.power} size={46} />
                              <span className="cp-stats__label">POWER</span>
                            </div>
                          )}
                          {detail.hp != null && (
                            <div className="cp-stats__item">
                              <StatBadge type="hp" value={detail.hp} size={46} />
                              <span className="cp-stats__label">HP</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="cp-facts">
                      {detail.keywords.length > 0 && (
                        <div className="cp-facts__row">
                          <span className="cp-facts__label">KEYWORDS</span>
                          <span>{detail.keywords.join(", ")}</span>
                        </div>
                      )}
                      {detail.traits.length > 0 && (
                        <div className="cp-facts__row">
                          <span className="cp-facts__label">TRAITS</span>
                          <span>{detail.traits.join(", ")}</span>
                        </div>
                      )}
                      {detail.arena != null && detail.arena !== "" && (
                        <div className="cp-facts__row">
                          <span className="cp-facts__label">ARENA</span>
                          <span>{detail.arena}</span>
                        </div>
                      )}
                    </div>

                    <div className="cp-artist">Artist — {detail.artist ?? "—"}</div>
                  </div>
                </div>

                {/* BL-140 design-conformance pass: historyEmbed=expand-below
                  -- the FULL history panel appends BELOW the popup's
                  3-column grid (inside the modal's own scroll region) when
                  the compact panel's ⤢ affordance is used. Never an overlay;
                  closing it (× or Escape) returns to compact-only, see the
                  Escape-routing effect above. */}
                {historyExpanded && (
                  <CardPopupExpandedHistory
                    baseCardId={baseCardId}
                    variant={selectedVariant}
                    onClose={() => setHistoryExpanded(false)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
