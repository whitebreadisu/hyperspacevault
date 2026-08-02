import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardCollectionValue,
  cardValuePrice,
  formatCardValue,
  isFinishSetScopedTo,
  loadPriceKind,
  loadValueDisplay,
  savePriceKind,
  saveValueDisplay,
  scopeShortName,
  scopedCardNumber,
  scopedOwnedCount,
  sortCardsByScope,
  SCOPE_EXPANDED_ROWS,
  SCOPE_PINNED_ROWS,
} from "./variantScope";
import { sortBaseCards } from "./catalog";
import type { InventoryVariant } from "./inventory";
import type { BaseCard } from "./catalog";

// BL-173 (Definition_VariantScope_2026-07-26.md): unit coverage for the pure
// scope/value logic backing the Cards table's variant-scope control + Value
// column. Component-level wiring (CardsTable/PlaysetCell/CardsPage) is
// covered separately in those files' own test suites.

function makeVariant(overrides: Partial<InventoryVariant> = {}): InventoryVariant {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "001",
    front_image_url: null,
    back_image_url: null,
    quantity: 0,
    ...overrides,
  };
}

describe("cardValuePrice", () => {
  it("unscoped: returns the Standard printing's market price", () => {
    const variants = [
      makeVariant({
        variant_id: 1,
        variant_type: "Standard",
        finish: "Standard",
        price: { market: 5, low: 4, as_of: "2026-07-26" },
      }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        price: { market: 20, low: 18, as_of: "2026-07-26" },
      }),
    ];
    expect(cardValuePrice(variants, null, "market")).toBe(5);
    expect(cardValuePrice(variants, null, "low")).toBe(4);
  });

  it("unscoped fallback: no Standard printing at all -- falls back to the minimum priced printing (active kind)", () => {
    const variants = [
      makeVariant({
        variant_id: 1,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        price: { market: 20, low: 18, as_of: "2026-07-26" },
      }),
      makeVariant({
        variant_id: 2,
        variant_type: "Showcase",
        finish: "Showcase",
        price: { market: 300, low: 250, as_of: "2026-07-26" },
      }),
    ];
    expect(cardValuePrice(variants, null, "market")).toBe(20);
    expect(cardValuePrice(variants, null, "low")).toBe(18);
  });

  it("unscoped fallback: Standard printing exists but is unpriced -- falls back to the min-priced OTHER printing", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", price: null }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        price: { market: 20, low: 18, as_of: "2026-07-26" },
      }),
      makeVariant({
        variant_id: 3,
        variant_type: "Hyperspace Foil",
        finish: "Hyperspace Foil",
        price: { market: 55, low: 48, as_of: "2026-07-26" },
      }),
    ];
    expect(cardValuePrice(variants, null, "market")).toBe(20);
  });

  it("unscoped: no priced printing anywhere -- null (em-dash)", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", price: null }),
      makeVariant({ variant_id: 2, variant_type: "Hyperspace", finish: "Hyperspace" }), // price undefined
    ];
    expect(cardValuePrice(variants, null, "market")).toBeNull();
  });

  it("scoped: returns the scoped variant's own price for the active kind", () => {
    const variants = [
      makeVariant({
        variant_id: 1,
        variant_type: "Standard",
        finish: "Standard",
        price: { market: 5, low: 4, as_of: "2026-07-26" },
      }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace Foil",
        finish: "Hyperspace Foil",
        price: { market: 55, low: 48, as_of: "2026-07-26" },
      }),
    ];
    expect(cardValuePrice(variants, "Hyperspace Foil", "market")).toBe(55);
    expect(cardValuePrice(variants, "Hyperspace Foil", "low")).toBe(48);
    // Scoping does NOT fall back to Standard/min -- a scoped miss is null.
    expect(cardValuePrice(variants, "Showcase", "market")).toBeNull();
  });

  it("scoped: the scoped variant exists but is unpriced -- null, no fallback to Standard", () => {
    const variants = [
      makeVariant({
        variant_id: 1,
        variant_type: "Standard",
        finish: "Standard",
        price: { market: 5, low: 4, as_of: "2026-07-26" },
      }),
      makeVariant({ variant_id: 2, variant_type: "Hyperspace", finish: "Hyperspace", price: null }),
    ];
    expect(cardValuePrice(variants, "Hyperspace", "market")).toBeNull();
  });

  // Definition §3: `undefined` (stale cache, key absent) and `null`
  // (priced-nothing) are two different real-world states but both mean "no
  // price for THIS variant" to the fallback math -- same fold
  // utils/completion.ts's variantPrice already uses. Proven directly rather
  // than assumed: both degrade identically through the unscoped fallback.
  it("treats a variant's undefined price (stale cache) the same as an explicit null price", () => {
    const withNull = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", price: null }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        price: { market: 12, low: 10, as_of: "x" },
      }),
    ];
    const withUndefined = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard" }), // price undefined
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        price: { market: 12, low: 10, as_of: "x" },
      }),
    ];
    expect(cardValuePrice(withNull, null, "market")).toBe(12);
    expect(cardValuePrice(withUndefined, null, "market")).toBe(12);
  });

  it("falls back to a variant with only ONE of market/low priced (the other individually null)", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", price: null }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        price: { market: 12, low: null, as_of: "x" },
      }),
    ];
    expect(cardValuePrice(variants, null, "market")).toBe(12);
    expect(cardValuePrice(variants, null, "low")).toBeNull();
  });
});

describe("formatCardValue", () => {
  it("formats a sub-$100 price to two decimals with a leading dollar sign", () => {
    expect(formatCardValue(5)).toBe("$5.00");
    expect(formatCardValue(4.5)).toBe("$4.50");
    expect(formatCardValue(99.994)).toBe("$99.99");
  });

  it("formats $100+ as whole dollars per the owner's mock (showcase range)", () => {
    expect(formatCardValue(100)).toBe("$100");
    expect(formatCardValue(325)).toBe("$325");
    expect(formatCardValue(1234.567)).toBe("$1235");
  });

  it("renders an em-dash for null (unpriced)", () => {
    expect(formatCardValue(null)).toBe("—");
  });
});

describe("scopedOwnedCount", () => {
  it("sums quantity across every variant matching the scoped finish", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", quantity: 2 }),
      makeVariant({ variant_id: 2, variant_type: "Hyperspace", finish: "Hyperspace", quantity: 1 }),
    ];
    expect(scopedOwnedCount(variants, "Standard")).toBe(2);
    expect(scopedOwnedCount(variants, "Hyperspace")).toBe(1);
  });

  it("returns 0 for a finish the card has no printing of", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", quantity: 3 }),
    ];
    expect(scopedOwnedCount(variants, "Showcase")).toBe(0);
  });

  it("falls back to variant_type when finish is null (non-frozen finishes)", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Weekly Play", finish: null, quantity: 1 }),
    ];
    expect(scopedOwnedCount(variants, "Weekly Play")).toBe(1);
  });
});

// CREATE (BL-187, Definition_VariantNumberSort_2026-08-02.md): the # column's
// scoped card_number -- same find-first-match rule as scopedOwnedCount above,
// but resolving to the matching variant's OWN card_number instead of a
// summed quantity.
describe("scopedCardNumber", () => {
  it("null scope -- always null (caller falls back to base_card_number)", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", card_number: "1" }),
    ];
    expect(scopedCardNumber(variants, null)).toBeNull();
  });

  it("scoped match -- returns THAT variant's own card_number, not base_card_number", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", card_number: "019" }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        card_number: "508",
      }),
    ];
    expect(scopedCardNumber(variants, "Hyperspace")).toBe("508");
  });

  it("first of multiple matches wins (same caveat as scopedOwnedCount)", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", card_number: "1" }),
      makeVariant({ variant_id: 2, variant_type: "Standard", finish: "Standard", card_number: "2" }),
    ];
    expect(scopedCardNumber(variants, "Standard")).toBe("1");
  });

  it("no match -- null (caller falls back to base_card_number)", () => {
    const variants = [
      makeVariant({ variant_id: 1, variant_type: "Standard", finish: "Standard", card_number: "1" }),
    ];
    expect(scopedCardNumber(variants, "Showcase")).toBeNull();
  });
});

// CREATE (BL-187): the Cards table's row order while a scope is active.
// sortBaseCards' own suite (utils/catalog.test.ts) already covers the
// set-release / tokens-last precedence in full -- this suite only proves the
// scoped variant differs from sortBaseCards' behavior in exactly the final
// tiebreak, plus the null-scope passthrough and the no-match fallback.
describe("sortCardsByScope", () => {
  function makeCard(overrides: Partial<BaseCard> = {}): BaseCard {
    return {
      base_card_id: 1,
      set_code: "SOR",
      base_card_number: "1",
      name: "Card",
      subtitle: null,
      type: "Unit",
      rarity: "C",
      aspects: [],
      keywords: [],
      traits: [],
      cost: null,
      power: null,
      hp: null,
      arena: null,
      is_token: false,
      variants: [],
      ...overrides,
    };
  }

  function makeCatalogVariant(overrides: Partial<BaseCard["variants"][number]> = {}) {
    return {
      variant_id: 1,
      variant_type: "Standard",
      finish: "Standard" as string | null,
      channel: "Retail",
      source_set_code: "SOR",
      card_number: "1",
      front_image_url: null,
      back_image_url: null,
      ...overrides,
    };
  }

  it("scope null -- identical to sortBaseCards", () => {
    const high = makeCard({
      base_card_id: 1,
      base_card_number: "10",
      variants: [makeCatalogVariant({ card_number: "10" })],
    });
    const low = makeCard({
      base_card_id: 2,
      base_card_number: "2",
      variants: [makeCatalogVariant({ card_number: "2" })],
    });
    const bySortBaseCards = sortBaseCards([high, low]);
    const byScope = sortCardsByScope([high, low], {}, null);
    expect(byScope.map((c) => c.base_card_id)).toEqual(bySortBaseCards.map((c) => c.base_card_id));
    expect(byScope.map((c) => c.base_card_id)).toEqual([2, 1]);
  });

  it("scoped: orders by the SCOPED variant's card_number, numeric, overriding base_card_number order", () => {
    // Mirrors the real early-set fact: base_card_number order (1, 2) is the
    // OPPOSITE of the Hyperspace printing's own numbering (508, 019).
    const cardA = makeCard({
      base_card_id: 1,
      base_card_number: "1",
      variants: [
        makeCatalogVariant({ variant_id: 11, card_number: "1" }),
        makeCatalogVariant({
          variant_id: 12,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          card_number: "508",
        }),
      ],
    });
    const cardB = makeCard({
      base_card_id: 2,
      base_card_number: "2",
      variants: [
        makeCatalogVariant({ variant_id: 21, card_number: "2" }),
        makeCatalogVariant({
          variant_id: 22,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          card_number: "019",
        }),
      ],
    });
    const result = sortCardsByScope([cardA, cardB], {}, "Hyperspace");
    expect(result.map((c) => c.base_card_id)).toEqual([2, 1]);
  });

  it("a card with no matching variant falls back to base_card_number for the comparison", () => {
    const noMatch = makeCard({
      base_card_id: 1,
      base_card_number: "5",
      variants: [makeCatalogVariant({ card_number: "5" })],
    });
    const matched = makeCard({
      base_card_id: 2,
      base_card_number: "9",
      variants: [
        makeCatalogVariant({
          variant_id: 21,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          card_number: "1",
        }),
      ],
    });
    // matched's scoped number ("1") sorts before noMatch's fallback ("5").
    const result = sortCardsByScope([noMatch, matched], {}, "Hyperspace");
    expect(result.map((c) => c.base_card_id)).toEqual([2, 1]);
  });

  it("preserves the set-release-order and tokens-last tiers ahead of the number tiebreak", () => {
    const shdToken = makeCard({
      base_card_id: 1,
      set_code: "SHD",
      base_card_number: "1",
      is_token: true,
      variants: [makeCatalogVariant({ card_number: "1" })],
    });
    const sorCard = makeCard({
      base_card_id: 2,
      set_code: "SOR",
      base_card_number: "1",
      variants: [makeCatalogVariant({ card_number: "1" })],
    });
    const shdCard = makeCard({
      base_card_id: 3,
      set_code: "SHD",
      base_card_number: "1",
      variants: [makeCatalogVariant({ card_number: "1" })],
    });
    const setOrder = { SOR: "2024-03-08", SHD: "2024-08-02" };
    const result = sortCardsByScope([shdToken, sorCard, shdCard], setOrder, "Standard");
    expect(result.map((c) => c.base_card_id)).toEqual([2, 3, 1]);
  });

  it("does not mutate the input array", () => {
    const cards = [
      makeCard({ base_card_id: 1, base_card_number: "9" }),
      makeCard({ base_card_id: 2, base_card_number: "1" }),
    ];
    const original = [...cards];
    sortCardsByScope(cards, {}, "Standard");
    expect(cards).toEqual(original);
  });
});

describe("isFinishSetScopedTo", () => {
  it("true only when the set is exactly the single scoped value", () => {
    expect(isFinishSetScopedTo(new Set(["Hyperspace"]), "Hyperspace")).toBe(true);
  });

  it("false when the set is empty (cleared)", () => {
    expect(isFinishSetScopedTo(new Set(), "Hyperspace")).toBe(false);
  });

  it("false when the set has additional values (panel edit added one)", () => {
    expect(isFinishSetScopedTo(new Set(["Hyperspace", "Standard"]), "Hyperspace")).toBe(false);
  });

  it("false when the set holds a different single value (panel edit swapped it)", () => {
    expect(isFinishSetScopedTo(new Set(["Standard"]), "Hyperspace")).toBe(false);
  });
});

describe("scopeShortName", () => {
  it("returns the known short display name for a raw finish value", () => {
    expect(scopeShortName("Hyperspace Foil")).toBe("HS Foil");
    expect(scopeShortName("Serialized Prestige")).toBe("Ser. Prestige");
  });

  it("falls back to the raw value itself for an unmapped value (never throws/blanks)", () => {
    expect(scopeShortName("Some Future Finish")).toBe("Some Future Finish");
  });
});

// REPLACE (BL-173 review round 4, owner): the option set evolved -- order
// mirrors the sidebar Finish filter (Standard, Hyperspace, Prestige, Weekly
// Play), Prestige moved UP into the pinned rows, Showcase left the picker
// entirely (a leaders-only playset-1 finish never made sense as a pip
// scope), and the annotations are gone. 14 scopes became 13.
describe("Scope menu data (round-4 owner revision of option set C)", () => {
  it("pinned section is 3 pair rows + the Prestige chip group, in the filter panel's order", () => {
    expect(SCOPE_PINNED_ROWS.map((r) => r.key)).toEqual([
      "Standard",
      "Hyperspace",
      "Prestige",
      "Weekly Play",
    ]);
    const prestige = SCOPE_PINNED_ROWS.find((r) => r.key === "Prestige");
    expect(prestige?.kind).toBe("group");
    expect(prestige && prestige.kind === "group" ? prestige.chips : []).toHaveLength(3);
    // Showcase is not offered anywhere in the picker.
    const allKeys = [...SCOPE_PINNED_ROWS, ...SCOPE_EXPANDED_ROWS].map((r) => r.key);
    expect(allKeys).not.toContain("Showcase");
  });

  it("expanded section is 4 plain rows with no annotations, covering 13 total scopes", () => {
    expect(SCOPE_EXPANDED_ROWS).toHaveLength(4);
    expect(SCOPE_EXPANDED_ROWS.every((r) => r.kind === "plain")).toBe(true);
    expect(SCOPE_EXPANDED_ROWS.every((r) => r.kind !== "plain" || r.note === undefined)).toBe(true);

    const pinnedRawCount = SCOPE_PINNED_ROWS.reduce(
      (n, r) => n + (r.kind === "pair" ? 2 : r.kind === "group" ? r.chips.length : 1),
      0
    );
    const expandedRawCount = SCOPE_EXPANDED_ROWS.reduce(
      (n, r) => n + (r.kind === "pair" ? 2 : r.kind === "group" ? r.chips.length : 1),
      0
    );
    expect(pinnedRawCount + expandedRawCount).toBe(13);
  });
});

describe("price-kind persistence (loadPriceKind/savePriceKind)", () => {
  const KEY = "swu.cardsValue.kind";

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to market when nothing is stored", () => {
    expect(loadPriceKind()).toBe("market");
  });

  it("round-trips a saved 'low' kind", () => {
    savePriceKind("low");
    expect(window.localStorage.getItem(KEY)).toBe("low");
    expect(loadPriceKind()).toBe("low");
  });

  it("round-trips a saved 'market' kind", () => {
    savePriceKind("low");
    savePriceKind("market");
    expect(loadPriceKind()).toBe("market");
  });

  it("degrades to market for a corrupt/unrecognized stored value", () => {
    window.localStorage.setItem(KEY, "bogus");
    expect(loadPriceKind()).toBe("market");
  });

  it("degrades to market when storage access throws (private-mode/storage-denied)", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(loadPriceKind()).toBe("market");
    spy.mockRestore();
  });

  it("savePriceKind is best-effort -- a throwing storage write doesn't throw out to the caller", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(() => savePriceKind("low")).not.toThrow();
    spy.mockRestore();
  });
});

describe("cardCollectionValue (owner request 2026-07-31: Value column Collection mode)", () => {
  const price = (market: number | null, low: number | null) =>
    ({ market, low, as_of: "2026-07-30" }) as InventoryVariant["price"];

  it("unowned card -> null (em-dash), even when the catalog has prices", () => {
    const variants = [makeVariant({ price: price(10, 8), quantity: 0 })];
    expect(cardCollectionValue(variants, null, "market")).toBeNull();
  });

  it("sums qty x each owned variant's own price for the active kind", () => {
    const variants = [
      makeVariant({ quantity: 2, price: price(11.13, 10.31) }),
      makeVariant({
        variant_id: 2,
        variant_type: "Standard Foil",
        finish: "Standard Foil",
        quantity: 1,
        price: price(16.26, 12.99),
      }),
    ];
    expect(cardCollectionValue(variants, null, "market")).toBeCloseTo(2 * 11.13 + 16.26);
    expect(cardCollectionValue(variants, null, "low")).toBeCloseTo(2 * 10.31 + 12.99);
  });

  it("an owned unpriced variant falls back to the card's Standard price (completion.ts chain)", () => {
    const variants = [
      makeVariant({ quantity: 0, price: price(3, 2) }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        quantity: 2,
        price: null,
      }),
    ];
    expect(cardCollectionValue(variants, null, "market")).toBeCloseTo(6);
  });

  it("owned but nothing priced anywhere -> null, never a fabricated $0.00", () => {
    const variants = [makeVariant({ quantity: 3, price: null })];
    expect(cardCollectionValue(variants, null, "market")).toBeNull();
  });

  it("scoped: owned quantity OF THE SCOPED FINISH x that finish's own price", () => {
    const variants = [
      makeVariant({ quantity: 5, price: price(3.16, 2.5) }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        quantity: 2,
        price: price(7, 5),
      }),
    ];
    expect(cardCollectionValue(variants, "Hyperspace", "market")).toBeCloseTo(14);
    expect(cardCollectionValue(variants, "Hyperspace", "low")).toBeCloseTo(10);
  });

  it("scoped with zero owned copies of that finish -> null even when other finishes are owned", () => {
    const variants = [
      makeVariant({ quantity: 5, price: price(3.16, 2.5) }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        quantity: 0,
        price: price(7, 5),
      }),
    ];
    expect(cardCollectionValue(variants, "Hyperspace", "market")).toBeNull();
  });

  it("scoped unpriced printing -> null (no fallback under scope, matching unit mode's rule)", () => {
    const variants = [
      makeVariant({ quantity: 1, price: price(3, 2) }),
      makeVariant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        quantity: 2,
        price: null,
      }),
    ];
    expect(cardCollectionValue(variants, "Hyperspace", "market")).toBeNull();
  });
});

describe("value-display persistence (loadValueDisplay/saveValueDisplay)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to unit when nothing stored or the stored value is corrupt", () => {
    expect(loadValueDisplay()).toBe("unit");
    window.localStorage.setItem("swu.cardsValue.display", "garbage");
    expect(loadValueDisplay()).toBe("unit");
  });

  it("round-trips collection", () => {
    saveValueDisplay("collection");
    expect(loadValueDisplay()).toBe("collection");
    saveValueDisplay("unit");
    expect(loadValueDisplay()).toBe("unit");
  });

  it("degrades to the default when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadValueDisplay()).toBe("unit");
    spy.mockRestore();
  });
});
