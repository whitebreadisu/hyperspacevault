import { describe, it, expect } from "vitest";
import {
  CANONICAL_BUCKETS,
  CHANNEL_BUCKETS,
  DEFAULT_LIMITS,
  FINISH_BUCKETS,
  QUANTITY_CEILING,
  effectiveLimit,
  enforcementCap,
  limitBucketOf,
  matrixKey,
  toMatrix,
  typeCategoryOf,
} from "./limits";
import type { LimitCell } from "../api/settingsLimits";

// DISPOSITION (BL-25, CREATE): net-new pure limit-resolution core -- the
// frontend mirror of the backend's app/services/limits.py +
// swuapi_classify.py vocabulary. No prior behavior to port; the enforcement
// call sites' own port/replace dispositions live in addCardsResolver.test.ts
// and CardPopup.test.tsx.

function cell(overrides: Partial<LimitCell>): LimitCell {
  return {
    type_category: "standard",
    limit_bucket: "Standard",
    max_quantity: 3,
    is_default: true,
    ...overrides,
  };
}

describe("canonical bucket vocabulary", () => {
  it("has 8 finishes + 7 channels = 15 buckets, finishes first", () => {
    expect(FINISH_BUCKETS).toHaveLength(8);
    expect(CHANNEL_BUCKETS).toHaveLength(7);
    expect(CANONICAL_BUCKETS).toHaveLength(15);
    expect(CANONICAL_BUCKETS.slice(0, 8)).toEqual([...FINISH_BUCKETS]);
    expect(CANONICAL_BUCKETS.slice(8)).toEqual([...CHANNEL_BUCKETS]);
  });
});

describe("typeCategoryOf", () => {
  it("classifies Leader and Base as singleton", () => {
    expect(typeCategoryOf("Leader")).toBe("singleton");
    expect(typeCategoryOf("Base")).toBe("singleton");
  });

  it("classifies everything else as standard", () => {
    expect(typeCategoryOf("Unit")).toBe("standard");
    expect(typeCategoryOf("Event")).toBe("standard");
    expect(typeCategoryOf("Upgrade")).toBe("standard");
  });
});

describe("limitBucketOf", () => {
  it("uses the finish when present", () => {
    expect(limitBucketOf("Hyperspace Foil", "Retail")).toBe("Hyperspace Foil");
  });

  it("falls back to the channel when finish is null", () => {
    expect(limitBucketOf(null, "Weekly Play")).toBe("Weekly Play");
  });
});

describe("effectiveLimit / enforcementCap", () => {
  const matrix = toMatrix([
    cell({ type_category: "standard", limit_bucket: "Standard", max_quantity: 3 }),
    cell({
      type_category: "standard",
      limit_bucket: "Showcase",
      max_quantity: 1,
      is_default: false,
    }),
    cell({
      type_category: "standard",
      limit_bucket: "Weekly Play",
      max_quantity: null,
      is_default: false,
    }),
    cell({
      type_category: "singleton",
      limit_bucket: "Standard",
      max_quantity: 4,
      is_default: false,
    }),
  ]);

  it("unfetched (null matrix) falls back to the code defaults", () => {
    expect(effectiveLimit(null, "standard", "Standard")).toBe(DEFAULT_LIMITS.standard);
    expect(effectiveLimit(null, "singleton", "Showcase")).toBe(DEFAULT_LIMITS.singleton);
    expect(enforcementCap(null, "standard", "Standard")).toBe(3);
    expect(enforcementCap(null, "singleton", "Standard")).toBe(1);
  });

  it("returns the fetched cell's value (default and override alike)", () => {
    expect(effectiveLimit(matrix, "standard", "Standard")).toBe(3);
    expect(effectiveLimit(matrix, "standard", "Showcase")).toBe(1);
    expect(effectiveLimit(matrix, "singleton", "Standard")).toBe(4);
  });

  it('"No limit" (null) is preserved by effectiveLimit but mapped to the 999 ceiling by enforcementCap', () => {
    expect(effectiveLimit(matrix, "standard", "Weekly Play")).toBeNull();
    expect(enforcementCap(matrix, "standard", "Weekly Play")).toBe(QUANTITY_CEILING);
  });

  it("a cell missing from a fetched matrix falls back to the code default", () => {
    // Shouldn't happen (GET returns the full matrix) -- guard behavior.
    expect(effectiveLimit(matrix, "singleton", "Judge")).toBe(1);
    expect(enforcementCap(matrix, "standard", "Judge")).toBe(3);
  });
});

describe("toMatrix / matrixKey", () => {
  it("indexes cells by (category, bucket)", () => {
    const cells = [
      cell({ type_category: "singleton", limit_bucket: "Judge", max_quantity: 2 }),
      cell({ type_category: "standard", limit_bucket: "Judge", max_quantity: 5 }),
    ];
    const matrix = toMatrix(cells);
    expect(matrix[matrixKey("singleton", "Judge")]?.max_quantity).toBe(2);
    expect(matrix[matrixKey("standard", "Judge")]?.max_quantity).toBe(5);
  });
});
