import { describe, it, expect } from "vitest";
import {
  CANONICAL_BUCKETS,
  CHANNEL_BUCKETS,
  DEFAULT_LIMITS,
  FINISH_BUCKETS,
  QUANTITY_CEILING,
  cardOverCap,
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

// CREATE (BL-217, Issue #126): the Vault's "over my keep limit" filter
// predicate -- pure unit coverage of cardOverCap, independent of the
// CardsPage wiring tests (screens/cards/CardsPage.test.tsx).
describe("cardOverCap", () => {
  function variant(
    overrides: Partial<{
      finish: string | null;
      channel: string;
      quantity: number;
    }> = {}
  ) {
    return { finish: "Standard", channel: "Retail", quantity: 0, ...overrides };
  }

  it("is false when no variant exceeds its (code-default) effective limit", () => {
    const variants = [variant({ quantity: 3 })];
    expect(cardOverCap(variants, "Unit", null)).toBe(false);
  });

  it("is true via an explicit override limit lower than the owned quantity", () => {
    const limits = toMatrix([
      cell({
        type_category: "standard",
        limit_bucket: "Standard",
        max_quantity: 2,
        is_default: false,
      }),
    ]);
    const variants = [variant({ quantity: 3 })];
    expect(cardOverCap(variants, "Unit", limits)).toBe(true);
  });

  it("is true when a previously-fine quantity is stranded by a LOWERED limit", () => {
    // Owned 3 copies under the code default (standard = 3, not over-cap) --
    // the tenant then dials the Standard bucket down to 1, stranding the
    // existing 3 copies over the new limit without the quantity itself
    // changing.
    const before = toMatrix([]);
    const variants = [variant({ quantity: 3 })];
    expect(cardOverCap(variants, "Unit", before)).toBe(false);

    const after = toMatrix([
      cell({
        type_category: "standard",
        limit_bucket: "Standard",
        max_quantity: 1,
        is_default: false,
      }),
    ]);
    expect(cardOverCap(variants, "Unit", after)).toBe(true);
  });

  it('a bucket set to "No limit" (null) is never over-cap, regardless of quantity', () => {
    const limits = toMatrix([
      cell({
        type_category: "standard",
        limit_bucket: "Standard",
        max_quantity: null,
        is_default: false,
      }),
    ]);
    // Even a quantity well past the 999 technical ceiling would not qualify
    // -- the ceiling is irrelevant to this predicate (spec point 2).
    const variants = [variant({ quantity: 999 })];
    expect(cardOverCap(variants, "Unit", limits)).toBe(false);
  });

  it("checks every variant, not just the first -- a later variant over cap still qualifies the card", () => {
    const limits = toMatrix([
      cell({ type_category: "standard", limit_bucket: "Foil", max_quantity: 1, is_default: false }),
    ]);
    const variants = [
      variant({ finish: "Standard", quantity: 3 }), // at the code default, not over
      variant({ finish: "Foil", quantity: 2 }), // over the overridden Foil limit
    ];
    expect(cardOverCap(variants, "Unit", limits)).toBe(true);
  });

  it("resolves the bucket to the channel when finish is null (non-finish variant)", () => {
    const limits = toMatrix([
      cell({
        type_category: "standard",
        limit_bucket: "Weekly Play",
        max_quantity: 1,
        is_default: false,
      }),
    ]);
    const variants = [variant({ finish: null, channel: "Weekly Play", quantity: 2 })];
    expect(cardOverCap(variants, "Unit", limits)).toBe(true);
  });

  it("uses the singleton category (Leader/Base) rather than standard", () => {
    const limits = toMatrix([
      cell({
        type_category: "singleton",
        limit_bucket: "Standard",
        max_quantity: 1,
        is_default: false,
      }),
      cell({
        type_category: "standard",
        limit_bucket: "Standard",
        max_quantity: 3,
        is_default: false,
      }),
    ]);
    const variants = [variant({ quantity: 2 })];
    // Standard category (limit 3) would not be over-cap at 2, but Leader is
    // singleton (limit 1) -- proves the card's own type drives the category,
    // not just the bucket.
    expect(cardOverCap(variants, "Leader", limits)).toBe(true);
    expect(cardOverCap(variants, "Unit", limits)).toBe(false);
  });

  it("quantity exactly at the limit is not over-cap (strict greater-than)", () => {
    const limits = toMatrix([
      cell({
        type_category: "standard",
        limit_bucket: "Standard",
        max_quantity: 3,
        is_default: false,
      }),
    ]);
    const variants = [variant({ quantity: 3 })];
    expect(cardOverCap(variants, "Unit", limits)).toBe(false);
  });

  // CREATE (BL-222, Issue #134): the `scope` parameter -- revises BL-217's
  // original "checked against every variant regardless of scope" call. Same
  // raw-finish matching universe BL-195's scopedOwnedCount/
  // scopedPlaysetComplete use (`v.finish ?? v.variant_type`), so a
  // scope-aware caller can't disagree with the pips about which variant is
  // "the scoped one".
  describe("scope parameter (BL-222)", () => {
    function scopedVariant(
      overrides: Partial<{
        finish: string | null;
        variant_type: string;
        channel: string;
        quantity: number;
      }> = {}
    ) {
      return {
        finish: "Standard",
        variant_type: "Standard",
        channel: "Retail",
        quantity: 0,
        ...overrides,
      };
    }

    it("a scoped variant over its own cap qualifies", () => {
      const limits = toMatrix([
        cell({
          type_category: "standard",
          limit_bucket: "Hyperspace",
          max_quantity: 1,
          is_default: false,
        }),
      ]);
      const variants = [scopedVariant({ finish: "Hyperspace", quantity: 2 })];
      expect(cardOverCap(variants, "Unit", limits, "Hyperspace")).toBe(true);
    });

    it("a DIFFERENT finish's over-cap variant does NOT qualify while scoped to another finish", () => {
      const limits = toMatrix([
        cell({
          type_category: "standard",
          limit_bucket: "Hyperspace",
          max_quantity: 1,
          is_default: false,
        }),
      ]);
      const variants = [
        scopedVariant({ finish: "Standard", quantity: 3 }), // at the code default, not over
        scopedVariant({ finish: "Hyperspace", quantity: 2 }), // over its own cap, but a DIFFERENT finish
      ];
      // Scoped to Standard: the over-cap Hyperspace variant is invisible to
      // this predicate.
      expect(cardOverCap(variants, "Unit", limits, "Standard")).toBe(false);
      // Scoped to Hyperspace (the actually-over-cap finish): qualifies.
      expect(cardOverCap(variants, "Unit", limits, "Hyperspace")).toBe(true);
    });

    it("matches on variant_type when finish is null (same fallback scopedOwnedCount uses)", () => {
      const limits = toMatrix([
        cell({
          type_category: "standard",
          limit_bucket: "Weekly Play",
          max_quantity: 1,
          is_default: false,
        }),
      ]);
      const variants = [
        scopedVariant({
          finish: null,
          variant_type: "Weekly Play",
          channel: "Weekly Play",
          quantity: 2,
        }),
      ];
      expect(cardOverCap(variants, "Unit", limits, "Weekly Play")).toBe(true);
    });

    it("scope omitted or null preserves the original ANY-variant BL-217 behavior", () => {
      const limits = toMatrix([
        cell({
          type_category: "standard",
          limit_bucket: "Hyperspace",
          max_quantity: 1,
          is_default: false,
        }),
      ]);
      const variants = [
        scopedVariant({ finish: "Standard", quantity: 3 }),
        scopedVariant({ finish: "Hyperspace", quantity: 2 }),
      ];
      expect(cardOverCap(variants, "Unit", limits)).toBe(true);
      expect(cardOverCap(variants, "Unit", limits, null)).toBe(true);
    });

    it("a card with no printing of the scoped finish never qualifies while scoped, however over-cap its other variants are", () => {
      const limits = toMatrix([
        cell({
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: 1,
          is_default: false,
        }),
      ]);
      const variants = [scopedVariant({ finish: "Standard", quantity: 5 })];
      expect(cardOverCap(variants, "Unit", limits, "Hyperspace")).toBe(false);
    });
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
