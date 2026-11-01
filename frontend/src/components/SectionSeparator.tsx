interface Props {
  /** Extra class for a seam that needs its own positioning (CardPopup and
   * the mobile surfaces pass one): `.circuit-separator` carries the mask
   * geometry, and this lets a call site layer on positioning without
   * duplicating the CSS rule. */
  className?: string;
}

/** SWU-site circuit-line seam divider in the "straddle pattern": a strip,
 * held to the SVG's native 2560:70 aspect ratio so it never distorts at any
 * window width/zoom, pulled up exactly
 * half its own height so its vertical midpoint lands on the seam it sits
 * under (see .circuit-separator in index.css, which owns the mask rule and
 * the asset reference). It's a CSS *mask*, not an image -- only the SVG's
 * circuit-line shapes get painted in steel grey; everything else stays
 * transparent so the page background/artwork behind it shows through the
 * gaps, exactly like the official SWU site.
 *
 * The asset (public/swu-separator.svg) is deliberately NOT a Vite-imported
 * `src/assets/` file like AspectIcon.tsx's PNGs: this SVG is ~1.9KB, under
 * Vite's default 4KB assetsInlineLimit, so an imported reference resolves
 * to an inlined `data:image/svg+xml` URI rather than a real file URL, and
 * browsers (tested: headless Edge/Chromium) silently fail to rasterize a
 * CSS `mask-image` sourced
 * from a data URI (the element just renders fully opaque, no masking, no
 * console error) even though the identical SVG works perfectly as a
 * `mask-image` when loaded from a real URL. Serving it from `public/`
 * (same convention as `public/images/set_*.png`) guarantees a real
 * network request in both dev and prod, sidestepping the bug entirely --
 * and since it's build-independent, the CSS can reference it directly
 * with no JS import or inline style needed. */
export function SectionSeparator({ className }: Props = {}) {
  return <div className={`circuit-separator${className ? ` ${className}` : ""}`} />;
}
