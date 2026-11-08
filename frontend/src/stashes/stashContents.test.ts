import { describe, expect, it } from "vitest";
import { phoneCard } from "../mobile/vault/phoneCardFixtures";
import {
  DEFAULT_STASH_SORT,
  narrowPrintings,
  nextStashSort,
  printingLabel,
  returnSentence,
  sortPrintings,
  stashChipClass,
  stashPrintings,
  stashTotals,
  totalPrice,
  unitPrice,
} from "./stashContents";

// The Stashes page's model: printing-level rows joined from the catalogue,
// the Vault's filters narrowing them, Market / Low values (own price, else
// the card's Standard price, else none), the Set | # binder order, and the
// feedback sentence.

const LUKE = phoneCard({
  id: 1,
  name: "Luke Skywalker",
  subtitle: "Faithful Friend",
  number: "5",
  variants: [
    { id: 11, finish: "Standard", number: "5", qty: 2, market: 4 },
    { id: 12, finish: "Hyperspace", number: "269", qty: 1, market: null },
  ],
});
const VADER = phoneCard({
  id: 2,
  name: "Darth Vader",
  type: "Leader",
  number: "10",
  rarity: "Common",
  variants: [{ id: 21, finish: "Standard", number: "10", qty: 1, market: 2 }],
});
const CARDS = [LUKE, VADER];
const ITEMS = [
  { variant_id: 11, quantity: 2 },
  { variant_id: 12, quantity: 1 },
  { variant_id: 21, quantity: 1 },
];

describe("stashPrintings", () => {
  it("makes one row per printing, two printings of one card are two rows", () => {
    const rows = stashPrintings(CARDS, ITEMS);
    expect(rows.map((r) => [r.variant.variant_id, r.qty])).toEqual([
      [11, 2],
      [12, 1],
      [21, 1],
    ]);
    expect(printingLabel(rows[1])).toBe("Luke Skywalker · Hyperspace");
  });

  it("skips zero quantities and printings the catalogue does not carry", () => {
    expect(
      stashPrintings(CARDS, [
        { variant_id: 11, quantity: 0 },
        { variant_id: 999, quantity: 3 },
      ])
    ).toEqual([]);
  });
});

describe("values", () => {
  const [std, hyp, vader] = stashPrintings(CARDS, ITEMS);
  it("uses the printing's own price, else its card's Standard price", () => {
    expect(unitPrice(std, "market")).toBe(4);
    expect(unitPrice(hyp, "market")).toBe(4);
    expect(totalPrice(std, "market")).toBe(8);
    expect(unitPrice(std, "low")).toBe(2);
  });
  it("totals copies and value", () => {
    expect(stashTotals([std, hyp, vader], "market")).toEqual({ copies: 4, value: 14 });
  });
  it("greens the chip at a playset (leaders 1), mutes it at 0", () => {
    expect(stashChipClass(2, LUKE)).toBe("playset-chip");
    expect(stashChipClass(3, LUKE)).toContain("playset-chip--complete");
    expect(stashChipClass(1, VADER)).toContain("playset-chip--complete");
    expect(stashChipClass(0, LUKE)).toContain("playset-chip--empty");
  });
});

describe("narrowPrintings (the Vault's filters)", () => {
  const rows = stashPrintings(CARDS, ITEMS);
  it("keeps the rows whose card is in the Vault's narrowed list", () => {
    expect(narrowPrintings(rows, [VADER], new Set()).map((r) => r.variant.variant_id)).toEqual([
      21,
    ]);
  });
  it("applies the Finish facet per printing", () => {
    expect(
      narrowPrintings(rows, CARDS, new Set(["Hyperspace"])).map((r) => r.variant.variant_id)
    ).toEqual([12]);
  });
});

describe("sortPrintings", () => {
  const rows = stashPrintings(CARDS, ITEMS);
  const ids = (rs: typeof rows) => rs.map((r) => r.variant.variant_id);
  // Replaces "defaults to Set | #: the printing's own number" (R1-15,
  // 2026-11-08: the default is now the base card number, then the
  // printing's own number, so a card's printings sit together).
  it("defaults to Set | # by base card: a card's printings together, then their own numbers", () => {
    expect(DEFAULT_STASH_SORT).toEqual({ column: "base", direction: "asc" });
    expect(ids(sortPrintings(rows, DEFAULT_STASH_SORT, {}, "market"))).toEqual([11, 12, 21]);
    expect(ids(sortPrintings(rows, { column: "base", direction: "desc" }, {}, "market"))).toEqual([
      21, 12, 11,
    ]);
  });
  it("sorts Set | # by the printing's own number when asked", () => {
    expect(ids(sortPrintings(rows, { column: "number", direction: "asc" }, {}, "market"))).toEqual([
      11, 21, 12,
    ]);
    expect(ids(sortPrintings(rows, { column: "number", direction: "desc" }, {}, "market"))).toEqual(
      [12, 21, 11]
    );
  });
  it("orders base card numbers across sets by release, then number", () => {
    const twi = phoneCard({
      id: 3,
      name: "Han Solo",
      set: "TWI",
      number: "2",
      variants: [{ id: 31, finish: "Standard", number: "2", set: "TWI" }],
    });
    const set = stashPrintings([...CARDS, twi], [...ITEMS, { variant_id: 31, quantity: 1 }]);
    const order = ids(sortPrintings(set, DEFAULT_STASH_SORT, {}, "market"));
    // TWI is a newer main set than SOR: newest main set first, as everywhere.
    expect(order[0]).toBe(31);
    expect(order.slice(1)).toEqual([11, 12, 21]);
  });
  it("sorts by name, in-stash count and value", () => {
    expect(ids(sortPrintings(rows, { column: "name", direction: "asc" }, {}, "market"))).toEqual([
      21, 11, 12,
    ]);
    expect(ids(sortPrintings(rows, { column: "qty", direction: "desc" }, {}, "market"))[0]).toBe(
      11
    );
    expect(ids(sortPrintings(rows, { column: "value", direction: "asc" }, {}, "market"))).toEqual([
      21, 12, 11,
    ]);
  });
  it("sorts by rarity, ties by base card", () => {
    expect(ids(sortPrintings(rows, { column: "rarity", direction: "asc" }, {}, "market"))).toEqual([
      21, 11, 12,
    ]);
  });
  it("sorts Recently stashed by each row's stash time; unknown times last", () => {
    const at: Record<number, string> = {
      11: "2026-11-01T10:00:00",
      21: "2026-11-08T09:00:00",
    };
    const timed = stashPrintings(CARDS, ITEMS, (vid) => at[vid] ?? null);
    expect(timed.map((r) => r.stashedAt)).toEqual([at[11], null, at[21]]);
    expect(
      ids(sortPrintings(timed, { column: "recent", direction: "desc" }, {}, "market"))
    ).toEqual([21, 11, 12]);
    expect(ids(sortPrintings(timed, { column: "recent", direction: "asc" }, {}, "market"))).toEqual(
      [11, 21, 12]
    );
  });
  // Retires "orders by an outside card list for the phone's other sorts"
  // (orderByCards): R1-16, 2026-11-08 -- the phone stash screen sorts with
  // the stash's own sort control (sortPrintings), not the Vault's card order.
  it("keeps several hundred printings in base order with every card's printings adjacent", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      phoneCard({
        id: 1000 + i,
        name: `Card ${i}`,
        number: String(300 - i),
        variants: [
          { id: 10000 + i * 2, finish: "Standard", number: String(300 - i) },
          { id: 10001 + i * 2, finish: "Hyperspace", number: String(600 - i) },
        ],
      })
    );
    const items = many.flatMap((c) =>
      c.variants.map((v) => ({ variant_id: v.variant_id, quantity: 1 }))
    );
    const sorted = sortPrintings(stashPrintings(many, items), DEFAULT_STASH_SORT, {}, "market");
    expect(sorted).toHaveLength(600);
    for (let i = 0; i < sorted.length; i += 2) {
      expect(sorted[i].card.base_card_id).toBe(sorted[i + 1].card.base_card_id);
      expect(sorted[i].variant.finish).toBe("Standard");
    }
    expect(sorted[0].card.base_card_number).toBe("1");
  });
});

describe("sortPrintings tiebreaks", () => {
  const ids = (rs: ReturnType<typeof stashPrintings>) => rs.map((r) => r.variant.variant_id);
  it("keeps two base cards that share a set and base number apart (in-set collision)", () => {
    // Two cards both numbered SOR 13; printings interleave by number unless
    // the base card id breaks the tie first.
    const a = phoneCard({
      id: 40,
      name: "Alpha",
      number: "13",
      variants: [
        { id: 401, finish: "Standard", number: "13" },
        { id: 402, finish: "Hyperspace", number: "300" },
      ],
    });
    const b = phoneCard({
      id: 41,
      name: "Beta",
      number: "13",
      variants: [
        { id: 411, finish: "Standard", number: "14" },
        { id: 412, finish: "Hyperspace", number: "290" },
      ],
    });
    const rows = stashPrintings(
      [b, a],
      [411, 412, 401, 402].map((variant_id) => ({ variant_id, quantity: 1 }))
    );
    expect(ids(sortPrintings(rows, DEFAULT_STASH_SORT, {}, "market"))).toEqual([
      401, 402, 411, 412,
    ]);
  });
  it("orders printings that share one number by printing id (stable)", () => {
    const sec = phoneCard({
      id: 50,
      name: "Prestige",
      number: "7",
      variants: [
        { id: 503, finish: "Serialized", number: "7" },
        { id: 501, finish: "Serialized", number: "7" },
        { id: 502, finish: "Serialized", number: "7" },
      ],
    });
    const rows = stashPrintings(
      [sec],
      [503, 501, 502].map((variant_id) => ({ variant_id, quantity: 1 }))
    );
    expect(ids(sortPrintings(rows, DEFAULT_STASH_SORT, {}, "market"))).toEqual([501, 502, 503]);
    expect(ids(sortPrintings(rows, { column: "number", direction: "asc" }, {}, "market"))).toEqual([
      501, 502, 503,
    ]);
  });
});

describe("nextStashSort", () => {
  it("lands a new column ascending and flips the active one", () => {
    expect(nextStashSort(DEFAULT_STASH_SORT, "name")).toEqual({ column: "name", direction: "asc" });
    expect(nextStashSort({ column: "name", direction: "asc" }, "name")).toEqual({
      column: "name",
      direction: "desc",
    });
    expect(nextStashSort(DEFAULT_STASH_SORT, "number")).toEqual({
      column: "number",
      direction: "asc",
    });
  });
  it("lands Recently stashed newest first", () => {
    expect(nextStashSort(DEFAULT_STASH_SORT, "recent")).toEqual({
      column: "recent",
      direction: "desc",
    });
  });
});

describe("returnSentence", () => {
  const [std, hyp] = stashPrintings(CARDS, ITEMS);
  it("names one printing", () => {
    expect(returnSentence([{ row: std, quantity: 1 }])).toBe(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    expect(returnSentence([{ row: std, quantity: 2 }])).toBe(
      "2 Luke Skywalker · Standard are back in your Vault."
    );
  });
  it("counts copies across several", () => {
    expect(
      returnSentence([
        { row: std, quantity: 2 },
        { row: hyp, quantity: 1 },
      ])
    ).toBe("3 copies are back in your Vault.");
  });
});
