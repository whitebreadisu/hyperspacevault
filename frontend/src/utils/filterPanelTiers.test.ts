import { describe, it, expect } from "vitest";
import {
  CHROME_OFFSET,
  H_FULL,
  H_COMPACT,
  H_TWO,
  tierForAvail,
  tierForViewportHeight,
  DOCKED_MIN_WIDTH,
  fitsSideBySide,
} from "./filterPanelTiers";

// DISPOSITION (BL-121, CREATE): net-new pure tier-selection logic extracted
// from FilterPanel.tsx so the avail -> tier decision ladder (design
// handoff §2) is unit-testable without mounting the component. Component-
// level tests (data-vtier rendering, regrouped order, footer-row presence,
// fallback scroll structure, rail ring classes) live in FilterPanel.test.tsx.

describe("tierForAvail (BL-121 §2 comparison ladder)", () => {
  it("returns full comfortably above the FULL threshold", () => {
    expect(tierForAvail(H_FULL + 200)).toBe("full");
  });

  it("returns full exactly at the FULL margin boundary (avail >= H_FULL + 16)", () => {
    expect(tierForAvail(H_FULL + 16)).toBe("full");
    expect(tierForAvail(H_FULL + 15)).not.toBe("full");
  });

  it("returns compact comfortably between the COMPACT and FULL thresholds", () => {
    expect(tierForAvail(H_COMPACT + 60)).toBe("compact");
  });

  it("returns compact exactly at the COMPACT margin boundary (avail >= H_COMPACT + 20)", () => {
    expect(tierForAvail(H_COMPACT + 20)).toBe("compact");
    expect(tierForAvail(H_COMPACT + 19)).not.toBe("compact");
  });

  it("returns two-col comfortably between the TWO-COL and COMPACT thresholds", () => {
    expect(tierForAvail(H_TWO + 60)).toBe("two-col");
  });

  it("returns two-col exactly at the TWO-COL margin boundary (avail >= H_TWO + 22)", () => {
    expect(tierForAvail(H_TWO + 22)).toBe("two-col");
    expect(tierForAvail(H_TWO + 21)).toBe("fallback");
  });

  it("falls back below the TWO-COL threshold, including very small/negative avail", () => {
    expect(tierForAvail(H_TWO)).toBe("fallback");
    expect(tierForAvail(0)).toBe("fallback");
    expect(tierForAvail(-500)).toBe("fallback");
  });

  it("comparisons are deterministic -- no hysteresis (same avail always yields the same tier)", () => {
    const avail = H_COMPACT + 30;
    expect(tierForAvail(avail)).toBe(tierForAvail(avail));
  });
});

describe("tierForViewportHeight (applies CHROME_OFFSET)", () => {
  it("matches tierForAvail(innerHeight - CHROME_OFFSET)", () => {
    for (const innerHeight of [2400, 1440, 1080, 900, 768, 560, 400]) {
      expect(tierForViewportHeight(innerHeight)).toBe(tierForAvail(innerHeight - CHROME_OFFSET));
    }
  });

  // The five QA reference heights from the BL-121 design handoff §2 --
  // re-measured against the real running app (not the mirror's sample
  // data); see the constants' own doc comments + the BL-121 PR description
  // for the measurement method.
  //
  // BL-147 REVERT (2026-07-24, owner call): back to the original 100%-scale
  // constants (see filterPanelTiers.ts), including the 458 H_TWO that folds
  // in the aspect-mode wrap fix's 100%-scale content-height addition -- with
  // that folded-in properly (not just a blind restore of the pre-147 434),
  // all five references land back on their original pre-147 tiers, 900
  // included: avail(900) = 900 - 246 = 654 >= H_TWO(458) + MARGIN_TWO(22) =
  // 480, so 900 clears two-col with room to spare at 100% scale (it only
  // fell to fallback under the 125%-inflated content sizing).
  it.each([
    [1440, "full"],
    [1080, "compact"],
    [900, "two-col"],
    [768, "two-col"],
    [560, "fallback"],
  ] as const)("viewport height %d -> tier %s", (height, expected) => {
    expect(tierForViewportHeight(height)).toBe(expected);
  });
});

// DISPOSITION (BL-144, issue #356, CREATE): pure width -> "does the docked
// sidebar + full-width table both fit side by side" decision, mirroring
// FilterPanel.css's `@media (min-width: 2266px)` docking breakpoint --
// FilterPanel.tsx's initial open/collapsed useState reads this. Component-
// level wiring (the actual initial `open` state, the user-toggle-respected
// case) lives in FilterPanel.test.tsx.
describe("fitsSideBySide (BL-144 docked breakpoint, width)", () => {
  it("is false comfortably below DOCKED_MIN_WIDTH", () => {
    expect(fitsSideBySide(1920)).toBe(false);
    expect(fitsSideBySide(1024)).toBe(false);
  });

  it("is true comfortably above DOCKED_MIN_WIDTH", () => {
    expect(fitsSideBySide(2560)).toBe(true);
  });

  it("flips exactly at the DOCKED_MIN_WIDTH boundary (>= is true, one below is false)", () => {
    expect(fitsSideBySide(DOCKED_MIN_WIDTH)).toBe(true);
    expect(fitsSideBySide(DOCKED_MIN_WIDTH - 1)).toBe(false);
  });

  it("DOCKED_MIN_WIDTH matches FilterPanel.css's `@media (min-width: 2266px)` docking rule", () => {
    // Duplicated by hand (a CSS media query isn't introspectable from JS) --
    // this pins the two together so a future change to one without the
    // other fails loudly here instead of silently drifting.
    expect(DOCKED_MIN_WIDTH).toBe(2266);
  });
});
