import { describe, expect, it } from "vitest";
import type { BaseCardCatalogWithQuantity } from "../../api/baseCards";
import { countActiveFilters } from "../../components/FilterPanel";
import type { BaseCard } from "../../utils/catalog";
import { DEFAULT_SORT_STATE, sortCards } from "../../utils/cardSort";
import type { SortState } from "../../utils/cardSort";
import { applyFilters, DEFAULT_FILTERS, isDefaultFilterState } from "../../utils/filters";
import type { FilterState } from "../../utils/filters";
import { toInventoryCards } from "../../utils/inventory";
import type { InventoryCard } from "../../utils/inventory";
import { applyCollectionToggles, sortCardsByScope } from "../../utils/variantScope";
import type { CollectionToggles, ValueDisplayMode } from "../../utils/variantScope";
import {
  activeFilterCount,
  buildVaultList,
  filterCards,
  freshFilterState,
  isNarrowed,
  NO_TOGGLES,
  withFilters,
  withScope,
} from "./vaultModel";
import type { VaultFilterState } from "./vaultModel";

// The desktop Cards page (screens/cards/CardsPage.tsx) narrows and sorts its
// list inline. These tests pin what that pipeline produces for a fixed input,
// as literal ids and counts, so a refactor onto the shared vault model can be
// checked against fixed answers rather than against another copy of the code.
//
// `desktop()` composes the shared helpers exactly the way CardsPage's memos do
// (line numbers below are CardsPage.tsx). It is the subject under test, never
// the source of an expected value. Once buildVaultList takes the desktop
// options, every `desktop()` call is re-pointed to it and `desktop()` is
// deleted, so the pipeline is never kept in two places.

type V = BaseCardCatalogWithQuantity["variants"][number];
const v = (id: number, finish: string, num: string, qty: number, market: number, set: string): V =>
  ({
    variant_id: id,
    variant_type: finish,
    finish,
    channel: "Retail",
    source_set_code: set,
    card_number: num,
    front_image_url: null,
    back_image_url: null,
    price: { market, low: market / 2, as_of: "2026-10-01" },
    quantity: qty,
  }) as V;

const base = (
  id: number,
  set: string,
  num: string,
  name: string,
  subtitle: string | null,
  variants: V[]
): BaseCardCatalogWithQuantity =>
  ({
    id,
    set_code: set,
    base_card_number: num,
    name,
    subtitle,
    type: "Unit",
    rarity: "Rare",
    cost: 3,
    power: 3,
    hp: 3,
    arena: "Ground",
    is_token: false,
    aspects: [],
    keywords: [],
    traits: [],
    variants,
  }) as BaseCardCatalogWithQuantity;

// Two main sets, so the Set sorts have a group order to reverse. SHD is the
// newer, so the default order is SHD by number, then SOR by number:
// [5, 3, 4, 2, 1].
//
//   id  set #   printings (qty @ market)               variants  unit $  collection $
//   1   SOR 87  Standard 1 @ 6.80, Hyperspace 339 1 @ 15     2      6.80   21.80
//   2   SOR 35  Standard 40 @ 0.20, Hyperspace 300 0 @ 1.16  2      0.20    8.00
//   3   SHD 52  Standard 1 @ 1.00, Hyperspace 310 0 @ 3      2      1.00    1.00
//   4   SOR 10  Standard 0 @ 3                               1      3.00    none
//   5   SHD 5   Standard 2 @ 2, Hyperspace 270 1 @ 5,        3      2.00    9.00
//               Standard Foil 5 0 @ 4
const SET_ORDER = { SOR: "2024-03-08", SHD: "2024-07-12" };
const CARDS: InventoryCard[] = toInventoryCards(
  [
    base(1, "SOR", "87", "Darth Vader", "Commanding the First Wave", [
      v(11, "Standard", "87", 1, 6.8, "SOR"),
      v(12, "Hyperspace", "339", 1, 15, "SOR"),
    ]),
    base(2, "SOR", "35", "Lieutenant Childsen", "Death Star Prison Warden", [
      v(21, "Standard", "35", 40, 0.2, "SOR"),
      v(22, "Hyperspace", "300", 0, 1.16, "SOR"),
    ]),
    base(3, "SHD", "52", "Bossk", "Deadly Stalker", [
      v(31, "Standard", "52", 1, 1, "SHD"),
      v(32, "Hyperspace", "310", 0, 3, "SHD"),
    ]),
    base(4, "SOR", "10", "Luke Skywalker", null, [v(41, "Standard", "10", 0, 3, "SOR")]),
    base(5, "SHD", "5", "Cad Bane", "He Who Needs No Introduction", [
      v(51, "Standard", "5", 2, 2, "SHD"),
      v(52, "Hyperspace", "270", 1, 5, "SHD"),
      v(53, "Standard Foil", "5", 0, 4, "SHD"),
    ]),
  ],
  SET_ORDER
);
const CTX = { setOrder: SET_ORDER, priceKind: "market" as const, limits: null };
const ids = (cards: InventoryCard[]) => cards.map((c) => c.base_card_id);

interface DesktopOut {
  toggled: InventoryCard[];
  list: InventoryCard[];
  breakdown: InventoryCard[];
  activeCount: number;
  narrowed: boolean;
}

/** CardsPage's pipeline over the shared helpers. Desktop keeps the search
 * inside FilterState, so the phone state's `query` is moved into
 * `filters.search` here. */
function desktop(
  s: VaultFilterState,
  sort: SortState = DEFAULT_SORT_STATE,
  unitMode: ValueDisplayMode = "unit"
): DesktopOut {
  const filters: FilterState = { ...s.filters, search: s.query };
  const t: CollectionToggles = s.toggles;
  // :425 cards
  const cards = sortCardsByScope(CARDS, SET_ORDER, s.scope);
  // :475 toggleNarrowed (also what FilterPanel takes as `cards`, :716)
  const toggled = applyCollectionToggles(cards, t, s.scope, CTX.limits);
  // :491 filtered
  const filtered = applyFilters(toggled as BaseCard[], filters) as InventoryCard[];
  // :500 breakdownCards
  const breakdown = applyFilters(toggled as BaseCard[], {
    ...filters,
    set: new Set<string>(),
  }) as InventoryCard[];
  // :527 + :536 activeFilterCount
  const toggleCount =
    (t.incomplete ? 1 : 0) + (t.owned ? 1 : 0) + (t.unowned ? 1 : 0) + (t.overcap ? 1 : 0);
  const activeCount = countActiveFilters(filters) + toggleCount;
  // :564 defaultIndex, :572 sortedCards
  const defaultIndex = new Map(cards.map((c, i) => [c.base_card_id, i]));
  const list = sortCards(filtered, sort, {
    scope: s.scope,
    valueMode: CTX.priceKind,
    unitMode,
    setOrder: SET_ORDER,
    defaultIndex,
  });
  // :589 isNarrowed
  const narrowed = !isDefaultFilterState(filters) || toggleCount > 0;
  return { toggled, list, breakdown, activeCount, narrowed };
}

/** Asserts the desktop composition and the shared model give the same
 * literal answer for one input. */
function expectBoth(
  s: VaultFilterState,
  want: { list: number[]; breakdown: number[]; activeCount: number; narrowed: boolean }
) {
  const d = desktop(s);
  expect(
    {
      list: ids(d.list),
      breakdown: ids(d.breakdown),
      activeCount: d.activeCount,
      narrowed: d.narrowed,
    },
    "desktop"
  ).toEqual(want);
  const p = buildVaultList(CARDS, s, DEFAULT_SORT_STATE, CTX);
  expect(
    {
      list: ids(p.list),
      breakdown: ids(p.breakdown),
      activeCount: p.activeCount,
      narrowed: p.narrowed,
    },
    "model"
  ).toEqual(want);
  expect(ids(filterCards(p.all, s, CTX.limits)), "filterCards").toEqual(want.list);
  expect(activeFilterCount(s)).toBe(want.activeCount);
  expect(isNarrowed(s)).toBe(want.narrowed);
}

const ALL = [5, 3, 4, 2, 1];
const withQuery = (query: string): VaultFilterState => ({ ...freshFilterState(), query });

describe("desktop pipeline: stages desktop and phone share", () => {
  it("default view: every card in default order (newest set first, numbers ascending), not narrowed", () => {
    expectBoth(freshFilterState(), { list: ALL, breakdown: ALL, activeCount: 0, narrowed: false });
  });

  it("name search matches the name and the displayed subtitle", () => {
    expectBoth(withQuery("vader"), { list: [1], breakdown: [1], activeCount: 1, narrowed: true });
    expectBoth(withQuery("NEEDS NO"), {
      list: [5],
      breakdown: [5],
      activeCount: 1,
      narrowed: true,
    });
  });

  it("card-number search: 'SOR 87', a bare base number, a printing's own number, 'SHD 270'", () => {
    for (const q of ["SOR 87", "sor 087", "87", "339"])
      expectBoth(withQuery(q), { list: [1], breakdown: [1], activeCount: 1, narrowed: true });
    expectBoth(withQuery("shd 270"), { list: [5], breakdown: [5], activeCount: 1, narrowed: true });
    // A number belongs to its own set: SHD has no card 87.
    expectBoth(withQuery("SHD 87"), { list: [], breakdown: [], activeCount: 1, narrowed: true });
  });

  it("a search of only spaces hides nothing, counts 0 and is not narrowed", () => {
    expectBoth(withQuery("   "), { list: ALL, breakdown: ALL, activeCount: 0, narrowed: false });
  });

  it("scope + a collection toggle + Set facet: list, breakdown and count", () => {
    // Hyperspace scope; "no inventory" counts Hyperspace copies only; Set SOR.
    // Hyperspace copies: 1 owns one, 5 owns one, 2 and 3 own none, 4 has no
    // Hyperspace printing (the scope's Finish facet drops it).
    let s = withScope(freshFilterState(), "Hyperspace");
    s = { ...s, toggles: { ...NO_TOGGLES, unowned: true } };
    s = withFilters(s, { ...s.filters, set: new Set(["SOR"]) });
    expect(s.scope).toBe("Hyperspace");
    // Count: Finish (the scope) 1 + Set 1 + toggle 1.
    expectBoth(s, { list: [2], breakdown: [3, 2], activeCount: 3, narrowed: true });
  });

  it("the breakdown applies every narrowing except the Set facet", () => {
    const s = withFilters(freshFilterState(), { ...DEFAULT_FILTERS, set: new Set(["SHD"]) });
    expectBoth(s, { list: [5, 3], breakdown: ALL, activeCount: 1, narrowed: true });
    // With a search too, the breakdown follows the search but not the Set.
    expectBoth(
      { ...s, query: "a" },
      // "a": Vader, Childsen (Prison Warden), Bossk (Stalker), Luke, Cad Bane.
      { list: [5, 3], breakdown: ALL, activeCount: 2, narrowed: true }
    );
    expectBoth(
      { ...s, query: "vader" },
      { list: [], breakdown: [1], activeCount: 2, narrowed: true }
    );
  });

  it("toggles narrow and count one each; an aspect-mode change alone counts as a filter", () => {
    expectBoth(
      { ...freshFilterState(), toggles: { ...NO_TOGGLES, owned: true, incomplete: true } },
      // Owned: 1, 2, 3, 5. Incomplete (playset of 3): 1 (2 owned), 3 (1 owned).
      { list: [3, 1], breakdown: [3, 1], activeCount: 2, narrowed: true }
    );
    expectBoth(withFilters(freshFilterState(), { ...DEFAULT_FILTERS, aspectMode: "any" }), {
      list: ALL,
      breakdown: ALL,
      activeCount: 1,
      narrowed: true,
    });
  });

  it("a Unit-mode sort orders the same on both (comparators, nulls last, default-order tiebreak)", () => {
    for (const sort of [
      { column: "value", direction: "desc" },
      { column: "name", direction: "asc" },
      { column: "number", direction: "desc" },
      { column: "playset", direction: "desc" },
    ] as const) {
      const d = ids(desktop(freshFilterState(), sort).list);
      const p = ids(buildVaultList(CARDS, freshFilterState(), sort, CTX).list);
      expect(p, sort.column).toEqual(d);
    }
    // Value descending by unit price: 6.80, 3, 2, 1, 0.20.
    expect(ids(desktop(freshFilterState(), { column: "value", direction: "desc" }).list)).toEqual([
      1, 4, 5, 3, 2,
    ]);
    // Name ascending: Bossk, Cad Bane, Darth Vader, Lieutenant Childsen, Luke.
    expect(ids(desktop(freshFilterState(), { column: "name", direction: "asc" }).list)).toEqual([
      3, 5, 1, 2, 4,
    ]);
    // # descending: set groups stay newest first, numbers descend inside each.
    expect(ids(desktop(freshFilterState(), { column: "number", direction: "desc" }).list)).toEqual([
      3, 5, 1, 2, 4,
    ]);
    expect(ids(desktop(freshFilterState(), { column: "playset", direction: "desc" }).list)).toEqual(
      [2, 5, 1, 3, 4]
    );
  });
});

// BL-299 stage 2: re-point to buildVaultList desktop options; expectations unchanged.
describe("desktop-only: the Value sort reads the Unit/Collection switch", () => {
  const VALUE_DESC: SortState = { column: "value", direction: "desc" };

  it("Collection: copies owned x price, so 40 bulk copies at $0.20 outrank one $1 card", () => {
    // 21.80, 9.00, 8.00, 1.00, then Luke (nothing owned: no value, last).
    expect(ids(desktop(freshFilterState(), VALUE_DESC, "collection").list)).toEqual([
      1, 5, 2, 3, 4,
    ]);
  });

  it("Unit: the per-card price, so the same bulk card ranks last; the phone sorts this way", () => {
    expect(ids(desktop(freshFilterState(), VALUE_DESC, "unit").list)).toEqual([1, 4, 5, 3, 2]);
    expect(ids(buildVaultList(CARDS, freshFilterState(), VALUE_DESC, CTX).list)).toEqual([
      1, 4, 5, 3, 2,
    ]);
  });
});

// BL-299 stage 2: re-point to buildVaultList desktop options; expectations unchanged.
describe("desktop-only: Set and Variants sorts are applied as handed", () => {
  const cases: [SortState, number[]][] = [
    // Set ascending is the default order.
    [{ column: "set", direction: "asc" }, [5, 3, 4, 2, 1]],
    // Set descending: main sets oldest first (SOR, then SHD), numbers ascending.
    [{ column: "set", direction: "desc" }, [4, 2, 1, 5, 3]],
    // Variants descending: 3 printings, then the 2-printing cards in default
    // order, then the 1-printing card.
    [{ column: "variants", direction: "desc" }, [5, 3, 2, 1, 4]],
  ];

  for (const [sort, want] of cases)
    it(`${sort.column} ${sort.direction}: desktop ${want.join(",")}; the phone shows the default order`, () => {
      expect(ids(desktop(freshFilterState(), sort).list)).toEqual(want);
      // The phone turns either sort into "Set | #" ascending.
      expect(ids(buildVaultList(CARDS, freshFilterState(), sort, CTX).list)).toEqual(ALL);
    });
});

// BL-299 stage 2: re-point to buildVaultList desktop options; expectations unchanged.
describe("desktop-only: the toggles-only list the filter panel draws its options from", () => {
  it("applies the collection toggles but neither the facets nor the search", () => {
    const s: VaultFilterState = {
      ...withFilters(freshFilterState(), { ...DEFAULT_FILTERS, set: new Set(["SOR"]) }),
      query: "vader",
      toggles: { ...NO_TOGGLES, owned: true },
    };
    const d = desktop(s);
    // Owned: 5, 3, 2, 1 (Luke owns nothing), in default order.
    expect(ids(d.toggled)).toEqual([5, 3, 2, 1]);
    expect(ids(d.list)).toEqual([1]);
    expect(ids(d.breakdown)).toEqual([1]);
  });

  it("with a scope, the toggles read the scoped finish's copies", () => {
    const s: VaultFilterState = {
      ...withScope(freshFilterState(), "Hyperspace"),
      toggles: { ...NO_TOGGLES, unowned: true },
    };
    // No Hyperspace copies: 3 (HS 310), 4 (no printing), 2 (HS 300), in
    // scoped default order; the scope's Finish facet is not applied here.
    expect(ids(desktop(s).toggled)).toEqual([3, 4, 2]);
    expect(ids(desktop(s).list)).toEqual([3, 2]);
  });
});
