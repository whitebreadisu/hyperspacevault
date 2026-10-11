import type { Rect } from "./guide";

// BL-253 S7-12: the frame pipeline (spike app.js:395-494, 558-573, v0.5.5),
// numbers verbatim. `measure()` runs on the UI thread against one reusable
// canvas: grayscale (77/150/29 >> 8), Otsu, the projection-profile text
// height, the Laplacian variance of the TEXT BAND (rows of the estimated text
// height +/- one text height, else the whole crop) -- below 14 the frame is
// never read. The readers' inputs: Paddle gets the unprocessed colour crop
// scaled to 40 px text (scale clamp 0.6-1.5), Tesseract the gray / inverted /
// 2%-98% stretched crop at 36 px. OCR runs in the worker. No automatic zoom,
// ever (there is no zoom code here at all).

/** Sharpness gate (app.js:1226 blurThreshold default). */
export const BLUR_THRESHOLD = 14;
/** Glyph floor, processed px (app.js:1223 minGlyph default). */
export const MIN_GLYPH = 22;
export const PADDLE_TEXT_PX = 40;
export const TESS_TEXT_PX = 36;
/** v0.3 fixed output width when no implied text height exists. */
export const FIXED_W = 1100;

export function grayOf(img: { data: ArrayLike<number> }): Uint8ClampedArray {
  const d = img.data;
  const n = d.length / 4;
  const g = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4)
    g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return g;
}

export function otsu(g: ArrayLike<number>): number {
  const hist = new Array<number>(256).fill(0);
  const n = g.length;
  for (let i = 0; i < n; i++) hist[g[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let th = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      th = i;
    }
  }
  return th;
}

export interface TextHeight {
  px: number;
  row: number;
  score: number;
  top?: number;
  bottom?: number;
}

/** Text height by projection profile: rows crossed by many dark/light
 * transitions are text rows (app.js:417-430). */
export function estimateTextHeight(g: ArrayLike<number>, w: number, h: number): TextHeight {
  const th = otsu(g);
  const score = new Float32Array(h);
  let max = 0;
  let maxRow = 0;
  for (let y = 0; y < h; y++) {
    let t = 0;
    let prev = g[y * w] > th;
    for (let x = 1; x < w; x++) {
      const cur = g[y * w + x] > th;
      if (cur !== prev) t++;
      prev = cur;
    }
    score[y] = t / w;
    if (score[y] > max) {
      max = score[y];
      maxRow = y;
    }
  }
  if (max < 0.01) return { px: 0, row: -1, score: max };
  const lim = 0.35 * max;
  let a = maxRow;
  let b = maxRow;
  while (a > 0 && score[a - 1] >= lim) a--;
  while (b < h - 1 && score[b + 1] >= lim) b++;
  return { px: b - a + 1, row: maxRow, top: a, bottom: b, score: Math.round(max * 1000) / 1000 };
}

/** Variance of the 4-neighbour Laplacian over rows [y0, y1) (app.js:433-445). */
export function laplacianVar(
  g: ArrayLike<number>,
  w: number,
  h: number,
  y0: number,
  y1: number
): number | null {
  y0 = Math.max(1, y0 | 0);
  y1 = Math.min(h - 1, y1 | 0);
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let y = y0; y < y1; y++) {
    const o = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = o + x;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s += l;
      s2 += l * l;
      n++;
    }
  }
  if (!n) return null;
  const m = s / n;
  return Math.round((s2 / n - m * m) * 10) / 10;
}

export interface Measure {
  crop_w: number;
  crop_h: number;
  est_text_px: number;
  lap_var: number | null;
  lap_var_text: number | null;
  implied_text_px?: number | null;
}

/** The measure of one grayscale crop (app.js:449-466 minus the research-only
 * right-clip ink ratio). */
export function measureGray(g: ArrayLike<number>, w: number, h: number): Measure {
  const est = estimateTextHeight(g, w, h);
  const sharp = laplacianVar(g, w, h, 0, h);
  const sharpText = est.px
    ? laplacianVar(g, w, h, (est.top as number) - est.px, (est.bottom as number) + est.px + 1)
    : null;
  return { crop_w: w, crop_h: h, est_text_px: est.px, lap_var: sharp, lap_var_text: sharpText };
}

/** app.js:448: the text band's variance, else the whole crop's. */
export function gateValue(m: Measure): number | null {
  return m.lap_var_text != null ? m.lap_var_text : m.lap_var;
}

/** Below the gate the frame is never read. */
export function isBlurry(v: number | null, thr = BLUR_THRESHOLD): boolean {
  return v == null || v < thr;
}

/** app.js:225: below the glyph floor a read is shown but never counts. */
export function isSmall(glyphPx: number | null | undefined, floor = MIN_GLYPH): boolean {
  return glyphPx != null && glyphPx < floor;
}

export type MeterBand = "red" | "amber" | "green";

/** app.js:784-793 updateMeter: fill = value / (3 x threshold); below the gate
 * red, below 1.5 x amber "OK", else green "Sharp". */
export function meterView(
  v: number | null,
  thr = BLUR_THRESHOLD
): { pct: number; band: MeterBand; value: number } {
  const val = v == null ? 0 : v;
  const pct = Math.max(0, Math.min(1, val / (thr * 3 || 1)));
  const band: MeterBand = val < thr ? "red" : val < thr * 1.5 ? "amber" : "green";
  return { pct, band, value: val };
}

/** app.js:563 targetScale: the reader's target text height over the implied
 * one, clamped 0.6-1.5 (null without an implied height). */
export function targetScale(m: Measure, target: number): number | null {
  return m.implied_text_px ? Math.max(0.6, Math.min(1.5, target / m.implied_text_px)) : null;
}

// ── Canvas side (browser only) ─────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;
type Source = CanvasImageSource;

/** The reusable canvases of one camera screen (app.js cA / cB / cP). */
export class FramePipeline {
  private cA: HTMLCanvasElement;
  private cB: HTMLCanvasElement;
  private cP: HTMLCanvasElement;
  private a: Ctx;
  private b: Ctx;
  private p: Ctx;

  constructor(doc: Document = document) {
    this.cA = doc.createElement("canvas");
    this.cB = doc.createElement("canvas");
    this.cP = doc.createElement("canvas");
    this.a = this.cA.getContext("2d", { willReadFrequently: true }) as Ctx;
    this.b = this.cB.getContext("2d", { willReadFrequently: true }) as Ctx;
    this.p = this.cP.getContext("2d", { willReadFrequently: true }) as Ctx;
  }

  /** Copy the crop out of the frame and measure it. */
  measure(source: Source, r: Rect): Measure {
    this.cA.width = r.w;
    this.cA.height = r.h;
    this.a.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const g = grayOf(this.a.getImageData(0, 0, r.w, r.h));
    return measureGray(g, r.w, r.h);
  }

  /** app.js:566-573: Paddle's input -- the unprocessed colour crop. */
  colourFixedWidth(m: Measure): HTMLCanvasElement {
    const sc = targetScale(m, PADDLE_TEXT_PX) || Math.max(0.25, Math.min(4, FIXED_W / m.crop_w));
    this.cP.width = Math.max(1, Math.round(m.crop_w * sc));
    this.cP.height = Math.max(1, Math.round(m.crop_h * sc));
    this.p.imageSmoothingEnabled = true;
    this.p.imageSmoothingQuality = "high";
    this.p.drawImage(this.cA, 0, 0, m.crop_w, m.crop_h, 0, 0, this.cP.width, this.cP.height);
    return this.cP;
  }

  /** app.js:468-494: Tesseract's input -- gray, inverted if dark, 2%-98% stretch. */
  scaleAndClean(m: Measure): HTMLCanvasElement {
    const w = m.crop_w;
    const h = m.crop_h;
    const scale = targetScale(m, TESS_TEXT_PX) || Math.max(0.25, Math.min(4, FIXED_W / w));
    const ow = Math.max(1, Math.round(w * scale));
    const oh = Math.max(1, Math.round(h * scale));
    this.cB.width = ow;
    this.cB.height = oh;
    this.b.imageSmoothingEnabled = true;
    this.b.imageSmoothingQuality = "high";
    this.b.drawImage(this.cA, 0, 0, w, h, 0, 0, ow, oh);
    const img = this.b.getImageData(0, 0, ow, oh);
    const d = img.data;
    const g = grayOf(img);
    const n = g.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += g[i];
    const invert = sum / n < 128;
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < n; i++) {
      if (invert) g[i] = 255 - g[i];
      hist[g[i]]++;
    }
    let lo = 0;
    let hi = 255;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= n * 0.02) {
        lo = i;
        break;
      }
    }
    acc = 0;
    for (let i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= n * 0.02) {
        hi = i;
        break;
      }
    }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) {
      let val = ((g[i] - lo) * 255) / span;
      val = val < 0 ? 0 : val > 255 ? 255 : val;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = val;
      d[i * 4 + 3] = 255;
    }
    this.b.putImageData(img, 0, 0);
    return this.cB;
  }

  /** The last `scaleAndClean` output (Tesseract's full-strip input). */
  get processed(): HTMLCanvasElement {
    return this.cB;
  }

  /** app.js:497-502: the right 40% of the prepared crop (the digits pass). */
  rightPart(): HTMLCanvasElement {
    const c = this.cB.ownerDocument.createElement("canvas");
    const w = this.cB.width;
    const h = this.cB.height;
    const x = Math.round(w * 0.6);
    c.width = w - x;
    c.height = h;
    c.getContext("2d")?.drawImage(this.cB, x, 0, w - x, h, 0, 0, w - x, h);
    return c;
  }
}
