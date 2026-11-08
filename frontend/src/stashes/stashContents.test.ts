import { describe, expect, it } from "vitest";
import { phoneCard } from "../mobile/vault/phoneCardFixtures";
import {
  DEFAULT_STASH_SORT,
  narrowPrintings,
  orderByCards,
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
  it("defaults to Set | #: the printing's own number, binder order", () => {
    expect(ids(sortPrintings(rows, DEFAULT_STASH_SORT, {}, "market"))).toEqual([11, 21, 12]);
    expect(ids(sortPrintings(rows, { column: "number", direction: "desc" }, {}, "market"))).toEqual(
      [12, 21, 11]
    );
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
  it("orders by an outside card list for the phone's other sorts", () => {
    expect(ids(orderByCards(rows, [VADER, LUKE], {}))).toEqual([21, 11, 12]);
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
