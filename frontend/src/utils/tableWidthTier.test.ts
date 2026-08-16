import { describe, it, expect, afterEach } from "vitest";
import { loadWidthTier, saveWidthTier, selectAutoStepCount } from "./tableWidthTier";

// CREATE (BL-226, Issue #140): pure-logic coverage for the width-tier
// persistence + AUTO selection rule. Component-level wiring (which columns
// each tier actually renders, the ResizeObserver measurement, the override
// control) is covered in CardsTable.test.tsx / InventorySummary.test.tsx /
// CardsPage.test.tsx.

describe("loadWidthTier / saveWidthTier (BL-226)", () => {
  afterEach(() => window.localStorage.clear());

  it("defaults to 'auto' when nothing is stored", () => {
    expect(loadWidthTier()).toBe("auto");
  });

  it("round-trips a saved manual tier", () => {
    saveWidthTier("compact");
    expect(loadWidthTier()).toBe("compact");
    saveWidthTier("standard");
    expect(loadWidthTier()).toBe("standard");
    saveWidthTier("full");
    expect(loadWidthTier()).toBe("full");
  });

  it("degrades to 'auto' for a corrupt stored value", () => {
    window.localStorage.setItem("swu.cardsTable.widthTier", "bogus");
    expect(loadWidthTier()).toBe("auto");
  });

  it("round-trips 'auto' itself (an explicit re-pick back to auto persists too)", () => {
    saveWidthTier("compact");
    saveWidthTier("auto");
    expect(loadWidthTier()).toBe("auto");
  });
});

// REPLACES the original selectAutoTier suite -- owner round 2 (2026-08-16)
// revised AUTO from three fixed tiers to column-at-a-time ladder steps.
describe("selectAutoStepCount (BL-226 round 2)", () => {
  // The real CardsTable.tsx WIDTH_BY_STEP_COUNT (COLUMN_WIDTHS-derived):
  // base #/Name/Playset = 388, then +rarity 516, +set 586, +value 700
  // (= the Compact preset), +aspect 808, +variants 894, +cost/power/hp 1050
  // (= Standard), +type 1140, +arena 1214, +trait/keyword 1538 (= Full).
  // Mirrored as plain numbers so this suite stays pure-logic, independent
  // of any component import.
  const WIDTHS = [388, 516, 586, 700, 808, 894, 1050, 1140, 1214, 1538];

  it("picks every step (Full) when the width comfortably exceeds the last sum", () => {
    expect(selectAutoStepCount(1600, WIDTHS)).toBe(9);
  });

  it("picks the last step at the EXACT boundary (>= comparison, not >)", () => {
    expect(selectAutoStepCount(1538, WIDTHS)).toBe(9);
  });

  it("drops exactly one step just below a boundary -- column-at-a-time, not tier-at-a-time", () => {
    expect(selectAutoStepCount(1537, WIDTHS)).toBe(8); // trait/keyword hidden, arena still shown
    expect(selectAutoStepCount(1213, WIDTHS)).toBe(7); // arena also hidden, type still shown
  });

  it("resolves mid-ladder widths between the old tier boundaries", () => {
    expect(selectAutoStepCount(900, WIDTHS)).toBe(5); // compact + aspect + variants
    expect(selectAutoStepCount(808, WIDTHS)).toBe(4); // compact + aspect
  });

  it("walks below Compact: value drops first, then set, then rarity (owner's reduce order)", () => {
    expect(selectAutoStepCount(699, WIDTHS)).toBe(2); // value hidden
    expect(selectAutoStepCount(585, WIDTHS)).toBe(1); // set also hidden
    expect(selectAutoStepCount(515, WIDTHS)).toBe(0); // rarity also hidden -- bare minimum
  });

  it("returns the bare minimum (0 steps) when even that doesn't fit -- nothing narrower exists", () => {
    expect(selectAutoStepCount(300, WIDTHS)).toBe(0);
  });
});
