import { describe, expect, it } from "vitest";
import { BASE_SET_ORDER } from "../utils/setGrouping";
import { SET_LOGO_ART, SET_LOGO_BOX, setLogoLayout, setLogoNudge, setLogoUrl } from "./setLogoArt";

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
      // REPLACE (fix run, owner finish round 2026-10-12): LAW is the one
      // documented exception -- its mark is so dense (ink .66 of its box
      // against ~.4) that it read as the biggest logo; 0.64 of the area
      // (0.88 of the box's width) levels its INK with the others'.
      if (code === "LAW") {
        expect(a.scale, code).toBeCloseTo(0.64, 2);
        continue;
      }
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
        // REPLACE (fix run): the horizontal centre now allows the set's
        // optical nudge (JTL only; 0 for every other set, so they are held
        // to the centre exactly as before).
        const nudge = setLogoNudge(code, lay.artW, box.w);
        if (code !== "JTL") expect(nudge, label).toBe(0);
        expect(Math.abs(artX + lay.artW / 2 - box.w / 2 - nudge), label).toBeLessThan(0.05);
        expect(artX, label).toBeGreaterThanOrEqual(-0.01);
        expect(artX + lay.artW, label).toBeLessThanOrEqual(box.w + 0.01);
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

  it("LAW is pulled in to 0.88 of the chooser box's width; the deck-row box is 66 x 24", () => {
    const { w, h } = SET_LOGO_BOX.chooser;
    const law = setLogoLayout("LAW", w, h)!;
    expect(law.capped).toBe(false);
    expect(law.artW / w).toBeCloseTo(0.88, 2);
    expect(SET_LOGO_BOX.deck).toEqual({ w: 66, h: 24 });
    // The thinnest wordmark on a deck row: 66 x 6 (it was 50 x 4.6).
    const sor = setLogoLayout("SOR", SET_LOGO_BOX.deck.w, SET_LOGO_BOX.deck.h)!;
    expect(sor.artW).toBeCloseTo(66, 1);
    expect(sor.artH).toBeGreaterThanOrEqual(5.8);
  });

  it("nudges JTL right where the box has room, and never out of the box", () => {
    const { w } = SET_LOGO_BOX.chooser;
    const lay = setLogoLayout("JTL", w, SET_LOGO_BOX.chooser.h)!;
    const nudge = setLogoNudge("JTL", lay.artW, w);
    expect(nudge).toBeGreaterThan(2);
    expect(nudge).toBeLessThan(4);
    // A full-width artwork has no room: no nudge (the keypad's narrow box).
    expect(setLogoNudge("JTL", 46, 46)).toBe(0);
    expect(setLogoNudge("JTL", 60, 62)).toBe(1);
    expect(setLogoNudge("HMW", 60, 96)).toBe(0);
  });

  it('align "right" holds the artwork to the box\'s right edge, centred vertically', () => {
    const { w, h } = SET_LOGO_BOX.detail;
    for (const code of BASE_SET_ORDER) {
      const a = SET_LOGO_ART[code];
      const lay = setLogoLayout(code, w, h, "right")!;
      expect(lay.left + (a.l + a.aw) * lay.width, code).toBeCloseTo(w, 1);
      expect(lay.top + a.t * lay.height + lay.artH / 2, code).toBeCloseTo(h / 2, 1);
      // Same size as the centred layout.
      expect(lay.artW, code).toBe(setLogoLayout(code, w, h)!.artW);
    }
  });

  it("has no layout for an unmeasured code (the component fits the PNG)", () => {
    expect(setLogoLayout("C24", 96, 30)).toBeNull();
    expect(setLogoUrl("SOR")).toBe("/images/set_SOR.png");
  });
});
