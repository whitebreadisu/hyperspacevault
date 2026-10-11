import { describe, expect, it } from "vitest";
import type { InventoryCard } from "../../utils/inventory";
import { completionView, wholeMoney } from "./completionModel";

// BL-247 S1-23: desktop InventorySummary's Totals rules (BL-163 / BL-223).

function card(id: number, set: string, qty: number): InventoryCard {
  return {
    base_card_id: id,
    set_code: set,
    type: "Unit",
    is_token: false,
    inventory: { total: qty },
    variants: [
      {
        variant_id: id,
        variant_type: "Standard",
        quantity: qty,
        price: { market: 2, low: 1, as_of: "2026-10-01" },
      },
    ],
  } as unknown as InventoryCard;
}

const ALL = [card(1, "SOR", 3), card(2, "SOR", 0), card(3, "ASH", 1)];
const FILTERED = [ALL[2]];
const CODES = new Set(["SOR", "ASH"]);
const base = {
  filtered: FILTERED,
  all: ALL,
  baseSetCodes: CODES,
  priceKind: "market" as const,
};

describe("S1-23 completion header rules", () => {
  it("unnarrowed: no switch, Filtered (= the whole list), no amber", () => {
    const v = completionView({
      ...base,
      filtered: ALL,
      narrowed: false,
      isAuthenticated: true,
      scope: "all",
    });
    expect(v.showScopeToggle).toBe(false);
    expect(v.effectiveScope).toBe("filtered");
    expect(v.narrowedFiltered).toBe(false);
  });

  it("narrowed + signed in: the switch shows; Filtered = amber over the filtered list", () => {
    const v = completionView({ ...base, narrowed: true, isAuthenticated: true, scope: "filtered" });
    expect(v.showScopeToggle).toBe(true);
    expect(v.narrowedFiltered).toBe(true);
    expect(v.metrics.totalCopies).toBe(1);
    expect(v.metrics.value).toBe(2);
  });

  it("All reads every card and drops the amber", () => {
    const v = completionView({ ...base, narrowed: true, isAuthenticated: true, scope: "all" });
    expect(v.narrowedFiltered).toBe(false);
    expect(v.metrics.totalCopies).toBe(4);
  });

  it("signed out: no switch even when narrowed, never amber", () => {
    const v = completionView({ ...base, narrowed: true, isAuthenticated: false, scope: "all" });
    expect(v.showScopeToggle).toBe(false);
    expect(v.effectiveScope).toBe("filtered");
    expect(v.narrowedFiltered).toBe(false);
  });

  it("Low prices the value with the low price; money drops the cents", () => {
    const v = completionView({
      ...base,
      priceKind: "low",
      narrowed: true,
      isAuthenticated: true,
      scope: "all",
    });
    expect(v.metrics.value).toBe(4);
    expect(wholeMoney("$1,234.56")).toBe("$1,234");
  });
});
