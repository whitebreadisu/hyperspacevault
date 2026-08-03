import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { AspectIcon } from "./AspectIcon";
import type { BusyStage } from "../hooks/useBusyOverlay";
import "./BusyOverlay.css";

/** BL-196: the six aspect glyphs, in a fixed render order, evenly spaced on
 * the orbit ring (see BusyOverlay.css). Same six aspect keys AspectIcon's
 * own ASPECT_IMAGES map uses. */
const ASPECTS = ["Command", "Aggression", "Cunning", "Vigilance", "Heroism", "Villainy"];

/** jsdom implements no matchMedia at all (unlike most other browser APIs it
 * stubs) -- feature-detected rather than assumed, so every existing test
 * that mounts a surface with BusyOverlay wired in (ImportExportPage,
 * AddCardsModal) keeps working unmodified; only BusyOverlay's own reduced-
 * motion test mocks it. */
function usePrefersReducedMotion(): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [reduced, setReduced] = useState(
    () => supported && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (!supported) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return reduced;
}

export interface BusyOverlayProps {
  /** null hides the overlay entirely (the component renders nothing). */
  stage: BusyStage | null;
}

/** BL-196: full-viewport blocking overlay for large inventory applies
 * (Import dry_run/commit, Add Cards / precon commit). Deliberately has NO
 * dismiss affordance -- no onClick/onKeyDown wired anywhere in this
 * component, matching the "busy state, not a dialog" framing -- Escape and
 * backdrop clicks are both no-ops here by simple absence of a handler.
 * role="status"/aria-live="polite" (not role="dialog") for the same reason:
 * assistive tech gets the staged message announced, but nothing here reads
 * as a focusable/dismissable dialog.
 *
 * Animation: the owner-picked orbit (2026-08-03, from three built variants
 * -- the losing sequence-pulse/crossfade variants and the dev switcher were
 * stripped at the pick; git history has them if ever wanted back). Six
 * glyphs on a slow ring, each flashing at 6 o'clock and fading to 10%
 * across the revolution. Reduced motion swaps to a static dimmed row. */
export function BusyOverlay({ stage }: BusyOverlayProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (!stage) return null;

  const glyphsClass = reducedMotion ? "reduced" : "c";

  return (
    // Extends the shared .modal-overlay backdrop (BL-153, index.css) rather
    // than inventing a new scrim; `.busy-overlay.modal-overlay` in
    // BusyOverlay.css raises z-index above every existing modal layer
    // (AddCardsModal's nested close-guard confirm tops out at 200) since a
    // commit can run with that modal still open underneath.
    <div className="busy-overlay modal-overlay" role="status" aria-live="polite">
      <div className="busy-overlay__panel">
        <div className={`busy-overlay__glyphs busy-overlay__glyphs--${glyphsClass}`}>
          {ASPECTS.map((aspect, i) => (
            <span
              key={aspect}
              className="busy-overlay__glyph"
              // Each glyph's fixed position on the ring, referenced by its
              // CSS keyframes via var(--busy-angle). A static per-render
              // inline value, not a JS-driven animation -- the animation
              // itself is pure CSS (BusyOverlay.css).
              style={{ ["--busy-angle" as string]: `${i * 60}deg` } as CSSProperties}
            >
              <span className="busy-overlay__glyph-track">
                <span className="busy-overlay__glyph-inner">
                  <AspectIcon aspect={aspect} size={48} />
                </span>
              </span>
            </span>
          ))}
        </div>
        <p className="busy-overlay__message">{stage.message}</p>
        {stage.sub && <p className="busy-overlay__sub">{stage.sub}</p>}
      </div>
    </div>
  );
}
