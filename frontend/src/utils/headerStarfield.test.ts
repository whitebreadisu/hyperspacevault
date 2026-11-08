import { describe, expect, it } from "vitest";
import { HEADER_STARFIELD_CODES, pickHeaderStarfield } from "./headerStarfield";

// BL-165: random header starfield -- picker unit coverage. applyHeaderStarfield's
// DOM/localStorage side effects are deliberately thin wrappers around this pure
// picker and are exercised implicitly by App's mount (no jsdom asset loading to
// assert against); the pool/no-repeat rules are the behavior worth pinning.
describe("pickHeaderStarfield", () => {
  // PORT (BL-349): IC27's starfield shipped, so the pool is eleven (appended).
  it("draws from the eleven shipped starfield codes (no TS26 until its asset exists)", () => {
    expect(HEADER_STARFIELD_CODES).toHaveLength(11);
    expect(HEADER_STARFIELD_CODES[10]).toBe("IC27");
    expect(HEADER_STARFIELD_CODES).not.toContain("TS26");
    const picked = pickHeaderStarfield(null);
    expect(HEADER_STARFIELD_CODES).toContain(picked);
  });

  it("never repeats the previous pick when one is known", () => {
    for (const last of HEADER_STARFIELD_CODES) {
      for (let i = 0; i < 25; i++) {
        expect(pickHeaderStarfield(last)).not.toBe(last);
      }
    }
  });

  it("degrades to the full pool when the stored value is not a pool member", () => {
    // random() pinned to the last slot: with a bogus `last` nothing is
    // excluded, so the last index must still be reachable.
    // PORT (BL-349): the last slot is index 10 now the pool is eleven.
    expect(pickHeaderStarfield("BOGUS", () => 0.999)).toBe(HEADER_STARFIELD_CODES[10]);
    expect(pickHeaderStarfield(null, () => 0)).toBe(HEADER_STARFIELD_CODES[0]);
  });

  it("covers the full remaining pool across the random range", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 9; i++) {
      seen.add(pickHeaderStarfield("ASH", () => i / 9));
    }
    expect(seen.size).toBe(9);
    expect(seen.has("ASH")).toBe(false);
  });
});
