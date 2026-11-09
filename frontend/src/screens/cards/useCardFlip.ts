import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { RefObject, SyntheticEvent } from "react";
import type { VariantDetail } from "../../api/baseCards";
import { cardImageProps } from "../../utils/cardImages";
import type { CardImageProps } from "../../utils/cardImages";

/** The popup's image column state: the two-phase leader flip, the
 * orientation morph's measured aspects and column width, and the image the
 * column shows. Used by CardPopup.tsx (the app's container) and by the public
 * card page (src/public), which both render CardPopupView with it.
 *
 * `imageMode` "app" is the popup's own image: the "large" slot (a 640 /
 * original density pair) with the stored-CDN-URL fallback on error. "fixed320"
 * is the public page's: the 320 px same-origin rendition only, no srcset and
 * no fallback to the official CDN (design note §5a, parts C and "no
 * hotlinking"). */
export type CardImageMode = "app" | "fixed320";

/** The popup's image column runs ~340px wide -- see cardImages.ts's slot doc
 * for why "large" (a 640/original density pair) beats width-descriptor
 * "thumb" candidates at that size. */
const CP_IMAGE_SLOT = "large" as const;

function imagePropsFor(
  variant: VariantDetail,
  back: boolean,
  mode: CardImageMode
): CardImageProps | null {
  const images = back ? variant.back_images : variant.front_images;
  const url = back ? variant.back_image_url : variant.front_image_url;
  if (mode === "fixed320") return images?.w320 ? { src: images.w320 } : null;
  return cardImageProps(images, url, CP_IMAGE_SLOT);
}

export interface CardFlip {
  showBack: boolean;
  flipPhase: "out" | "in" | null;
  canFlip: boolean;
  displayedImages: CardImageProps | null;
  /** Explicit image height during the leader morph; null = CSS auto. */
  flipHeight: number | null;
  /** The shown (or flipping-to) side's width / height, once loaded: the
   * popup caps the image's width by it so a short window scales the image
   * down instead of scrolling the column (CardPopup.css .cp-image-wrap). */
  imageAspect: number | null;
  onFlipClick: () => void;
  onFlipAnimationEnd: () => void;
  onImageLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
  /** Back to the front face, no flip in flight, aspects unknown (a new card
   * or a new printing can have different image geometry). */
  reset: () => void;
}

export function useCardFlip(
  selectedVariant: VariantDetail | null,
  /** The view's `.cp-image-wrap`, measured for the morph. Owned by the
   * container and passed to the view on its own (not inside the returned
   * state), so the state is plain render data. */
  imageWrapRef: RefObject<HTMLDivElement | null>,
  imageMode: CardImageMode = "app"
): CardFlip {
  const [showBack, setShowBack] = useState(false);
  // Two-phase flip -- "out" rotates the CURRENTLY-shown side from 0deg to
  // 90deg (edge-on), then at that animationend the data swap (setShowBack,
  // below) happens and "in" takes over, rotating 90deg back to 0deg to reveal
  // the new side, so the viewer sees the old face fold away instead of the
  // new face already flipped in. Two keyframe animations driven by
  // onAnimationEnd (not a setTimeout guessed to match the CSS duration) make
  // the swap land deterministically at the midpoint. Never resting or
  // animating past 90deg preserves the no-mirror guarantee -- there's no real
  // "back face" to a flat <img>, so nothing ever rotates through the mirrored
  // zone.
  const [flipPhase, setFlipPhase] = useState<"out" | "in" | null>(null);

  // Leader flip orientation morph. Leader backs are landscape while fronts
  // are portrait, so without a morph the image's rendered height would snap
  // instantly to the new side's aspect at the flip's midpoint (where `src`
  // swaps, see flipPhase's doc comment above). `frontAspect`/`backAspect`
  // store each side's natural width/height RATIO (a single number, not the raw
  // pixel dimensions) so the height math below stays a one-line divide;
  // `imageWrapWidth` is the column's measured pixel width, since aspect alone
  // can't produce a height without it. All three are null until measured,
  // which is also the "don't know yet" state that falls back to CSS
  // auto-height (see the inline style in CardPopupView).
  const [frontAspect, setFrontAspect] = useState<number | null>(null);
  const [backAspect, setBackAspect] = useState<number | null>(null);
  const [imageWrapWidth, setImageWrapWidth] = useState<number | null>(null);

  const reset = useCallback(() => {
    setShowBack(false);
    setFlipPhase(null);
    setFrontAspect(null);
    setBackAspect(null);
  }, []);

  /** Kicks off the "out" half of the flip; ignored while a flip is already in
   * flight so rapid clicks can't desync the phase machine from the visible
   * animation. */
  const onFlipClick = useCallback(() => {
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
  const onFlipAnimationEnd = useCallback(() => {
    if (flipPhase === "out") {
      setShowBack((b) => !b);
      setFlipPhase("in");
    } else if (flipPhase === "in") {
      setFlipPhase(null);
    }
  }, [flipPhase]);

  const displayedImages = selectedVariant
    ? imagePropsFor(selectedVariant, showBack, imageMode)
    : null;

  const canFlip = !!(selectedVariant?.front_image_url && selectedVariant?.back_image_url);
  const hasDisplayedImage = displayedImages != null;

  /** The back image's resolved <img> src, memoized so the preload effect below
   * can key on a STRING rather than `selectedVariant` itself.
   * `selectedVariant` gets a brand-new object identity on every quantity +/-
   * click (handleIncrement/handleDecrement's setVariants maps to new objects
   * for ALL variants, including the one that didn't change) -- an effect
   * dependent on that object would re-run (and re-fetch the same image) on
   * every stepper click. The src string itself is stable across those
   * re-renders, so depending on it instead makes the preload fire only when
   * the actual image changes (variant selection or base card change). Gated
   * on `canFlip` -- there is nothing to preload for a card with no back. */
  const backImageSrc = useMemo(() => {
    if (!canFlip || !selectedVariant) return null;
    return imagePropsFor(selectedVariant, true, imageMode)?.src ?? null;
  }, [canFlip, selectedVariant, imageMode]);

  /** Warms the browser's image cache for the back side AND captures its aspect
   * ratio ahead of the flip, using a detached `new Image()` rather than
   * waiting for the visible <img>'s own onLoad (which only fires once
   * `showBack` actually flips `src` to this URL -- too late to have the target
   * height ready when the morph transition starts). Keyed on the src STRING
   * (see backImageSrc's doc comment) so it doesn't re-fire on every
   * quantity-stepper click. `cancelled` guards against a stale response
   * landing after a fast base-card/printing change has already moved on to a
   * different backImageSrc. */
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

  /** Measures `.cp-image-wrap`'s rendered width so the height morph (width /
   * aspect) has a pixel width to work with -- aspect ratio alone can't
   * produce a height. Re-runs when the wrap first mounts (it doesn't exist yet
   * while the popup is loading) and on every window resize;
   * `hasDisplayedImage` as the dependency (rather than an empty array) is what
   * catches that first-mount case, since a useLayoutEffect with no dependency
   * on the image column's presence would run before the ref is ever attached.
   * (Extracted to its own boolean, rather than an inline `!!displayedImages`
   * in the deps array, purely so eslint's exhaustive-deps rule can statically
   * verify it -- it can't reason about arbitrary inline expressions.) Effects
   * never run during server rendering, so the public page's prerender never
   * reaches `window`. */
  useLayoutEffect(() => {
    const measure = () => {
      const w = imageWrapRef.current?.clientWidth;
      setImageWrapWidth(w && w > 0 ? w : null);
    };
    measure();
    window.addEventListener("resize", measure);
    // The wrap's width also follows the window's height and the image's
    // aspect (the short-window cap): watch the box itself too.
    const el = imageWrapRef.current;
    const ro = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (el) ro?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [hasDisplayedImage, imageWrapRef]);

  /** Captures the currently-visible <img>'s aspect from its own onLoad. In
   * practice this only ever observes the FRONT side loading -- the back side
   * is warmed separately by the effect above (it isn't in the DOM until the
   * flip's data swap actually points `src` at it), and a printing change
   * always resets `showBack` to false, so this element never starts out
   * already showing the back. Still branches on `showBack` rather than
   * writing to `frontAspect` unconditionally: the visible <img> IS whichever
   * side is currently selected, so keying off that flag is the correct
   * general rule and stays correct even if the back side becomes reachable
   * through this same onLoad path. */
  const onImageLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (!img.naturalWidth || !img.naturalHeight) return;
      const aspect = img.naturalWidth / img.naturalHeight;
      if (showBack) setBackAspect(aspect);
      else setFrontAspect(aspect);
    },
    [showBack]
  );

  // `flipPhase === "out"` means the flip has started but the data swap
  // (setShowBack, in onFlipAnimationEnd) hasn't landed yet -- so the side
  // the morph should be heading TOWARD is the opposite of `showBack` during
  // "out", and `showBack` itself once "in" takes over (by which point
  // showBack already reflects the new side). This makes the height start
  // interpolating the instant the flip begins, rather than snapping only
  // after the swap -- the whole point of spreading the CSS transition across
  // both phases (0.36s = 0.18s + 0.18s, see .cp-image-flip's transition in
  // CardPopup.css).
  const targetShowsBack = flipPhase === "out" ? !showBack : showBack;
  const targetAspect = targetShowsBack ? backAspect : frontAspect;
  // Explicit height only once both the wrap's width and the target side's
  // aspect are known; otherwise no inline style at all, which falls back to
  // the element's natural CSS height (auto) -- also what jsdom tests see
  // (jsdom never fires a real image decode, so aspect stays null and this
  // path is exercised by default).
  const flipHeight =
    imageWrapWidth != null && targetAspect != null
      ? Math.round(imageWrapWidth / targetAspect)
      : null;

  return {
    showBack,
    flipPhase,
    canFlip,
    displayedImages,
    flipHeight,
    imageAspect: targetAspect,
    onFlipClick,
    onFlipAnimationEnd,
    onImageLoad,
    reset,
  };
}
