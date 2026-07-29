import { describe, it, expect } from "vitest";
import {
  buildSetBreakdown,
  cardCounts,
  cardValue,
  completionPercents,
  computePanelMetrics,
  formatMoney,
  totalValue,
} from "./completion";
import type { InventoryCard, InventoryVariant } from "./inventory";

// BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): direct unit coverage
// of the completion-panel calc rules, extracted from InventorySummary.tsx.
// InventorySummary.test.tsx covers the same rules end-to-end through the
// component; this file pins the pure math in isolation (CLAUDE.md's
// test-disposition policy: new calc rules get direct tests, not just DOM
// assertions).

function makeVariant(overrides: Partial<InventoryVariant> = {}): InventoryVariant {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "1",
    front_image_url: null,
    back_image_url: null,
    quantity: 0,
    ...overrides,
  };
}

function makeCard(overrides: Partial<InventoryCard> = {}): InventoryCard {
  return {
    base_card_id: 1,
    set_code: "SOR",
    base_card_number: "1",
    name: "Card",
    subtitle: null,
    rarity: "C",
    type: "Unit",
    aspects: [],
    keywords: [],
    traits: [],
    cost: 1,
    power: 1,
    hp: 1,
    arena: "Ground",
    is_token: false,
    variants: [],
    inventory: {},
    ...overrides,
  };
}

describe("cardValue (BL-163 fallback chain)", () => {
  it("uses an owned variant's own market price × its owned quantity", () => {
    const card = makeCard({
      variants: [
        makeVariant({
          variant_id: 1,
          quantity: 2,
          price: { market: 5, low: 3, as_of: "2026-07-25" },
        }),
      ],
    });
    expect(cardValue(card, "market")).toEqual({ value: 10, unpriced: 0 });
  });

  it("uses the low price when mode is 'low'", () => {
    const card = makeCard({
      variants: [
        makeVariant({
          variant_id: 1,
          quantity: 2,
          price: { market: 5, low: 3, as_of: "2026-07-25" },
        }),
      ],
    });
    expect(cardValue(card, "low")).toEqual({ value: 6, unpriced: 0 });
  });

  it("falls back to the Standard variant's price when the owned variant has none", () => {
    const card = makeCard({
      variants: [
        makeVariant({
          variant_id: 1,
          variant_type: "Standard",
          quantity: 0,
          price: { market: 4, low: 2, as_of: "2026-07-25" },
        }),
        makeVariant({
          variant_id: 2,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          quantity: 3,
          price: null,
        }),
      ],
    });
    expect(cardValue(card, "market")).toEqual({ value: 12, unpriced: 0 });
  });

  it("falls back correctly even when the unpriced owned variant IS itself the Standard printing", () => {
    // Standard has no price of its own and there's no *other* Standard
    // variant to fall back to -- the fallback correctly resolves to null,
    // not to itself circularly succeeding.
    const card = makeCard({
      variants: [
        makeVariant({ variant_id: 1, variant_type: "Standard", quantity: 1, price: null }),
      ],
    });
    expect(cardValue(card, "market")).toEqual({ value: 0, unpriced: 1 });
  });

  it("contributes $0 and counts one unpriced owned variant when neither it nor Standard is priced", () => {
    const card = makeCard({
      variants: [
        makeVariant({ variant_id: 1, variant_type: "Standard", quantity: 0, price: null }),
        makeVariant({
          variant_id: 2,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          quantity: 3,
          price: null,
        }),
      ],
    });
    expect(cardValue(card, "market")).toEqual({ value: 0, unpriced: 1 });
  });

  it("treats an absent (`undefined`) price the same as an explicit null", () => {
    const card = makeCard({
      variants: [makeVariant({ variant_id: 1, quantity: 1 })], // no `price` key at all
    });
    expect(cardValue(card, "market")).toEqual({ value: 0, unpriced: 1 });
  });

  it("ignores unowned variants entirely, priced or not", () => {
    const card = makeCard({
      variants: [
        makeVariant({
          variant_id: 1,
          quantity: 0,
          price: { market: 99, low: 90, as_of: "2026-07-25" },
        }),
      ],
    });
    expect(cardValue(card, "market")).toEqual({ value: 0, unpriced: 0 });
  });

  it("counts one unpriced entry per unpriced owned variant, not per copy", () => {
    const card = makeCard({
      variants: [
        makeVariant({ variant_id: 1, variant_type: "Standard", quantity: 0, price: null }),
        makeVariant({
          variant_id: 2,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          quantity: 10, // ten unpriced copies -- still just 1 unpriced entry
          price: null,
        }),
      ],
    });
    expect(cardValue(card, "market")).toEqual({ value: 0, unpriced: 1 });
  });

  it("prices a Standard-market-null-but-low-priced variant as unpriced in market mode", () => {
    // Definition §3: market/low are individually nullable even when the
    // price row exists -- a variant priced only on `low` is still
    // "unpriced" under market mode, not silently coerced to $0 via `low`.
    const card = makeCard({
      variants: [
        makeVariant({
          variant_id: 1,
          quantity: 1,
          price: { market: null, low: 3, as_of: "2026-07-25" },
        }),
      ],
    });
    expect(cardValue(card, "market")).toEqual({ value: 0, unpriced: 1 });
    expect(cardValue(card, "low")).toEqual({ value: 3, unpriced: 0 });
  });
});

describe("totalValue / cardCounts (BL-163: token exclusion)", () => {
  it("excludes tokens from both value and card counts", () => {
    const nonToken = makeCard({
      base_card_id: 1,
      variants: [
        makeVariant({ variant_id: 1, quantity: 2, price: { market: 5, low: 3, as_of: "x" } }),
      ],
      inventory: { 1: 2 },
    });
    const token = makeCard({
      base_card_id: 2,
      is_token: true,
      variants: [
        makeVariant({ variant_id: 2, quantity: 100, price: { market: 50, low: 40, as_of: "x" } }),
      ],
      inventory: { 2: 100 },
    });

    expect(totalValue([nonToken, token], "market")).toEqual({ value: 10, unpricedCount: 0 });
    expect(cardCounts([nonToken, token])).toEqual({ totalCopies: 2, uniqueOwned: 1 });
  });
});

describe("completionPercents (BL-163: base-set scoping + orphan exclusion)", () => {
  it("scopes the universe to cards whose home set is in baseSetCodes", () => {
    const inBase = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      type: "Unit",
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 },
    });
    const orphan = makeCard({
      base_card_id: 2,
      set_code: "C26", // not a base set -- Definition §3's orphan case
      variants: [makeVariant({ variant_id: 2, source_set_code: "C26", quantity: 1 })],
      inventory: { 2: 1 },
    });

    const result = completionPercents([inBase, orphan], new Set(["SOR"]));
    expect(result).toEqual({ universeSize: 1, playsetPct: 100, setPct: 100 });
  });

  it("excludes tokens from the universe even when their home set is a base set", () => {
    const token = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      is_token: true,
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 },
    });
    const result = completionPercents([token], new Set(["SOR"]));
    expect(result).toEqual({ universeSize: 0, playsetPct: 0, setPct: 0 });
  });

  it("returns 0% for both percentages (no divide-by-zero) when the universe is empty", () => {
    const result = completionPercents([], new Set(["SOR"]));
    expect(result).toEqual({ universeSize: 0, playsetPct: 0, setPct: 0 });
  });

  it("computes Set complete % from 'owned at least one copy', independent of playset completeness", () => {
    const partiallyOwned = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      type: "Unit", // playset size 3
      variants: [makeVariant({ variant_id: 1, quantity: 1 })],
      inventory: { 1: 1 },
    });
    const result = completionPercents([partiallyOwned], new Set(["SOR"]));
    expect(result).toEqual({ universeSize: 1, playsetPct: 0, setPct: 100 });
  });
});

describe("computePanelMetrics (BL-163: one pass, all four metrics)", () => {
  it("combines percents, card counts, and value into one result", () => {
    const card = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      variants: [
        makeVariant({
          variant_id: 1,
          quantity: 3,
          price: { market: 2, low: 1, as_of: "2026-07-25" },
        }),
      ],
      inventory: { 1: 3 },
    });
    const result = computePanelMetrics([card], new Set(["SOR"]), "market");
    expect(result).toEqual({
      universeSize: 1,
      playsetPct: 100,
      setPct: 100,
      totalCopies: 3,
      uniqueOwned: 1,
      value: 6,
      unpricedCount: 0,
    });
  });
});

describe("buildSetBreakdown (BL-163: per-set rows, release-ordered)", () => {
  const orderedBaseSets = [
    { code: "SOR", name: "Spark of Rebellion" },
    { code: "SHD", name: "Shadows of the Galaxy" },
  ];

  it("groups by each card's home set_code, in the given set order", () => {
    const sor = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 },
    });
    const shd = makeCard({
      base_card_id: 2,
      set_code: "SHD",
      variants: [makeVariant({ variant_id: 2, source_set_code: "SHD", quantity: 0 })],
      inventory: { 2: 0 },
    });

    const rows = buildSetBreakdown([sor, shd], orderedBaseSets, "market");
    expect(rows.map((r) => r.code)).toEqual(["SOR", "SHD"]);
    expect(rows[0]).toMatchObject({ universeSize: 1, playsetPct: 100, setPct: 100 });
    expect(rows[1]).toMatchObject({ universeSize: 1, playsetPct: 0, setPct: 0 });
  });

  it("attributes a reprint to its home set_code, not the container set of a printing it owns", () => {
    // The Definition's TS26 rule: a TS26-deck reprint keeps its ORIGINAL
    // set's number and counts toward that original set -- it's a SOR base
    // card (set_code="SOR") that merely has an extra TS26-sourced printing
    // (source_set_code="TS26"). Grouping by set_code (not source_set_code)
    // gets this right with no TS26-specific logic.
    const sorCardWithTs26Reprint = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      variants: [
        makeVariant({ variant_id: 1, source_set_code: "SOR", quantity: 0 }),
        makeVariant({ variant_id: 2, source_set_code: "TS26", quantity: 1 }),
      ],
      inventory: { 1: 0, 2: 1 },
    });

    const rows = buildSetBreakdown(
      [sorCardWithTs26Reprint],
      [
        { code: "SOR", name: "Spark of Rebellion" },
        { code: "TS26", name: "2026 Twin Suns" },
      ],
      "market"
    );
    const sorRow = rows.find((r) => r.code === "SOR")!;
    const ts26Row = rows.find((r) => r.code === "TS26")!;
    expect(sorRow.universeSize).toBe(1);
    expect(sorRow.setPct).toBe(100); // owned via the TS26-sourced printing
    expect(ts26Row.universeSize).toBe(0); // no TS26-*home* card here
  });

  it("excludes orphan (non-base-set) cards from every row -- they have no set to group under", () => {
    const orphan = makeCard({
      base_card_id: 1,
      set_code: "C26",
      variants: [makeVariant({ variant_id: 1, source_set_code: "C26", quantity: 1 })],
      inventory: { 1: 1 },
    });
    const rows = buildSetBreakdown([orphan], orderedBaseSets, "market");
    expect(rows.every((r) => r.universeSize === 0)).toBe(true);
  });

  it("returns an empty array when no base sets are known yet", () => {
    const card = makeCard({ base_card_id: 1 });
    expect(buildSetBreakdown([card], [], "market")).toEqual([]);
  });
});

describe("formatMoney", () => {
  it("formats a whole number with two decimal places and a leading dollar sign", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(10)).toBe("$10.00");
  });

  it("rounds/pads to exactly two decimal places", () => {
    expect(formatMoney(1.5)).toBe("$1.50");
    expect(formatMoney(1.005)).toBe("$1.01");
  });

  it("adds thousands separators for large totals", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
  });
});
