// BL-257 FR3-01 (F-11): set logos centred and optically even on the phone.
//
// The set_*.png files differ in aspect (2.5:1 .. 7.4:1) and in how much
// transparent padding surrounds the artwork, so fitting the PNG's own box
// (object-fit: contain, left-aligned) made ASH read huge, LOF and HMW small
// and HMW off-centre. The phone therefore lays out each logo by its OPAQUE
// ARTWORK -- the alpha bounding box, measured once by
// frontend/scripts/measure-set-logos.mjs (alpha >= 24/255) -- and never by the
// PNG's box. The PNG files themselves are untouched (desktop uses them).
//
// Rule (setLogoLayout): every artwork gets the same AREA -- SET_LOGO_FILL of
// the logo box, times the set's optical `scale` -- capped by the box's width
// and height, and is centred in the box on both axes (plus the set's optical
// `dx`, where the box has room for it). Every phone surface that draws a set
// logo uses this rule through SetLogo (SET_LOGO_BOX lists them).

export const setLogoUrl = (code: string) => `/images/set_${code}.png`;

export interface SetLogoArt {
  /** The PNG's pixel size. */
  w: number;
  h: number;
  /** The artwork box as fractions of the PNG: left, top, width, height. */
  l: number;
  t: number;
  aw: number;
  ah: number;
  /** Optical area adjustment on top of the equal-area rule (1 = none). */
  scale: number;
  /** Optical horizontal nudge, as a fraction of the artwork's width (positive
   * = right), for a mark whose visual weight is off its bounding-box centre.
   * Never pushes the artwork out of the box: a full-width artwork stays put. */
  dx?: number;
}

/** One entry per base set (vitest FR3-01 holds this to BASE_SET_ORDER).
 * Trims: `node scripts/measure-set-logos.mjs` (e2e fr3-01 re-measures the
 * served PNGs against this table). Scales and nudges: by eye, 2026-10-12:
 *  - LAW 0.64 -- the densest mark (ink .66 of its box against ~.4 for the
 *    rest) read as the biggest logo at the box's full width; 0.64 of the area
 *    is 0.88 of that width and puts its INK area level with the others';
 *  - LOF 1.1, TWI 1.12 -- thin, airy marks that read light at equal area;
 *  - JTL dx 0.035 -- the thin streak and fighter on the right stretch the
 *    bounding box past the wordmark, so the mark read ~6 px left of the
 *    column; nudged half-way back (the wordmark and the whole mark both stay
 *    near the centre line);
 *  - SOR -- the 11 : 1 wordmark is held by the box's width (no scale helps). */
export const SET_LOGO_ART: Readonly<Record<string, SetLogoArt>> = {
  HMW: { w: 1000, h: 404, l: 0.048, t: 0.1559, aw: 0.905, ah: 0.6238, scale: 1 },
  ASH: { w: 1973, h: 557, l: 0, t: 0, aw: 0.9995, ah: 1, scale: 1 },
  LAW: { w: 2000, h: 324, l: 0, t: 0, aw: 1, ah: 1, scale: 0.64 },
  SEC: { w: 2000, h: 453, l: 0, t: 0, aw: 1, ah: 1, scale: 1 },
  LOF: { w: 1000, h: 290, l: 0.105, t: 0.1759, aw: 0.802, ah: 0.6621, scale: 1.1 },
  JTL: { w: 1200, h: 416, l: 0.035, t: 0.1394, aw: 0.9392, ah: 0.7236, scale: 1, dx: 0.035 },
  TWI: { w: 2395, h: 778, l: 0.1461, t: 0.1362, aw: 0.7132, ah: 0.7288, scale: 1.12 },
  SHD: { w: 1198, h: 389, l: 0.0125, t: 0.0746, aw: 0.9758, ah: 0.8766, scale: 1 },
  SOR: { w: 2565, h: 347, l: 0.0682, t: 0.2104, aw: 0.8632, ah: 0.5821, scale: 1 },
  IBH: { w: 2000, h: 690, l: 0.0435, t: 0.129, aw: 0.913, ah: 0.742, scale: 1 },
  TS26: { w: 1000, h: 325, l: 0.077, t: 0.0769, aw: 0.847, ah: 0.8462, scale: 1 },
};

/** The share of the logo box an artwork's area takes before any cap. */
export const SET_LOGO_FILL = 0.625;

/** The logo boxes (CSS px) of every phone surface that draws a set logo. */
export const SET_LOGO_BOX = {
  /** Keypad "Choose a set" sheet, set rows (52 px rows). */
  chooser: { w: 96, h: 30 },
  /** The same sheet's precon deck rows. */
  deck: { w: 66, h: 24 },
  /** "Completion by set" sheet rows. */
  sets: { w: 104, h: 32 },
  /** The keypad's set button (a base set locked). */
  pad: { w: 62, h: 30 },
  /** The same button beside a subset code or a deck's short name. */
  padNarrow: { w: 46, h: 30 },
  /** The precon panel's head in the keypad's result zone. */
  precon: { w: 92, h: 34 },
  /** Filters > Set picker, the base-set chips. */
  chip: { w: 80, h: 24 },
  /** Filters sheet, a selected base set's chip on the Set row. */
  fsel: { w: 54, h: 18 },
  /** Card detail header (artwork held to the box's right edge). */
  detail: { w: 92, h: 30 },
} as const;
export type SetLogoBoxName = keyof typeof SET_LOGO_BOX;

export interface SetLogoLayout {
  /** The <img> (whole PNG) rect inside the box, CSS px. */
  width: number;
  height: number;
  left: number;
  top: number;
  /** The artwork's rendered size, CSS px. */
  artW: number;
  artH: number;
  /** True when the box's width or height held the artwork under its area. */
  capped: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export type SetLogoAlign = "center" | "right";

/** The optical nudge a set's artwork gets in a box (CSS px): its `dx` share
 * of the artwork's width, held to the room the box leaves beside it. */
export function setLogoNudge(code: string, artW: number, boxW: number): number {
  const dx = SET_LOGO_ART[code]?.dx ?? 0;
  const room = Math.max(0, (boxW - artW) / 2);
  return Math.max(-room, Math.min(room, dx * artW));
}

/** Where a set's PNG sits in a `boxW` x `boxH` logo box so that its artwork
 * takes the common area and is centred (or, `align` "right", held to the
 * box's right edge and centred vertically). Null for a code with no entry. */
export function setLogoLayout(
  code: string,
  boxW: number,
  boxH: number,
  align: SetLogoAlign = "center"
): SetLogoLayout | null {
  const a = SET_LOGO_ART[code];
  if (!a) return null;
  const aspect = (a.aw * a.w) / (a.ah * a.h);
  const area = SET_LOGO_FILL * boxW * boxH * a.scale;
  let artW = Math.sqrt(area * aspect);
  let artH = artW / aspect;
  let capped = false;
  if (artW > boxW) {
    artW = boxW;
    artH = artW / aspect;
    capped = true;
  }
  if (artH > boxH) {
    artH = boxH;
    artW = artH * aspect;
    capped = true;
  }
  const width = artW / a.aw;
  const height = artH / a.ah;
  const artLeft =
    align === "right" ? boxW - artW : (boxW - artW) / 2 + setLogoNudge(code, artW, boxW);
  return {
    width: r2(width),
    height: r2(height),
    left: r2(artLeft - a.l * width),
    top: r2((boxH - artH) / 2 - a.t * height),
    artW: r2(artW),
    artH: r2(artH),
    capped,
  };
}
