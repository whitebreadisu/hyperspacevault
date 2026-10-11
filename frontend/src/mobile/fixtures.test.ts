import { describe, expect, it } from "vitest";
import type { BaseCardCatalog } from "../api/baseCards";
import type { VariantQuantity } from "../api/inventory";
import type { LimitsResponseBody } from "../api/settingsLimits";
import type { CardSet } from "../api/sets";
import cards from "../../e2e/mobile/fixtures/base-cards.json";
import big from "../../e2e/mobile/fixtures/base-cards-600.json";
import limits from "../../e2e/mobile/fixtures/limits.json";
import quantities from "../../e2e/mobile/fixtures/quantities.json";
import sets from "../../e2e/mobile/fixtures/sets.json";

// The typed assignments below fail `tsc -b` if a fixture drifts from the app's
// own API types; the assertions pin the shapes the e2e suite relies on.
describe("S1-10 e2e fixtures type-check against the API types", () => {
  it("base-cards.json is BaseCardCatalog[]", () => {
    const typed: BaseCardCatalog[] = cards;
    expect(typed).toHaveLength(53);
    expect(typed.every((c) => c.variants.length > 0)).toBe(true);
  });

  it("base-cards-600.json has 600 distinct rows", () => {
    const typed: BaseCardCatalog[] = big;
    expect(new Set(typed.map((c) => c.id)).size).toBe(600);
    const ids = typed.flatMap((c) => c.variants.map((v) => v.variant_id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sets, quantities and limits match their API shapes", () => {
    const s: CardSet[] = sets;
    const q: VariantQuantity[] = quantities;
    const l: LimitsResponseBody = limits as LimitsResponseBody;
    expect(s).toHaveLength(28);
    expect(q.length).toBeGreaterThan(30);
    expect(l.limits).toHaveLength(30);
  });
});
