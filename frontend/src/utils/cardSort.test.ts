import { describe, it, expect } from "vitest";
import { sortCards, nextSortState, ariaSortValue, DEFAULT_SORT_STATE } from "./cardSort";
import type { SortState, SortContext } from "./cardSort";
import type { InventoryCard, InventoryVariant } from "./inventory";

// BL-213 (Issue #122, owner-locked design): unit coverage for every column's
// comparator, the 2-state header cycling rule, and the universal
// default-order tiebreak. Fixtures are deliberately minimal (only the
// fields each test actually reads) -- InventoryCard/InventoryVariant are
// wide interfaces and most tests only care about one or two axes.

function makeVariant(
  overrides: Partial<InventoryVariant> & { variant_id: number }
): InventoryVariant {
  return {
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

function makeCard(overrides: Partial<InventoryCard> & { base_card_id: number }): InventoryCard {
  return {
    set_code: "SOR",
    base_card_number: "001",
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
    inventory: {},
    ...overrides,
  };
}

/** Default-order index built directly off the array a test hands in --
 * matches CardsPage's own construction (base_card_id -> array position). */
function contextFor(cards: InventoryCard[], overrides: Partial<SortContext> = {}): SortContext {
  return {
    scope: null,
    valueMode: "market",
    unitMode: "unit",
    setOrder: {},
    defaultIndex: new Map(cards.map((c, i) => [c.base_card_id, i])),
    ...overrides,
  };
}

function ids(cards: InventoryCard[]): number[] {
  return cards.map((c) => c.base_card_id);
}

function state(column: SortState["column"], direction: SortState["direction"]): SortState {
  return { column, direction };
}

describe("# column", () => {
  it("ascending IS the default order -- reorders by defaultIndex, not by the input array's own order", () => {
    const a = makeCard({ base_card_id: 1 });
    const b = makeCard({ base_card_id: 2 });
    const c = makeCard({ base_card_id: 3 });
    // defaultIndex says a < b < c, but the array handed to sortCards is
    // scrambled -- proves the comparator reads defaultIndex, not input order.
    const context: SortContext = {
      scope: null,
      valueMode: "market",
      unitMode: "unit",
      setOrder: {},
      defaultIndex: new Map([
        [1, 0],
        [2, 1],
        [3, 2],
      ]),
    };
    const result = sortCards([b, a, c], state("number", "asc"), context);
    expect(ids(result)).toEqual([1, 2, 3]);
  });

  it("descending keeps the set GROUP order ascending, only reversing numbers within each group", () => {
    const sor1 = makeCard({ base_card_id: 1, set_code: "SOR", base_card_number: "001" });
    const sor2 = makeCard({ base_card_id: 2, set_code: "SOR", base_card_number: "002" });
    const shd1 = makeCard({ base_card_id: 3, set_code: "SHD", base_card_number: "010" });
    const shd2 = makeCard({ base_card_id: 4, set_code: "SHD", base_card_number: "011" });
    // Default-order array: SOR before SHD (curated fallback order), numbers
    // ascending within each -- exactly what sortCardsByScope would produce.
    const defaultOrder = [sor1, sor2, shd1, shd2];
    const context = contextFor(defaultOrder);
    const result = sortCards(defaultOrder, state("number", "desc"), context);
    // SOR group still comes first (ascending set order); within it, 002
    // before 001 (numbers descending). Same for SHD.
    expect(ids(result)).toEqual([2, 1, 4, 3]);
  });

  it("uses the scoped card_number (BL-187) when a scope is active, mirroring the # column's own display rule", () => {
    const withScope = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      base_card_number: "019",
      variants: [
        makeVariant({
          variant_id: 1,
          variant_type: "Standard",
          finish: "Standard",
          card_number: "019",
        }),
        makeVariant({
          variant_id: 2,
          variant_type: "Hyperspace Foil",
          finish: "Hyperspace Foil",
          card_number: "508",
        }),
      ],
    });
    const noScope = makeCard({ base_card_id: 2, set_code: "SOR", base_card_number: "030" });
    const context = contextFor([withScope, noScope], { scope: "Hyperspace Foil" });
    // Descending, scoped: card 1's displayed number is "508" (scoped), card
    // 2 falls back to its own base_card_number "030" -- 508 > 030 so 1 sorts
    // first.
    const result = sortCards([withScope, noScope], state("number", "desc"), context);
    expect(ids(result)).toEqual([1, 2]);
  });
});

describe("Set column", () => {
  const sor1 = makeCard({ base_card_id: 1, set_code: "SOR", base_card_number: "001" });
  const sor2 = makeCard({ base_card_id: 2, set_code: "SOR", base_card_number: "002" });
  const shd1 = makeCard({ base_card_id: 3, set_code: "SHD", base_card_number: "010" });
  const shd2 = makeCard({ base_card_id: 4, set_code: "SHD", base_card_number: "011" });
  const defaultOrder = [sor1, sor2, shd1, shd2];

  it("ascending is IDENTICAL to the default order", () => {
    const context = contextFor(defaultOrder);
    const result = sortCards(defaultOrder, state("set", "asc"), context);
    expect(ids(result)).toEqual([1, 2, 3, 4]);
  });

  it("descending reverses the SET GROUP order only -- numbers stay ascending within each group", () => {
    const context = contextFor(defaultOrder);
    const result = sortCards(defaultOrder, state("set", "desc"), context);
    // SHD group now first (groups reversed), but 010 before 011 inside it --
    // numbers did NOT reverse, only the group order did.
    expect(ids(result)).toEqual([3, 4, 1, 2]);
  });
});

describe("Name column", () => {
  it("case-insensitive alphanumeric on name", () => {
    const banana = makeCard({ base_card_id: 1, name: "Banana" });
    const apple = makeCard({ base_card_id: 2, name: "apple" });
    const context = contextFor([banana, apple]);
    const result = sortCards([banana, apple], state("name", "asc"), context);
    expect(ids(result)).toEqual([2, 1]);
  });

  it("subtitle is the secondary key when names are equal", () => {
    const b = makeCard({ base_card_id: 1, name: "Vader", subtitle: "B Subtitle" });
    const a = makeCard({ base_card_id: 2, name: "Vader", subtitle: "A Subtitle" });
    const context = contextFor([b, a]);
    const result = sortCards([b, a], state("name", "asc"), context);
    expect(ids(result)).toEqual([2, 1]);
  });

  it("a Base's null subtitle sorts on its DISPLAYED subtitle (parseCardDisplay's traits[0] fallback)", () => {
    // JUDGMENT CALL (see cardSort.ts's compareName doc comment): the
    // secondary key reads the value the Name cell itself renders, not the
    // raw `subtitle` field -- a Base with a null subtitle displays its
    // first trait as its subtitle.
    const baseZ = makeCard({
      base_card_id: 1,
      name: "Echo Base",
      subtitle: null,
      type: "Base",
      traits: ["Zeta Trait"],
    });
    const baseA = makeCard({
      base_card_id: 2,
      name: "Echo Base",
      subtitle: null,
      type: "Base",
      traits: ["Alpha Trait"],
    });
    const context = contextFor([baseZ, baseA]);
    const result = sortCards([baseZ, baseA], state("name", "asc"), context);
    expect(ids(result)).toEqual([2, 1]);
  });

  it("ties fall back to default order", () => {
    const first = makeCard({ base_card_id: 1, name: "Same" });
    const second = makeCard({ base_card_id: 2, name: "Same" });
    const context = contextFor([first, second]);
    const result = sortCards([second, first], state("name", "asc"), context);
    // defaultIndex says 1 < 2 -- the tie falls back to that, not input order.
    expect(ids(result)).toEqual([1, 2]);
  });
});

describe("Variants column", () => {
  it("numeric on the total catalog variant count", () => {
    const two = makeCard({
      base_card_id: 1,
      variants: [makeVariant({ variant_id: 1 }), makeVariant({ variant_id: 2 })],
    });
    const one = makeCard({ base_card_id: 2, variants: [makeVariant({ variant_id: 3 })] });
    const context = contextFor([two, one]);
    expect(ids(sortCards([two, one], state("variants", "asc"), context))).toEqual([2, 1]);
    expect(ids(sortCards([two, one], state("variants", "desc"), context))).toEqual([1, 2]);
  });
});

describe("Playset column", () => {
  // A: Unit (size 3), owned 3 across variants -- complete, needed 0.
  const complete3 = makeCard({
    base_card_id: 1,
    type: "Unit",
    variants: [makeVariant({ variant_id: 1, quantity: 3 })],
    inventory: { 1: 3 },
  });
  // B: Unit (size 3), owned 7 -- also complete (needed 0), MORE owned than A.
  const complete7 = makeCard({
    base_card_id: 2,
    type: "Unit",
    variants: [
      makeVariant({ variant_id: 2, quantity: 4 }),
      makeVariant({ variant_id: 3, variant_type: "Foil", finish: "Standard Foil", quantity: 3 }),
    ],
    inventory: { 2: 4, 3: 3 },
  });
  // C: Unit (size 3), owned 1 -- needed 2.
  const partial1 = makeCard({
    base_card_id: 3,
    type: "Unit",
    variants: [makeVariant({ variant_id: 4, quantity: 1 })],
    inventory: { 4: 1 },
  });
  // D: Leader (size 1), owned 0 -- needed 1.
  const leaderEmpty = makeCard({
    base_card_id: 4,
    type: "Leader",
    variants: [makeVariant({ variant_id: 5, quantity: 0 })],
    inventory: { 5: 0 },
  });
  const cards = [complete3, complete7, partial1, leaderEmpty];

  it("descending: needed ascending (complete first), ties broken by owned DESCENDING", () => {
    const context = contextFor(cards);
    const result = sortCards(cards, state("playset", "desc"), context);
    // needed: A=0, B=0, C=2, D=1 -> [B,A] (owned 7>3) then D(1) then C(2).
    expect(ids(result)).toEqual([2, 1, 4, 3]);
  });

  it("ascending: the exact mirror -- needed descending (emptiest first), ties broken by owned ASCENDING", () => {
    const context = contextFor(cards);
    const result = sortCards(cards, state("playset", "asc"), context);
    // needed descending: C(2), D(1), then [A,B] tied at needed 0, owned
    // ascending -> A(3) before B(7).
    expect(ids(result)).toEqual([3, 4, 1, 2]);
  });

  it("uses the SCOPED owned count (BL-195) when a scope is active, not the total", () => {
    const scopedCard = makeCard({
      base_card_id: 5,
      type: "Unit",
      variants: [
        makeVariant({ variant_id: 6, variant_type: "Standard", finish: "Standard", quantity: 1 }),
        makeVariant({
          variant_id: 7,
          variant_type: "Hyperspace Foil",
          finish: "Hyperspace Foil",
          quantity: 3,
        }),
      ],
      inventory: { 6: 1, 7: 3 },
    });
    const other = makeCard({
      base_card_id: 6,
      type: "Unit",
      variants: [makeVariant({ variant_id: 8, quantity: 0 })],
      inventory: { 8: 0 },
    });
    const context = contextFor([scopedCard, other], { scope: "Hyperspace Foil" });
    // Scoped owned count for scopedCard is 3 (Hyperspace Foil only, not the
    // total 4) -- still complete (needed 0), sorts ahead of `other` (needed 3).
    const result = sortCards([scopedCard, other], state("playset", "desc"), context);
    expect(ids(result)).toEqual([5, 6]);
  });
});

describe("Value column", () => {
  const priced10 = makeCard({
    base_card_id: 1,
    variants: [
      makeVariant({
        variant_id: 1,
        variant_type: "Standard",
        price: { market: 10, low: 2, as_of: "2026-08-01" },
      }),
    ],
  });
  const priced5 = makeCard({
    base_card_id: 2,
    variants: [
      makeVariant({
        variant_id: 2,
        variant_type: "Standard",
        price: { market: 5, low: 8, as_of: "2026-08-01" },
      }),
    ],
  });
  const unpriced = makeCard({
    base_card_id: 3,
    variants: [makeVariant({ variant_id: 3, variant_type: "Standard" })],
  });
  const cards = [priced10, priced5, unpriced];

  it("em-dash (null/unpriced) sorts BELOW 0: first ascending, last descending", () => {
    const context = contextFor(cards);
    expect(ids(sortCards(cards, state("value", "asc"), context))).toEqual([3, 2, 1]);
    expect(ids(sortCards(cards, state("value", "desc"), context))).toEqual([1, 2, 3]);
  });

  it("follows the Market/Low toggle (valueMode)", () => {
    // Low prices invert the $10/$5 relationship (10 -> low 2, 5 -> low 8).
    const context = contextFor(cards, { valueMode: "low" });
    expect(ids(sortCards(cards, state("value", "asc"), context))).toEqual([3, 1, 2]);
  });

  it("follows the Unit/Collection toggle (unitMode) -- collection value depends on owned quantity", () => {
    const ownedCard = makeCard({
      base_card_id: 10,
      variants: [
        makeVariant({
          variant_id: 10,
          variant_type: "Standard",
          quantity: 2,
          price: { market: 3, low: 1, as_of: "2026-08-01" },
        }),
      ],
      inventory: { 10: 2 },
    });
    const unownedCard = makeCard({
      base_card_id: 11,
      variants: [
        makeVariant({
          variant_id: 11,
          variant_type: "Standard",
          quantity: 0,
          price: { market: 100, low: 90, as_of: "2026-08-01" },
        }),
      ],
      inventory: { 11: 0 },
    });
    const collectionCtx = contextFor([ownedCard, unownedCard], { unitMode: "collection" });
    // Collection value: ownedCard = 2 x $3 = $6; unownedCard = owns none ->
    // null (em-dash) regardless of its catalog price -- sorts below 0.
    expect(ids(sortCards([ownedCard, unownedCard], state("value", "asc"), collectionCtx))).toEqual([
      11, 10,
    ]);
  });
});

describe("Rarity column", () => {
  it("explicit rank order Special < Common < Uncommon < Rare < Legendary -- never alphabetized", () => {
    const legendary = makeCard({ base_card_id: 1, rarity: "L" });
    const common = makeCard({ base_card_id: 2, rarity: "C" });
    const special = makeCard({ base_card_id: 3, rarity: "S" });
    const rare = makeCard({ base_card_id: 4, rarity: "R" });
    const uncommon = makeCard({ base_card_id: 5, rarity: "U" });
    const cards = [legendary, common, special, rare, uncommon];
    const context = contextFor(cards);
    const result = sortCards(cards, state("rarity", "asc"), context);
    // Alphabetical would read Common, Legendary, Rare, Special, Uncommon --
    // the explicit rank must NOT match that.
    expect(ids(result)).toEqual([3, 2, 5, 4, 1]);
  });

  it("descending reverses the explicit rank order", () => {
    const common = makeCard({ base_card_id: 1, rarity: "C" });
    const special = makeCard({ base_card_id: 2, rarity: "S" });
    const context = contextFor([common, special]);
    expect(ids(sortCards([common, special], state("rarity", "desc"), context))).toEqual([1, 2]);
  });
});

describe.each([
  ["cost", "cost"],
  ["power", "power"],
  ["hp", "hp"],
] as const)("%s column", (_label, field) => {
  it("a null stat sorts BELOW 0: first ascending, last descending", () => {
    const withNull = makeCard({ base_card_id: 1, [field]: null });
    const withZero = makeCard({ base_card_id: 2, [field]: 0 });
    const withFive = makeCard({ base_card_id: 3, [field]: 5 });
    const cards = [withFive, withZero, withNull];
    const context = contextFor(cards);
    expect(ids(sortCards(cards, state(field, "asc"), context))).toEqual([1, 2, 3]);
    expect(ids(sortCards(cards, state(field, "desc"), context))).toEqual([3, 2, 1]);
  });
});

describe("Ties always fall back to default order", () => {
  it("equal rarity ranks preserve the defaultIndex order regardless of input array order", () => {
    const a = makeCard({ base_card_id: 1, rarity: "C" });
    const b = makeCard({ base_card_id: 2, rarity: "C" });
    const c = makeCard({ base_card_id: 3, rarity: "C" });
    const context = contextFor([a, b, c]); // defaultIndex: 1 < 2 < 3
    const result = sortCards([c, a, b], state("rarity", "asc"), context);
    expect(ids(result)).toEqual([1, 2, 3]);
  });
});

describe("2-state header cycling (nextSortState)", () => {
  it("clicking a column that isn't active lands on ascending", () => {
    expect(nextSortState(state("value", "desc"), "rarity")).toEqual(state("rarity", "asc"));
  });

  it("clicking the already-active column toggles asc -> desc -> asc", () => {
    const afterFirstClick = nextSortState(state("rarity", "asc"), "rarity");
    expect(afterFirstClick).toEqual(state("rarity", "desc"));
    const afterSecondClick = nextSortState(afterFirstClick, "rarity");
    expect(afterSecondClick).toEqual(state("rarity", "asc"));
  });

  it("# ascending from any other active sort returns the table to the exact default order", () => {
    const sor1 = makeCard({ base_card_id: 1, set_code: "SOR", base_card_number: "001" });
    const sor2 = makeCard({ base_card_id: 2, set_code: "SOR", base_card_number: "002" });
    const defaultOrder = [sor1, sor2];
    const context = contextFor(defaultOrder);

    // Simulate: table is currently sorted by Rarity descending, collector
    // clicks the # header once.
    const nextState = nextSortState(state("rarity", "desc"), "number");
    expect(nextState).toEqual(DEFAULT_SORT_STATE);
    const result = sortCards(defaultOrder, nextState, context);
    expect(ids(result)).toEqual([1, 2]);
  });
});

describe("ariaSortValue", () => {
  it("reads 'none' for a sortable column that isn't the active one", () => {
    expect(ariaSortValue(state("value", "asc"), "rarity")).toBe("none");
  });

  it("reads 'ascending'/'descending' for the active column", () => {
    expect(ariaSortValue(state("value", "asc"), "value")).toBe("ascending");
    expect(ariaSortValue(state("value", "desc"), "value")).toBe("descending");
  });
});
