import { describe, it, expect } from "vitest";
import type { SyntheticEvent } from "react";
import { cardImageProps, deriveRenditions, makeCardImageErrorHandler } from "./cardImages";
import type { ImageRenditions } from "../api/baseCards";

const RENDITIONS: ImageRenditions = {
  original: "/images/cards/card_test.png",
  w640: "/images/cards/card_test_640.webp",
  w320: "/images/cards/card_test_320.webp",
};

/** A real <img> wrapped in the minimal SyntheticEvent shape the handler
 * reads -- lets the swap behavior be asserted against actual DOM attribute
 * semantics (getAttribute/removeAttribute) instead of a hand-rolled stub. */
function makeImgEvent(attrs: { src: string; srcSet?: string; sizes?: string }): {
  img: HTMLImageElement;
  event: SyntheticEvent<HTMLImageElement>;
} {
  const img = document.createElement("img");
  img.setAttribute("src", attrs.src);
  if (attrs.srcSet) img.setAttribute("srcset", attrs.srcSet);
  if (attrs.sizes) img.setAttribute("sizes", attrs.sizes);
  return { img, event: { currentTarget: img } as SyntheticEvent<HTMLImageElement> };
}

describe("cardImageProps", () => {
  describe("thumb slot (renditions present)", () => {
    it("uses the 640 rendition as src and a 320/640 width srcset", () => {
      const props = cardImageProps(
        RENDITIONS,
        "https://cdn.example.com/hotlink.png",
        "thumb",
        "140px"
      );
      expect(props).toMatchObject({
        src: "/images/cards/card_test_640.webp",
        srcSet: "/images/cards/card_test_320.webp 320w, /images/cards/card_test_640.webp 640w",
        sizes: "140px",
      });
      // BL-76 follow-up fix: the one-shot stored-URL fallback rides along.
      expect(typeof props?.onError).toBe("function");
    });
  });

  describe("large slot (renditions present)", () => {
    it("uses the 640 rendition as src and a 640/original density srcset", () => {
      const props = cardImageProps(RENDITIONS, null, "large");
      expect(props).toMatchObject({
        src: "/images/cards/card_test_640.webp",
        srcSet: "/images/cards/card_test_640.webp 1x, /images/cards/card_test.png 2x",
      });
      // No stored URL -> nothing to fall back to -> no handler.
      expect(props?.onError).toBeUndefined();
    });

    it("attaches the onError fallback when a stored URL exists", () => {
      const props = cardImageProps(RENDITIONS, "https://cdn.example.com/hotlink.png", "large");
      expect(typeof props?.onError).toBe("function");
    });
  });

  describe("renditions absent (stale cached API response or genuinely no image)", () => {
    it("falls back to the plain hotlinked URL when one is present", () => {
      const props = cardImageProps(
        undefined,
        "https://cdn.example.com/hotlink.png",
        "thumb",
        "140px"
      );
      expect(props).toEqual({ src: "https://cdn.example.com/hotlink.png" });
      // src already IS the stored URL -- there is no further fallback.
      expect(props?.onError).toBeUndefined();
    });

    it("falls back the same way for a null (rather than undefined) images value", () => {
      const props = cardImageProps(null, "https://cdn.example.com/hotlink.png", "large");
      expect(props).toEqual({ src: "https://cdn.example.com/hotlink.png" });
    });

    it("returns null when neither renditions nor a fallback URL exist", () => {
      expect(cardImageProps(undefined, null, "thumb")).toBeNull();
      expect(cardImageProps(null, null, "large")).toBeNull();
    });
  });
});

// BL-146 (Design_SparseList_2026-07-25.md §3): deriveRenditions is a
// line-for-line port of backend/app/services/image_paths.py's
// object_paths/same_origin_renditions -- these cases mirror
// backend/app/tests/test_image_paths.py's exact-string assertions
// (test_derive_stem_and_object_paths_are_re_exported_and_still_correct,
// test_same_origin_renditions_shape) so a scheme change on either side
// (RENDITION_WIDTHS, WEBP_QUALITY, the _640.webp/_320.webp suffixes) fails
// this suite too, not just the Python one -- the drift-mitigation the
// design doc calls for.
describe("deriveRenditions (BL-146, mirrors backend test_image_paths.py)", () => {
  it("derives the same 3 same-origin URLs as the backend, double-slash-origin CDN URL", () => {
    const url = "https://cdn.starwarsunlimited.com//card_0801_abc123.png";
    expect(deriveRenditions(url)).toEqual({
      original: "/images/cards/card_0801_abc123.png",
      w640: "/images/cards/card_0801_abc123_640.webp",
      w320: "/images/cards/card_0801_abc123_320.webp",
    });
  });

  it("derives the same shape for a single-slash-origin CDN URL", () => {
    const url = "https://cdn.starwarsunlimited.com/card_repeat.png";
    expect(deriveRenditions(url)).toEqual({
      original: "/images/cards/card_repeat.png",
      w640: "/images/cards/card_repeat_640.webp",
      w320: "/images/cards/card_repeat_320.webp",
    });
  });

  it("is deterministic across calls (pure function, no state)", () => {
    const url = "https://cdn.starwarsunlimited.com/card_repeat.png";
    expect(deriveRenditions(url)).toEqual(deriveRenditions(url));
  });
});

describe("makeCardImageErrorHandler (BL-76 follow-up: single-slash 307->403 gap)", () => {
  const STORED = "https://cdn.starwarsunlimited.com/card_single_slash_form.png";

  it("swaps src to the stored URL and strips srcset/sizes on error", () => {
    const handler = makeCardImageErrorHandler(STORED);
    const { img, event } = makeImgEvent({
      src: "/images/cards/card_single_slash_form_640.webp",
      srcSet:
        "/images/cards/card_single_slash_form_320.webp 320w, /images/cards/card_single_slash_form_640.webp 640w",
      sizes: "140px",
    });

    handler(event);

    expect(img.getAttribute("src")).toBe(STORED);
    // srcset must be gone, or the browser would keep preferring a srcset
    // candidate over the swapped-in src.
    expect(img.getAttribute("srcset")).toBeNull();
    expect(img.getAttribute("sizes")).toBeNull();
  });

  it("fires once only: a second error (stored URL itself failing) is a no-op", () => {
    const handler = makeCardImageErrorHandler(STORED);
    const { img, event } = makeImgEvent({
      src: "/images/cards/card_single_slash_form_640.webp",
      srcSet: "/images/cards/card_single_slash_form_320.webp 320w",
    });

    handler(event); // swap
    const srcAfterSwap = img.getAttribute("src");
    handler(event); // stored URL also failed -> must not touch the element again

    expect(img.getAttribute("src")).toBe(srcAfterSwap);
    expect(img.getAttribute("src")).toBe(STORED);
  });

  it("no-ops when src already is the stored URL (absent-renditions path)", () => {
    const handler = makeCardImageErrorHandler(STORED);
    const { img, event } = makeImgEvent({ src: STORED });

    handler(event);

    expect(img.getAttribute("src")).toBe(STORED);
  });
});
