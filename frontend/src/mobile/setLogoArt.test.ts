import { describe, expect, it } from "vitest";
import { BASE_SET_ORDER } from "../utils/setGrouping";
import { SET_LOGO_ART, SET_LOGO_BOX, setLogoLayout, setLogoUrl } from "./setLogoArt";

describe("FR3-01 set logo artwork table", () => {
  it("has an entry for every base set (and nothing else)", () => {
    expect(Object.keys(SET_LOGO_ART).sort()).toEqual([...BASE_SET_ORDER].sort());
  });

  it("every trim is a box inside its PNG", () => {
    for (const [code, a] of Object.entries(SET_LOGO_ART)) {
      expect(a.w > 0 && a.h > 0, code).toBe(true);
      expect(a.l >= 0 && a.t >= 0 && a.aw > 0 && a.ah > 0, code).toBe(true);
      expect(a.l + a.aw, code).toBeLessThanOrEqual(1.0001);
      expect(a.t + a.ah, code).toBeLessThanOrEqual(1.0001);
      // An optical adjustment stays inside the +/-20 % evenness band.
      expect(a.scale, code).toBeGreaterThanOrEqual(0.8);
      expect(a.scale, code).toBeLessThanOrEqual(1.2);
    }
  });

  it("centres the artwork in every logo box and keeps it inside", () => {
    for (const [name, box] of Object.entries(SET_LOGO_BOX))
      for (const code of BASE_SET_ORDER) {
        const a = SET_LOGO_ART[code];
        const lay = setLogoLayout(code, box.w, box.h)!;
        const artX = lay.left + a.l * lay.width;
        const artY = lay.top + a.t * lay.height;
        const label = `${name} ${code}`;
        expect(Math.abs(artX + lay.artW / 2 - box.w / 2), label).toBeLessThan(0.05);
        expect(Math.abs(artY + lay.artH / 2 - box.h / 2), label).toBeLessThan(0.05);
        expect(lay.artW, label).toBeLessThanOrEqual(box.w + 0.01);
        expect(lay.artH, label).toBeLessThanOrEqual(box.h + 0.01);
        // The PNG keeps its own aspect (never stretched).
        expect(lay.width / lay.height, label).toBeCloseTo(a.w / a.h, 1);
      }
  });

  it("gives uncapped artworks the same area times their scale", () => {
    const { w, h } = SET_LOGO_BOX.chooser;
    const hmw = setLogoLayout("HMW", w, h)!;
    const ash = setLogoLayout("ASH", w, h)!;
    expect(hmw.capped || ash.capped).toBe(false);
    expect((hmw.artW * hmw.artH) / (ash.artW * ash.artH)).toBeCloseTo(1, 1);
    // The 11 : 1 Spark of Rebellion wordmark is held by the box's width.
    const sor = setLogoLayout("SOR", w, h)!;
    expect(sor.capped).toBe(true);
    expect(sor.artW).toBeCloseTo(w, 1);
  });

  it("has no layout for an unmeasured code (the component fits the PNG)", () => {
    expect(setLogoLayout("C24", 96, 30)).toBeNull();
    expect(setLogoUrl("SOR")).toBe("/images/set_SOR.png");
  });
});
