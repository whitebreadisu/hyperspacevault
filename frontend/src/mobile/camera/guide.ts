// BL-253 S7-11: the strip guide v2 geometry (App Spec 24.3), a pure port of
// the spike's layoutGuideV2 / guideRectInVideo (app.js:300-342, 384-392,
// v0.5.5). Millimetres from the card's bottom-right corner; the outline is
// anchored on the group's nominal centre (W/2, 0.62 H); the drawn box and the
// OCR crop carry the tuned shifts (-2.2 mm horizontal, +2.1 mm up) plus the
// user's two guide-alignment sliders. Numbers verbatim (ADR-0029: the spike is
// the seed). Landscape constants are ported but unused -- portrait only
// (orchestrator ruling 7; rev4 removed the orientation toggle).

export interface Geom {
  cardW: number;
  cardH: number;
  groupW: number;
  rightMargin: number;
  textCentre: number;
  textH: number;
  boxH: number;
  setFrac: number;
  numFrac: number;
  radius: number;
}

export const GEOM: { portrait: Geom; landscape: Geom } = {
  portrait: {
    cardW: 63,
    cardH: 88,
    groupW: 13.4,
    rightMargin: 3.7,
    textCentre: 3.6,
    textH: 1.54,
    boxH: 4.0,
    setFrac: 0.394,
    numFrac: 0.343,
    radius: 3.0,
  },
  landscape: {
    cardW: 88,
    cardH: 63,
    groupW: 16.5,
    rightMargin: 3.7,
    textCentre: 4.2,
    textH: 1.54,
    boxH: 4.4,
    setFrac: 0.32,
    numFrac: 0.25,
    radius: 3.0,
  },
};

/** Stream px of strip text the guide implies (app.js:304). */
export const TARGET_TEXT_STREAM_PX = 45;
/** OCR crop = group box + 5% of the card width on every side = 3.15 mm. */
export const CROP_PAD_MM = 0.05 * 63;
/** The drawn box is 15% larger than the group on every side (v0.5.3). */
export const BOX_EXTRA = 0.15;
/** v0.5.4 -1.4 (run_6 crops) + v0.5.5 -0.8 (owner screenshot). */
export const BOX_BASE_SHIFT_MM = -2.2;
/** v0.5.5: the printed line sits ~2 mm higher than designed (promo templates). */
export const BOX_BASE_SHIFT_V_MM = 2.1;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideLayout {
  /** OCR crop in stage CSS px. */
  crop: Rect;
  /** The card outline (bottom-right corner drawn) in stage CSS px. */
  card: Rect & { radius: number };
  /** The drawn group box (15% larger) in stage CSS px. */
  box: Rect;
  /** Marker offsets inside the drawn box, percent. */
  markers: { setLeft: number; setWidth: number; numRight: number; numWidth: number };
  /** CSS px per mm at the implied distance. */
  mm: number;
  W: number;
  H: number;
  /** Stream px of text the guide implies (feeds the readers' target scale). */
  impliedTextPx: number;
}

/** app.js:321-342 layoutGuideV2. `offsetMm` / `offsetVMm` = the sliders
 * (+ = right / + = up). vw x vh = the video stream (2160 x 3840 before the
 * first frame, as the spike). */
export function layoutGuide(
  W: number,
  H: number,
  vw: number,
  vh: number,
  offsetMm = 0,
  offsetVMm = 0,
  G: Geom = GEOM.portrait
): GuideLayout {
  vw = vw || 2160;
  vh = vh || 3840;
  const k = Math.max(W / vw, H / vh); // CSS px per stream px (object-fit: cover)
  const mm = (TARGET_TEXT_STREAM_PX / G.textH) * k;
  const gx0 = W / 2;
  const gy0 = 0.62 * H;
  const cornerX = gx0 + (G.groupW / 2 + G.rightMargin) * mm;
  const cornerY = gy0 + G.textCentre * mm;
  const gy = gy0 - (BOX_BASE_SHIFT_V_MM + offsetVMm) * mm;
  const gx = gx0 + (BOX_BASE_SHIFT_MM + offsetMm) * mm;
  const bw = G.groupW * mm;
  const bh = G.boxH * mm;
  const bx = gx - bw / 2;
  const by = gy - bh / 2;
  const ex = BOX_EXTRA;
  const dw = bw * (1 + 2 * ex);
  const dh = bh * (1 + 2 * ex);
  const unit = 100 / (1 + 2 * ex);
  const pad = CROP_PAD_MM * mm;
  return {
    crop: { x: bx - pad, y: by - pad, w: bw + 2 * pad, h: bh + 2 * pad },
    card: {
      x: cornerX - G.cardW * mm,
      y: cornerY - G.cardH * mm,
      w: G.cardW * mm,
      h: G.cardH * mm,
      radius: G.radius * mm,
    },
    box: { x: gx - dw / 2, y: gy - dh / 2, w: dw, h: dh },
    markers: {
      setLeft: ex * unit,
      setWidth: G.setFrac * unit,
      numRight: ex * unit,
      numWidth: G.numFrac * unit,
    },
    mm,
    W,
    H,
    impliedTextPx: TARGET_TEXT_STREAM_PX,
  };
}

/** app.js:384-392: the crop (stage CSS px) in full-resolution video px under
 * `object-fit: cover`, clamped to the frame; null before the first frame. */
export function guideRectInVideo(
  g: GuideLayout,
  vw: number,
  vh: number
): (Rect & { vw: number; vh: number }) | null {
  if (!vw || !vh || !g.W || !g.H) return null;
  const scale = Math.max(g.W / vw, g.H / vh);
  const offX = (g.W - vw * scale) / 2;
  const offY = (g.H - vh * scale) / 2;
  let x = (g.crop.x - offX) / scale;
  let y = (g.crop.y - offY) / scale;
  let w = g.crop.w / scale;
  let h = g.crop.h / scale;
  x = Math.max(0, x);
  y = Math.max(0, y);
  w = Math.min(vw - x, w);
  h = Math.min(vh - y, h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), vw, vh };
}
