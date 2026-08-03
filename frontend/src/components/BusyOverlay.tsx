import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { AspectIcon } from "./AspectIcon";
import type { BusyStage } from "../hooks/useBusyOverlay";
import "./BusyOverlay.css";

/** BL-196: the six aspect glyphs, in a fixed render order -- reused for
 * every variant below (variant CSS reinterprets the same DOM, see
 * BusyOverlay.css). Same six aspect keys AspectIcon's own ASPECT_IMAGES map
 * uses. */
const ASPECTS = ["Command", "Aggression", "Cunning", "Vigilance", "Heroism", "Villainy"];

export type BusyOverlayVariant = "A" | "B" | "C";
const VARIANTS: readonly BusyOverlayVariant[] = ["A", "B", "C"];
const VARIANT_STORAGE_KEY = "swu.busyOverlay.variant";
/** Production hardcode point: once the owner picks a variant on localhost,
 * change this default and delete the two losing variants' CSS blocks + the
 * dev switcher below -- see the file's own top-of-brief note. */
const DEFAULT_VARIANT: BusyOverlayVariant = "A";

/** DEV-only, and only DEV ever writes swu.busyOverlay.variant in the first
 * place (BusyOverlay's dev switcher below) -- a PROD build ignores
 * localStorage entirely and always renders DEFAULT_VARIANT, which is the
 * "hardcoded-able by changing the default" contract the brief asks for. */
function readStoredVariant(): BusyOverlayVariant {
  if (!import.meta.env.DEV) return DEFAULT_VARIANT;
  try {
    const stored = localStorage.getItem(VARIANT_STORAGE_KEY);
    return (VARIANTS as readonly string[]).includes(stored ?? "")
      ? (stored as BusyOverlayVariant)
      : DEFAULT_VARIANT;
  } catch {
    return DEFAULT_VARIANT;
  }
}

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
  /** DEV-only HOLD affordance -- see useBusyOverlay's doc comment. Ignored
   * (and the corner control that would flip it never renders) outside DEV. */
  hold?: boolean;
  onToggleHold?: () => void;
}

/** BL-196: full-viewport blocking overlay for large inventory applies
 * (Import dry_run/commit, Add Cards / precon commit). Deliberately has NO
 * dismiss affordance -- no onClick/onKeyDown wired anywhere in this
 * component, matching the "busy state, not a dialog" framing -- Escape and
 * backdrop clicks are both no-ops here by simple absence of a handler.
 * role="status"/aria-live="polite" (not role="dialog") for the same reason:
 * assistive tech gets the staged message announced, but nothing here reads
 * as a focusable/dismissable dialog. */
export function BusyOverlay({ stage, hold = false, onToggleHold }: BusyOverlayProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [variant, setVariant] = useState<BusyOverlayVariant>(readStoredVariant);

  if (!stage) return null;

  function chooseVariant(v: BusyOverlayVariant) {
    setVariant(v);
    if (import.meta.env.DEV) {
      try {
        localStorage.setItem(VARIANT_STORAGE_KEY, v);
      } catch {
        // localStorage unavailable (private mode, etc.) -- the in-memory
        // state above still drives this render; nothing else to do.
      }
    }
  }

  const glyphsClass = reducedMotion ? "reduced" : variant.toLowerCase();

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
              // Variant C (Orbit) only: each glyph's fixed position on the
              // ring, referenced by its CSS keyframes via var(--busy-angle).
              // A static per-render inline value, not a JS-driven animation
              // -- the animation itself is pure CSS (BusyOverlay.css).
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
      {import.meta.env.DEV && (
        <div className="busy-overlay__dev">
          {VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              className={`busy-overlay__dev-btn${variant === v ? " busy-overlay__dev-btn--active" : ""}`}
              onClick={() => chooseVariant(v)}
            >
              {v}
            </button>
          ))}
          <button
            type="button"
            className={`busy-overlay__dev-btn${hold ? " busy-overlay__dev-btn--active" : ""}`}
            onClick={onToggleHold}
          >
            Hold
          </button>
        </div>
      )}
    </div>
  );
}
