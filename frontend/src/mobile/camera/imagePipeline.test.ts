import { describe, expect, it } from "vitest";
import {
  BLUR_THRESHOLD,
  MIN_GLYPH,
  estimateTextHeight,
  gateValue,
  isBlurry,
  isSmall,
  laplacianVar,
  measureGray,
  meterView,
  otsu,
  targetScale,
} from "./imagePipeline";
import { BLURRY_PHRASE, SMALL_PHRASE, meterWords } from "./Meter";

// BL-253 S7-12: the sharpness gate (14), the glyph floor (22), the meter
// bands at 14 / 21 / 42 (fill = value / 3 x threshold), Otsu + projection
// text height + Laplacian on synthetic strips, and Spec 24.2's phrases.

/** A w x h grey strip with a band of alternating 0/255 "glyph" columns. */
function strip(w: number, h: number, top: number, bottom: number, period = 2): Uint8ClampedArray {
  const g = new Uint8ClampedArray(w * h).fill(200);
  for (let y = top; y <= bottom; y++)
    for (let x = 0; x < w; x++) g[y * w + x] = Math.floor(x / period) % 2 ? 20 : 230;
  return g;
}

describe("S7-12 sharpness gate + meter + guidance", () => {
  it("Otsu splits a two-level image between its levels", () => {
    const g = new Uint8ClampedArray(100).map((_, i) => (i < 50 ? 30 : 220));
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it("projection profile finds the text band; Laplacian of flat grey is 0", () => {
    const g = strip(60, 40, 15, 24);
    const est = estimateTextHeight(g, 60, 40);
    expect(est.px).toBe(10);
    expect(est.top).toBe(15);
    expect(est.bottom).toBe(24);
    const flat = new Uint8ClampedArray(60 * 40).fill(128);
    expect(laplacianVar(flat, 60, 40, 0, 40)).toBe(0);
    expect(estimateTextHeight(flat, 60, 40).px).toBe(0);
  });

  it("the gate reads the text band when there is one, the whole crop otherwise", () => {
    const m = measureGray(strip(60, 40, 15, 24), 60, 40);
    expect(m.lap_var_text).not.toBeNull();
    expect(gateValue(m)).toBe(m.lap_var_text);
    expect(m.lap_var_text!).toBeGreaterThan(BLUR_THRESHOLD);
    const flat = measureGray(new Uint8ClampedArray(60 * 40).fill(90), 60, 40);
    expect(flat.lap_var_text).toBeNull();
    expect(gateValue(flat)).toBe(0);
  });

  it("gate boundary at 13.9 / 14.0; null is blurry", () => {
    expect(BLUR_THRESHOLD).toBe(14);
    expect(isBlurry(13.9)).toBe(true);
    expect(isBlurry(14.0)).toBe(false);
    expect(isBlurry(null)).toBe(true);
  });

  it("meter bands at 14 / 21 / 42 (fill = value / 42)", () => {
    expect(meterView(13.9)).toMatchObject({ band: "red" });
    expect(meterView(14)).toMatchObject({ band: "amber", pct: 14 / 42 });
    expect(meterView(20.9).band).toBe("amber");
    expect(meterView(21)).toMatchObject({ band: "green", pct: 0.5 });
    expect(meterView(42).pct).toBe(1);
    expect(meterView(500).pct).toBe(1);
    expect(meterView(null)).toMatchObject({ band: "red", pct: 0 });
  });

  it("the glyph floor is 22 processed px; unknown glyph size is not small", () => {
    expect(MIN_GLYPH).toBe(22);
    expect(isSmall(21)).toBe(true);
    expect(isSmall(22)).toBe(false);
    expect(isSmall(null)).toBe(false);
  });

  it("reader target scale: 40 px Paddle / 36 px Tesseract over the implied 45, clamped 0.6-1.5", () => {
    const m = {
      crop_w: 576,
      crop_h: 301,
      est_text_px: 40,
      lap_var: 1,
      lap_var_text: 1,
      implied_text_px: 45,
    };
    expect(targetScale(m, 40)).toBeCloseTo(40 / 45, 9);
    expect(targetScale(m, 36)).toBeCloseTo(0.8, 9);
    expect(targetScale({ ...m, implied_text_px: 10 }, 40)).toBe(1.5);
    expect(targetScale({ ...m, implied_text_px: 100 }, 40)).toBe(0.6);
    expect(targetScale({ ...m, implied_text_px: null }, 40)).toBeNull();
  });

  it("guidance phrases are Spec 24.2's, verbatim (word / sub / accessible text)", () => {
    expect(BLURRY_PHRASE).toBe("Blurry — move back / closer");
    expect(SMALL_PHRASE).toBe("Too small — move closer");
    expect(meterWords({ kind: "blurry" })).toEqual({
      word: "Blurry",
      sub: "Move back / closer",
      label: BLURRY_PHRASE,
    });
    expect(meterWords({ kind: "small" })).toEqual({
      word: "Too small",
      sub: "Move closer",
      label: SMALL_PHRASE,
    });
    expect(meterWords({ kind: "ok" }).word).toBe("OK");
    expect(meterWords({ kind: "sharp" }).word).toBe("Sharp");
  });
});
