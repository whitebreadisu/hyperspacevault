import { describe, it, expect } from "vitest";
import { orderVariants } from "./cardPopupShared";
import type { VariantDetail } from "../../api/baseCards";

// BL-192 (CREATE): orderVariants moved here verbatim from CardPopupRail.tsx
// so the popup shell's up/down keyboard cycle shares the exact ordering the
// rail renders. No pre-existing rail/nav test file covered this function on
// its own -- all its prior coverage was indirect, through CardPopup.test.tsx
// asserting rail row ORDER in the rendered DOM. This file adds direct unit
// coverage for the ordering rule itself (design handoff §5 / mock: base set
// first, then other source sets alphabetically, then card_number ascending
// within each set).

function makeVariant(overrides: Partial<VariantDetail> = {}): VariantDetail {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    stamped: false,
    source_set_code: "SOR",
    source_set_name: "Spark of Rebellion",
    card_number: "12",
    front_image_url: "front-1.png",
    back_image_url: null,
    stamp_group: null,
    quantity: 0,
    ...overrides,
  };
}

describe("orderVariants (BL-192, moved from CardPopupRail.tsx)", () => {
  it("puts the base set's printings before every other source set", () => {
    const baseA = makeVariant({ variant_id: 1, source_set_code: "SOR", card_number: "12" });
    const other = makeVariant({ variant_id: 2, source_set_code: "ASH", card_number: "1" });
    const baseB = makeVariant({ variant_id: 3, source_set_code: "SOR", card_number: "12" });

    const ordered = orderVariants([other, baseA, baseB], "SOR");

    expect(ordered.map((v) => v.variant_id)).toEqual([1, 3, 2]);
  });

  it("orders non-base source sets alphabetically by set code", () => {
    const zSet = makeVariant({ variant_id: 1, source_set_code: "SORP", card_number: "1" });
    const aSet = makeVariant({ variant_id: 2, source_set_code: "ASH", card_number: "1" });

    const ordered = orderVariants([zSet, aSet], "SOR");

    expect(ordered.map((v) => v.source_set_code)).toEqual(["ASH", "SORP"]);
  });

  it("orders printings within the same source set by card_number, numerically not lexically", () => {
    const num9 = makeVariant({ variant_id: 1, source_set_code: "SOR", card_number: "9" });
    const num10 = makeVariant({ variant_id: 2, source_set_code: "SOR", card_number: "10" });
    const num2 = makeVariant({ variant_id: 3, source_set_code: "SOR", card_number: "2" });

    const ordered = orderVariants([num10, num9, num2], "SOR");

    // Lexical sort would put "10" before "2" and "9" -- confirms the
    // Number() coercion, not a plain string compare.
    expect(ordered.map((v) => v.card_number)).toEqual(["2", "9", "10"]);
  });

  it("sorts a non-numeric card_number to the end within its set", () => {
    const numeric = makeVariant({ variant_id: 1, source_set_code: "SOR", card_number: "5" });
    const nonNumeric = makeVariant({ variant_id: 2, source_set_code: "SOR", card_number: "P1" });

    const ordered = orderVariants([nonNumeric, numeric], "SOR");

    expect(ordered.map((v) => v.variant_id)).toEqual([1, 2]);
  });

  it("does not mutate the input array", () => {
    const variants = [
      makeVariant({ variant_id: 2, source_set_code: "ASH", card_number: "1" }),
      makeVariant({ variant_id: 1, source_set_code: "SOR", card_number: "12" }),
    ];
    const original = [...variants];

    orderVariants(variants, "SOR");

    expect(variants).toEqual(original);
  });
});
