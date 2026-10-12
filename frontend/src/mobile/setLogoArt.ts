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
// and height, and is centred in the box on both axes.

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
}

/** One entry per base set (vitest FR3-01 holds this to BASE_SET_ORDER).
 * Trims: `node scripts/measure-set-logos.mjs`. Scales: by eye, 2026-10-12 --
 * the reason for each is in the comment beside it. */
export const SET_LOGO_ART: Readonly<Record<string, SetLogoArt>> = {
  HMW: { w: 1000, h: 404, l: 0.048, t: 0.1559, aw: 0.905, ah: 0.6238, scale: 1 },
  ASH: { w: 1973, h: 557, l: 0, t: 0, aw: 0.9995, ah: 1, scale: 1 },
  LAW: { w: 2000, h: 324, l: 0, t: 0, aw: 1, ah: 1, scale: 1 },
  SEC: { w: 2000, h: 453, l: 0, t: 0, aw: 1, ah: 1, scale: 1 },
  LOF: { w: 1000, h: 290, l: 0.105, t: 0.1759, aw: 0.802, ah: 0.6621, scale: 1.1 },
  JTL: { w: 1200, h: 416, l: 0.035, t: 0.1394, aw: 0.9392, ah: 0.7236, scale: 1 },
  TWI: { w: 2395, h: 778, l: 0.1461, t: 0.1362, aw: 0.7132, ah: 0.7288, scale: 1.12 },
  SHD: { w: 1198, h: 389, l: 0.0125, t: 0.0746, aw: 0.9758, ah: 0.8766, scale: 1 },
  SOR: { w: 2565, h: 347, l: 0.0682, t: 0.2104, aw: 0.8632, ah: 0.5821, scale: 1 },
  IBH: { w: 2000, h: 690, l: 0.0435, t: 0.129, aw: 0.913, ah: 0.742, scale: 1 },
  TS26: { w: 1000, h: 325, l: 0.077, t: 0.0769, aw: 0.847, ah: 0.8462, scale: 1 },
};

/** The share of the logo box an artwork's area takes before any cap. */
export const SET_LOGO_FILL = 0.625;

/** The logo boxes (CSS px) of the three surfaces that use the rule. */
export const SET_LOGO_BOX = {
  /** Keypad "Choose a set" sheet, set rows (52 px rows). */
  chooser: { w: 96, h: 30 },
  /** The same sheet's precon deck rows. */
  deck: { w: 50, h: 24 },
  /** "Completion by set" sheet rows. */
  sets: { w: 104, h: 32 },
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

/** Where a set's PNG sits in a `boxW` x `boxH` logo box so that its artwork
 * is centred and takes the common area. Null for a code with no entry. */
export function setLogoLayout(code: string, boxW: number, boxH: number): SetLogoLayout | null {
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
  return {
    width: r2(width),
    height: r2(height),
    left: r2((boxW - artW) / 2 - a.l * width),
    top: r2((boxH - artH) / 2 - a.t * height),
    artW: r2(artW),
    artH: r2(artH),
    capped,
  };
}
