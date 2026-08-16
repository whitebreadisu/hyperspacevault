import { describe, it, expect, afterEach } from "vitest";
import { loadWidthTier, saveWidthTier, selectAutoTier } from "./tableWidthTier";

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

describe("selectAutoTier (BL-226)", () => {
  // The real CardsTable.tsx NATURAL_WIDTHS (COLUMN_WIDTHS-derived): Compact
  // 700, Standard 1050, Full 1538 -- see that file's own doc comment for the
  // per-tier arithmetic. Mirrored here as plain numbers so this suite stays
  // a pure-logic test, independent of any component import.
  const NATURAL_WIDTHS = { compact: 700, standard: 1050, full: 1538 };

  it("picks Full when the available width comfortably exceeds Full's natural width", () => {
    expect(selectAutoTier(1600, NATURAL_WIDTHS)).toBe("full");
  });

  it("picks Full at the EXACT boundary (>= comparison, not >)", () => {
    expect(selectAutoTier(1538, NATURAL_WIDTHS)).toBe("full");
  });

  it("picks Standard just below Full's boundary", () => {
    expect(selectAutoTier(1537, NATURAL_WIDTHS)).toBe("standard");
  });

  it("picks Standard at its own exact boundary", () => {
    expect(selectAutoTier(1050, NATURAL_WIDTHS)).toBe("standard");
  });

  it("picks Compact just below Standard's boundary", () => {
    expect(selectAutoTier(1049, NATURAL_WIDTHS)).toBe("compact");
  });

  it("picks Compact at its own exact boundary", () => {
    expect(selectAutoTier(700, NATURAL_WIDTHS)).toBe("compact");
  });

  it("falls through to Compact when even Compact's own sum doesn't fit -- no narrower tier exists", () => {
    expect(selectAutoTier(300, NATURAL_WIDTHS)).toBe("compact");
  });
});
