import type { MeterBand } from "./imagePipeline";

// BL-253 S7-12: the sharpness meter over the preview (rev4 .m-meter layout:
// "Focus" label, 8 px bar, word + sub, the mono "read SOR 229" chip while a
// partial read exists) with the spike's live value and one-word guidance.
// Spec 24.2's phrases are verbatim -- "Blurry — move back / closer" below
// the gate and "Too small — move closer" on the glyph floor -- shown as the
// word (before the dash) and the sub (after it, sentence-cased for rev4's
// two-line layout) with the full phrase as the accessible text. These replace
// rev4's placeholder phases "Hold steady" / "Wait". Fill colours: red below
// the gate, amber below 1.5 x, green above (app.js:784-793). A "Keypad" link
// sits in the row (S7-16): the no-read escape, always one tap away.

export const BLURRY_PHRASE = "Blurry — move back / closer";
export const SMALL_PHRASE = "Too small — move closer";

/** FR5-03 (F-16): the camera-start focusing state's word, with its hint. */
export const FOCUSING_WORD = "Focusing…";
export const FOCUSING_SUB = "Wait to line up";

export type MeterMode =
  | { kind: "focusing" }
  | { kind: "blurry" }
  | { kind: "small" }
  | { kind: "ok" }
  | { kind: "sharp" }
  | { kind: "paused"; sub: string };

function split(phrase: string): [string, string] {
  const [w, s] = phrase.split(" — ");
  return [w, s.charAt(0).toUpperCase() + s.slice(1)];
}

export function meterWords(mode: MeterMode): { word: string; sub: string; label: string } {
  // One fixed label for the whole focusing state: the live region says it once.
  if (mode.kind === "focusing")
    return { word: FOCUSING_WORD, sub: FOCUSING_SUB, label: FOCUSING_WORD };
  if (mode.kind === "blurry") {
    const [word, sub] = split(BLURRY_PHRASE);
    return { word, sub, label: BLURRY_PHRASE };
  }
  if (mode.kind === "small") {
    const [word, sub] = split(SMALL_PHRASE);
    return { word, sub, label: SMALL_PHRASE };
  }
  if (mode.kind === "ok") return { word: "OK", sub: "Corner on the line", label: "OK" };
  if (mode.kind === "sharp") return { word: "Sharp", sub: "Corner on the line", label: "Sharp" };
  return { word: "Paused", sub: mode.sub, label: "Paused — " + mode.sub };
}

export function Meter({
  mode,
  pct,
  band,
  partial,
  onKeypad,
}: {
  mode: MeterMode;
  pct: number;
  band: MeterBand;
  partial: string | null;
  onKeypad: () => void;
}) {
  const w = meterWords(mode);
  return (
    <div className={"m-meter m-meter--" + mode.kind} data-band={band}>
      <span className="m-meter__l">Focus</span>
      <span className="m-meter__bar" aria-hidden="true">
        <span
          className={"m-meter__fill m-meter__fill--" + band}
          style={{ transform: `scaleX(${pct})` }}
        />
      </span>
      <span className="m-meter__words" role="status" aria-live="polite" aria-label={w.label}>
        <span className="m-meter__word">{w.word}</span>
        <span className="m-meter__sub">
          {w.sub}
          {partial ? <span className="m-meter__read"> · read {partial}</span> : null}
        </span>
      </span>
      <button type="button" className="m-textbtn m-meter__keypad" onClick={onKeypad}>
        Keypad
      </button>
    </div>
  );
}
