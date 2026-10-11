import { describe, expect, it } from "vitest";
import { GEOM, guideRectInVideo, layoutGuide } from "./guide";

// BL-253 S7-11: the guide geometry equals the spike's (app.js v0.5.5
// layoutGuideV2 + guideRectInVideo). Reference values were produced by
// running the spike's OWN functions (extracted verbatim from app.js between
// "geometry: outline and strip crop" and "image pipeline", stub DOM) for a
// 390 x 560 stage: the smoke_test.js v2 frame maths on the 1080 x 1920
// fake-camera clip, then the phone's 2160 x 3840 stream and a slider shift.

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

describe("S7-11 guide geometry (spike layoutGuideV2, verbatim)", () => {
  it("the 1080 x 1920 clip at the tuned offsets: crop, outline, box, video rect", () => {
    const g = layoutGuide(390, 560, 1080, 1920);
    expect(g.mm).toBeCloseTo(10.551948051948052, 9);
    expect([g.crop.x, g.crop.y, g.crop.w, g.crop.h].map((v) => +v.toFixed(4))).toEqual([
      67.849, 270.6984, 207.8734, 108.6851,
    ]);
    expect(near(g.card.x, -360.03246753246754, 0.001)).toBe(true);
    expect(near(g.card.y, -543.3844155844157, 0.001)).toBe(true);
    expect(near(g.card.w, 664.7727272727273, 0.001)).toBe(true);
    expect(near(g.card.h, 928.5714285714287, 0.001)).toBe(true);
    expect(near(g.box.x, 79.87824675324673, 0.001)).toBe(true);
    expect(near(g.box.y, 297.6058441558441, 0.001)).toBe(true);
    expect(near(g.box.w, 183.8149350649351, 0.001)).toBe(true);
    expect(near(g.box.h, 54.87012987012987, 0.001)).toBe(true);
    const r = guideRectInVideo(g, 1080, 1920)!;
    const want = [188, 934, 576, 301];
    [r.x, r.y, r.w, r.h].forEach((v, i) => expect(near(v, want[i])).toBe(true));
  });

  it("the phone stream (2160 x 3840) keeps the same stream-px crop", () => {
    const g = layoutGuide(390, 560, 2160, 3840);
    const r = guideRectInVideo(g, 2160, 3840)!;
    expect([r.x, r.y, r.w, r.h]).toEqual([728, 2080, 576, 301]);
    expect(g.card.radius).toBeCloseTo(3 * g.mm, 9);
  });

  it("the sliders shift the box and the crop, never the outline (+ = right, + = up)", () => {
    const a = layoutGuide(390, 560, 1080, 1920);
    const b = layoutGuide(390, 560, 1080, 1920, 1, -0.5);
    expect(b.card).toEqual(a.card);
    expect(b.crop.x - a.crop.x).toBeCloseTo(1 * a.mm, 9);
    expect(b.crop.y - a.crop.y).toBeCloseTo(0.5 * a.mm, 9); // -0.5 "up" = 0.5 mm down
    const r = guideRectInVideo(b, 1080, 1920)!;
    expect([r.x, r.y, r.w, r.h]).toEqual([217, 949, 576, 301]); // the spike's own numbers
  });

  it("cover mapping on a landscape stream; null before the first frame", () => {
    const g = layoutGuide(390, 700, 1920, 1080);
    expect(guideRectInVideo(g, 1920, 1080)).toEqual({
      x: 608,
      y: 458,
      w: 576,
      h: 301,
      vw: 1920,
      vh: 1080,
    });
    expect(guideRectInVideo(g, 0, 0)).toBeNull();
    // Before the first frame the spike assumes 2160 x 3840.
    expect(layoutGuide(390, 560, 0, 0).mm).toBeCloseTo(5.275974025974026, 9);
  });

  it("portrait constants are the spike's (landscape ported, unused)", () => {
    expect(GEOM.portrait).toMatchObject({
      groupW: 13.4,
      rightMargin: 3.7,
      textCentre: 3.6,
      textH: 1.54,
      boxH: 4.0,
      radius: 3.0,
    });
    expect(GEOM.landscape.groupW).toBe(16.5);
  });
});
