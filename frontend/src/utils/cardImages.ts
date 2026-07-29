import type { SyntheticEvent } from "react";
import type { ImageRenditions } from "../api/baseCards";

// BL-146 (Design_SparseList_2026-07-25.md §3): same-origin serving prefix,
// mirrors backend/app/services/image_paths.py's SERVE_PREFIX exactly.
const SERVE_PREFIX = "/images/";

/** Client-side port of backend/app/services/image_paths.py's derive_stem --
 * the CDN filename, extension and querystring stripped. Uses the WHATWG URL
 * parser's `.pathname`, which -- like Python's `urlparse(url).path` -- keeps
 * a doubled leading path separator intact (verified: both parse
 * "https://host.com//stem.png" to a path of "//stem.png", not "/stem.png"),
 * which matters because ADR-0012's dominant stored-URL form is
 * double-slash-origin (~29:1 over single-slash). Mirrors derive_stem's
 * `path.rsplit("/", 1)[-1]` then `rsplit(".", 1)[0] if "." in filename`
 * exactly: last path segment, then everything before its last dot. */
function deriveStem(url: string): string {
  const path = new URL(url).pathname;
  const segments = path.split("/");
  const filename = segments[segments.length - 1];
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? filename : filename.slice(0, dotIndex);
}

/** BL-146: client-side port of image_paths.py's object_paths/
 * same_origin_renditions -- computes the 3 same-origin serving URLs for one
 * side of a variant from its stored CDN URL, without a round trip through
 * the API. Exactly as correct as the server's derivation -- ADR-0012's own
 * amendment already established this as "read-time derivation...
 * deterministic and stateless by design" (0012-card-image-self-hosting.md),
 * so moving *where* it runs changes nothing about correctness. Used by
 * toInventoryCards (utils/inventory.ts) to populate list-row renditions now
 * that GET /api/base-cards no longer ships front_images/back_images at all
 * (Design_SparseList_2026-07-25.md §3's recommendation: derive, don't
 * relocate). See cardImages.test.ts for the fixture pinning this against
 * test_image_paths.py's exact-string assertions on the Python side. */
export function deriveRenditions(url: string): ImageRenditions {
  const stem = deriveStem(url);
  return {
    original: `${SERVE_PREFIX}cards/${stem}.png`,
    w640: `${SERVE_PREFIX}cards/${stem}_640.webp`,
    w320: `${SERVE_PREFIX}cards/${stem}_320.webp`,
  };
}

export interface CardImageProps {
  src: string;
  srcSet?: string;
  sizes?: string;
  /** One-shot last-resort fallback (BL-76 Phase 3 follow-up fix): swaps the
   * failing <img> to the stored CDN URL. See makeCardImageErrorHandler. */
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

/** Which shape of candidate set to build. "thumb" is the small-cell case
 * (gallery cells, the Add Cards preview) -- 320/640 width candidates so the
 * browser picks based on the slot's CSS size × device pixel ratio. "large"
 * is the popup case (the unified CardPopup, BL-111 F5) -- the rendered
 * slot is already ~640-wide, so width descriptors stop being useful there;
 * offering 640 (1x) and the full original (2x+) as a density switch lets a
 * high-DPR display pull the sharper source without guessing its exact
 * pixel width (renditions only guarantee resize-by-width, not a fixed
 * output size). */
export type CardImageSlot = "thumb" | "large";

/** Client-side last-resort image fallback (BL-76 Phase 3 follow-up fix).
 *
 * Why it exists: the backend's cache-miss 307 reconstructs the official CDN
 * URL from the stem alone, which is necessarily best-effort -- the CDN
 * treats `.com//<stem>.png` and `.com/<stem>.png` as distinct object keys,
 * ~277 of the ~8.3k stored URLs are single-slash-origin (concentrated in
 * SOR standard cards, the app's default view), and the stem cannot encode
 * which form is right (see image_paths.fallback_cdn_url's docstring). An
 * unmirrored single-slash image therefore chains 307 -> 403 -> a broken
 * <img>. The frontend, unlike the redirect, has the *stored* URL
 * (front_image_url/back_image_url), which is definitionally correct -- so
 * on error we swap the <img> to it directly.
 *
 * One swap only, no loops: the handler no-ops when the element's src
 * attribute is already the stored URL -- both when the swap itself fails
 * (second error event finds src === fallbackUrl and returns) and when
 * cardImageProps already used the stored URL as src (absent-renditions
 * path). srcSet/sizes are stripped before the swap, otherwise the browser
 * would keep preferring a srcset candidate over the new src.
 *
 * Compares via getAttribute("src") (the literal attribute) rather than
 * img.src (which the DOM absolutizes), so a same-origin rendition path
 * never false-positives against the absolute CDN fallback URL. */
export function makeCardImageErrorHandler(
  fallbackUrl: string
): (event: SyntheticEvent<HTMLImageElement>) => void {
  return (event) => {
    const img = event.currentTarget;
    if (img.getAttribute("src") === fallbackUrl) return; // already swapped (or started there)
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.setAttribute("src", fallbackUrl);
  };
}

/** Build <img> src/srcSet/sizes (+ the one-shot onError fallback above) for
 * one side of a variant (BL-76 Phase 3, ADR-0012). Prefers the derived
 * same-origin renditions; falls back to the plain hotlinked CDN URL when
 * they're absent -- e.g. a base-cards list response served from a stale CDN
 * cache entry from before this field existed (BL-101's public caching means
 * an old-shape response stays valid across this deploy, so every caller of
 * this util is safe against it by construction). Returns null when neither
 * is available for this side (e.g. back_image_url on a card with no back). */
export function cardImageProps(
  images: ImageRenditions | null | undefined,
  fallbackUrl: string | null,
  slot: CardImageSlot,
  sizes?: string
): CardImageProps | null {
  if (!images) {
    // src IS the stored URL here -- there is nothing further to fall back
    // to, so no onError (the handler would no-op against itself anyway).
    return fallbackUrl ? { src: fallbackUrl } : null;
  }
  const onError = fallbackUrl ? makeCardImageErrorHandler(fallbackUrl) : undefined;
  if (slot === "thumb") {
    return {
      src: images.w640,
      srcSet: `${images.w320} 320w, ${images.w640} 640w`,
      sizes,
      onError,
    };
  }
  return {
    src: images.w640,
    srcSet: `${images.w640} 1x, ${images.original} 2x`,
    onError,
  };
}
