import { describe, expect, it } from "vitest";
import type { BaseCardCatalogWithQuantity } from "../api/baseCards";
import { DEFAULT_SORT_STATE } from "../utils/cardSort";
import type { SortState } from "../utils/cardSort";
import { DEFAULT_FILTERS } from "../utils/filters";
import { toInventoryCards } from "../utils/inventory";
import type { InventoryCard } from "../utils/inventory";
import {
  activeFilterCount,
  buildVaultList,
  desktopSortPolicy,
  filterCards,
  freshFilterState,
  isNarrowed,
  NO_TOGGLES,
  withFilters,
  withScope,
} from "./vaultModel";
import type { VaultFilterState } from "./vaultModel";

// What the desktop Cards page (screens/cards/CardsPage.tsx) shows for a fixed
// input, pinned as literal ids and counts against the shared vault model with
// the desktop options (the sort applied as handed, the Unit/Collection
// switch). The literals are fixed answers, never computed by another copy of
// the pipeline.

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
/** The phone's context: every option at its default. */
const CTX = { setOrder: SET_ORDER, priceKind: "market" as const, limits: null };
/** The desktop's context: the sort applied as handed, Unit value mode. */
const DESKTOP = { ...CTX, sortPolicy: desktopSortPolicy, unitMode: "unit" as const };
const ids = (cards: InventoryCard[]) => cards.map((c) => c.base_card_id);

/** Asserts the shared model gives the literal answer for one input, under both
 * the phone's and the desktop's options (they agree at the default sort). */
function expectModel(
  s: VaultFilterState,
  want: { list: number[]; breakdown: number[]; activeCount: number; narrowed: boolean }
) {
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
  const d = buildVaultList(CARDS, s, DEFAULT_SORT_STATE, DESKTOP);
  expect(
    {
      list: ids(d.list),
      breakdown: ids(d.breakdown),
      activeCount: d.activeCount,
      narrowed: d.narrowed,
    },
    "desktop options"
  ).toEqual(want);
  expect(ids(filterCards(p.all, s, CTX.limits)), "filterCards").toEqual(want.list);
  expect(activeFilterCount(s)).toBe(want.activeCount);
  expect(isNarrowed(s)).toBe(want.narrowed);
}

const ALL = [5, 3, 4, 2, 1];
const withQuery = (query: string): VaultFilterState => ({ ...freshFilterState(), query });

describe("desktop pipeline: stages desktop and phone share", () => {
  it("default view: every card in default order (newest set first, numbers ascending), not narrowed", () => {
    expectModel(freshFilterState(), { list: ALL, breakdown: ALL, activeCount: 0, narrowed: false });
  });

  it("name search matches the name and the displayed subtitle", () => {
    expectModel(withQuery("vader"), { list: [1], breakdown: [1], activeCount: 1, narrowed: true });
    expectModel(withQuery("NEEDS NO"), {
      list: [5],
      breakdown: [5],
      activeCount: 1,
      narrowed: true,
    });
  });

  it("card-number search: 'SOR 87', a bare base number, a printing's own number, 'SHD 270'", () => {
    for (const q of ["SOR 87", "sor 087", "87", "339"])
      expectModel(withQuery(q), { list: [1], breakdown: [1], activeCount: 1, narrowed: true });
    expectModel(withQuery("shd 270"), {
      list: [5],
      breakdown: [5],
      activeCount: 1,
      narrowed: true,
    });
    // A number belongs to its own set: SHD has no card 87.
    expectModel(withQuery("SHD 87"), { list: [], breakdown: [], activeCount: 1, narrowed: true });
  });

  it("a search of only spaces hides nothing, counts 0 and is not narrowed", () => {
    expectModel(withQuery("   "), { list: ALL, breakdown: ALL, activeCount: 0, narrowed: false });
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
    expectModel(s, { list: [2], breakdown: [3, 2], activeCount: 3, narrowed: true });
  });

  it("the breakdown applies every narrowing except the Set facet", () => {
    const s = withFilters(freshFilterState(), { ...DEFAULT_FILTERS, set: new Set(["SHD"]) });
    expectModel(s, { list: [5, 3], breakdown: ALL, activeCount: 1, narrowed: true });
    // With a search too, the breakdown follows the search but not the Set.
    expectModel(
      { ...s, query: "a" },
      // "a": Vader, Childsen (Prison Warden), Bossk (Stalker), Luke, Cad Bane.
      { list: [5, 3], breakdown: ALL, activeCount: 2, narrowed: true }
    );
    expectModel(
      { ...s, query: "vader" },
      { list: [], breakdown: [1], activeCount: 2, narrowed: true }
    );
  });

  it("toggles narrow and count one each; an aspect-mode change alone counts as a filter", () => {
    expectModel(
      { ...freshFilterState(), toggles: { ...NO_TOGGLES, owned: true, incomplete: true } },
      // Owned: 1, 2, 3, 5. Incomplete (playset of 3): 1 (2 owned), 3 (1 owned).
      { list: [3, 1], breakdown: [3, 1], activeCount: 2, narrowed: true }
    );
    expectModel(withFilters(freshFilterState(), { ...DEFAULT_FILTERS, aspectMode: "any" }), {
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
      const d = ids(buildVaultList(CARDS, freshFilterState(), sort, DESKTOP).list);
      const p = ids(buildVaultList(CARDS, freshFilterState(), sort, CTX).list);
      expect(p, sort.column).toEqual(d);
    }
    // Value descending by unit price: 6.80, 3, 2, 1, 0.20.
    expect(
      ids(
        buildVaultList(CARDS, freshFilterState(), { column: "value", direction: "desc" }, DESKTOP)
          .list
      )
    ).toEqual([1, 4, 5, 3, 2]);
    // Name ascending: Bossk, Cad Bane, Darth Vader, Lieutenant Childsen, Luke.
    expect(
      ids(
        buildVaultList(CARDS, freshFilterState(), { column: "name", direction: "asc" }, DESKTOP)
          .list
      )
    ).toEqual([3, 5, 1, 2, 4]);
    // # descending: set groups stay newest first, numbers descend inside each.
    expect(
      ids(
        buildVaultList(CARDS, freshFilterState(), { column: "number", direction: "desc" }, DESKTOP)
          .list
      )
    ).toEqual([3, 5, 1, 2, 4]);
    expect(
      ids(
        buildVaultList(CARDS, freshFilterState(), { column: "playset", direction: "desc" }, DESKTOP)
          .list
      )
    ).toEqual([2, 5, 1, 3, 4]);
  });
});

describe("desktop-only: the Value sort reads the Unit/Collection switch", () => {
  const VALUE_DESC: SortState = { column: "value", direction: "desc" };

  it("Collection: copies owned x price, so 40 bulk copies at $0.20 outrank one $1 card", () => {
    // 21.80, 9.00, 8.00, 1.00, then Luke (nothing owned: no value, last).
    expect(
      ids(
        buildVaultList(CARDS, freshFilterState(), VALUE_DESC, {
          ...DESKTOP,
          unitMode: "collection",
        }).list
      )
    ).toEqual([1, 5, 2, 3, 4]);
  });

  it("Unit: the per-card price, so the same bulk card ranks last; the phone sorts this way", () => {
    expect(
      ids(
        buildVaultList(CARDS, freshFilterState(), VALUE_DESC, { ...DESKTOP, unitMode: "unit" }).list
      )
    ).toEqual([1, 4, 5, 3, 2]);
    expect(ids(buildVaultList(CARDS, freshFilterState(), VALUE_DESC, CTX).list)).toEqual([
      1, 4, 5, 3, 2,
    ]);
  });
});

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
      expect(ids(buildVaultList(CARDS, freshFilterState(), sort, DESKTOP).list)).toEqual(want);
      // The phone turns either sort into "Set | #" ascending.
      expect(ids(buildVaultList(CARDS, freshFilterState(), sort, CTX).list)).toEqual(ALL);
    });
});

describe("desktop-only: the toggles-only list the filter panel draws its options from", () => {
  it("applies the collection toggles but neither the facets nor the search", () => {
    const s: VaultFilterState = {
      ...withFilters(freshFilterState(), { ...DEFAULT_FILTERS, set: new Set(["SOR"]) }),
      query: "vader",
      toggles: { ...NO_TOGGLES, owned: true },
    };
    const d = buildVaultList(CARDS, s, DEFAULT_SORT_STATE, DESKTOP);
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
    expect(ids(buildVaultList(CARDS, s, DEFAULT_SORT_STATE, DESKTOP).toggled)).toEqual([3, 4, 2]);
    expect(ids(buildVaultList(CARDS, s, DEFAULT_SORT_STATE, DESKTOP).list)).toEqual([3, 2]);
  });
});
