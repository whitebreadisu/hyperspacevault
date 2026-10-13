import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BaseCardCatalogWithQuantity } from "../../api/baseCards";
import { nextSortState, DEFAULT_SORT_STATE } from "../../utils/cardSort";
import { DEFAULT_FILTERS } from "../../utils/filters";
import { toInventoryCards } from "../../utils/inventory";
import { SORT_LABELS, SORT_ORDER, sortLabel } from "./SortSheet";
import { useVaultViewOver } from "./useVaultView";
import {
  activeFilterCount,
  buildVaultList,
  freshFilterState,
  isNarrowed,
  matchesQuery,
  nextPhoneSort,
  PHONE_FIRST_DIRECTION,
  phoneSortState,
  SCOPE_VALUES,
  withFilters,
  withScope,
} from "./vaultModel";

type V = BaseCardCatalogWithQuantity["variants"][number];
const v = (id: number, finish: string, num: string, qty = 0, market?: number, set = "SOR"): V =>
  ({
    variant_id: id,
    variant_type: finish,
    finish,
    channel: "Retail",
    source_set_code: set,
    card_number: num,
    front_image_url: null,
    back_image_url: null,
    price: market == null ? null : { market, low: market / 2, as_of: "2026-10-01" },
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

const SET_ORDER = { SOR: "2024-03-08", ASH: "2026-07-01" };
const CARDS = toInventoryCards(
  [
    base(1, "SOR", "87", "Darth Vader", "Commanding the First Wave", [
      v(11, "Standard", "87", 1, 6.8),
      v(12, "Hyperspace", "339", 1, 15),
    ]),
    base(2, "SOR", "35", "Lieutenant Childsen", "Death Star Prison Warden", [
      v(21, "Standard", "35", 3, 0.09),
      v(22, "Hyperspace", "300", 0, 1.16),
    ]),
    base(3, "ASH", "52", "Chimaera", "Reinforcing the Center", [
      v(31, "Standard", "52", 0, 42, "ASH"),
      v(32, "Hyperspace", "310", 3, 53, "ASH"),
    ]),
    base(4, "SOR", "10", "Luke Skywalker", null, [v(41, "Standard", "10", 0, 3)]),
  ],
  SET_ORDER
);
const CTX = { setOrder: SET_ORDER, priceKind: "market" as const, limits: null };

describe("S1-22 Filter model wiring", () => {
  it("narrowed = any facet, toggle or a search; fresh state is not narrowed", () => {
    const s = freshFilterState();
    expect(isNarrowed(s)).toBe(false);
    expect(isNarrowed({ ...s, query: "  " })).toBe(false);
    expect(isNarrowed({ ...s, query: "vader" })).toBe(true);
    expect(isNarrowed({ ...s, filters: { ...DEFAULT_FILTERS, rarity: new Set(["Rare"]) } })).toBe(
      true
    );
    expect(isNarrowed({ ...s, toggles: { ...s.toggles, unowned: true } })).toBe(true);
    // One bump per group (desktop countActiveFilters): two sets = 1, + search = 2.
    const two = { ...s, query: "x", filters: { ...DEFAULT_FILTERS, set: new Set(["SOR", "ASH"]) } };
    expect(activeFilterCount(two)).toBe(2);
  });

  it("search matches name, subtitle and number", () => {
    const vader = CARDS.find((c) => c.base_card_id === 1)!;
    expect(matchesQuery(vader, "vader")).toBe(true);
    expect(matchesQuery(vader, "first wave")).toBe(true);
    expect(matchesQuery(vader, "87")).toBe(true);
    expect(matchesQuery(vader, "339")).toBe(true); // a printing's own number
    expect(matchesQuery(vader, "SOR 87")).toBe(true);
    expect(matchesQuery(vader, "ash 87")).toBe(false);
    expect(matchesQuery(vader, "8")).toBe(false);
    const r = buildVaultList(
      CARDS,
      { ...freshFilterState(), query: "luke" },
      DEFAULT_SORT_STATE,
      CTX
    );
    expect(r.list.map((c) => c.base_card_id)).toEqual([4]);
    expect(r.narrowed).toBe(true);
    expect(r.all).toHaveLength(4);
  });

  it("scope + set compose (both narrow; the scope is the Finish group)", () => {
    let s = withScope(freshFilterState(), "Hyperspace");
    s = withFilters(s, { ...s.filters, set: new Set(["SOR"]) });
    expect(s.scope).toBe("Hyperspace");
    expect(activeFilterCount(s)).toBe(2);
    const r = buildVaultList(CARDS, s, DEFAULT_SORT_STATE, CTX);
    // SOR cards carrying a Hyperspace printing, in scoped-number order (300, 339).
    expect(r.list.map((c) => c.base_card_id)).toEqual([2, 1]);
  });
});

describe("S1-16 Finish scope", () => {
  // REPLACE (BL-259 FR4-01, owner decision 2026-10-12): was "13 scope values,
  // Showcase excluded" -- Showcase returned to the picker as the last pinned value.
  it("14 scope values, Showcase the last pinned one", () => {
    expect(SCOPE_VALUES).toHaveLength(14);
    expect(SCOPE_VALUES.indexOf("Showcase")).toBe(9);
    expect(SCOPE_VALUES.slice(10)).toEqual([
      "Convention Exclusive",
      "Event Exclusive",
      "Prerelease Promo",
      "Movie Promo",
    ]);
  });

  it("fr4-04 a Showcase scope lists only the cards carrying a Showcase printing", () => {
    const cards = toInventoryCards(
      [
        {
          ...base(9, "ASH", "5", "Luke Skywalker", "I Can Save Him", [
            v(91, "Standard", "5", 1, 4, "ASH"),
            v(92, "Showcase", "771", 1, 360, "ASH"),
          ]),
          type: "Leader",
        },
        base(2, "SOR", "35", "Lieutenant Childsen", "Death Star Prison Warden", [
          v(21, "Standard", "35", 3, 0.09),
        ]),
      ],
      SET_ORDER
    );
    const s = withScope(freshFilterState(), "Showcase");
    expect([...s.filters.finish]).toEqual(["Showcase"]);
    const r = buildVaultList(cards, s, DEFAULT_SORT_STATE, CTX);
    expect(r.list.map((c) => c.base_card_id)).toEqual([9]);
    // The same narrowing any scope the common has no printing for produces.
    const p = buildVaultList(
      cards,
      withScope(freshFilterState(), "Standard Prestige"),
      DEFAULT_SORT_STATE,
      CTX
    );
    expect(p.list).toEqual([]);
  });

  it("b2-scope-replaces-finish: a scope writes the Finish facet (replacing what it held)", () => {
    let s = freshFilterState();
    s = withFilters(s, { ...s.filters, finish: new Set(["Standard Foil"]) });
    s = withScope(s, "Hyperspace");
    expect([...s.filters.finish]).toEqual(["Hyperspace"]);
    expect(isNarrowed(s)).toBe(true);
  });

  it("b2-facet-edit-disengages: a Finish edit disengages; other facets keep it", () => {
    const s = withScope(freshFilterState(), "Hyperspace");
    const kept = withFilters(s, { ...s.filters, rarity: new Set(["Rare"]) });
    expect(kept.scope).toBe("Hyperspace");
    const edited = withFilters(s, {
      ...s.filters,
      finish: new Set(["Hyperspace", "Standard Foil"]),
    });
    expect(edited.scope).toBeNull();
    expect([...edited.filters.finish].sort()).toEqual(["Hyperspace", "Standard Foil"]);
  });

  it("b2-all-finishes-clears: All finishes clears the scope and its facet value", () => {
    const s = withScope(withScope(freshFilterState(), "Hyperspace"), null);
    expect(s.scope).toBeNull();
    expect(s.filters.finish.size).toBe(0);
    expect(isNarrowed(s)).toBe(false);
  });

  it("b2-not-persisted: a remount starts unscoped", () => {
    const first = renderHook(() => useVaultViewOver(CARDS, SET_ORDER));
    act(() => first.result.current.setScope("Hyperspace Foil"));
    expect(first.result.current.state.scope).toBe("Hyperspace Foil");
    first.unmount();
    const again = renderHook(() => useVaultViewOver(CARDS, SET_ORDER));
    expect(again.result.current.state.scope).toBeNull();
    expect(again.result.current.state.filters.finish.size).toBe(0);
  });

  it("?finish= opens scoped; Clear resets filters, search and scope", () => {
    const h = renderHook(() => useVaultViewOver(CARDS, SET_ORDER, { finish: "Hyperspace" }));
    expect(h.result.current.state.scope).toBe("Hyperspace");
    act(() => h.result.current.setQuery("vader"));
    act(() => h.result.current.clearAll());
    expect(h.result.current.state).toEqual(freshFilterState());
    expect(h.result.current.narrowed).toBe(false);
  });
});

describe("FR5-05 phone sort list (F-17)", () => {
  it("nine rows in the owner's order, with the two phone labels and no Set row", () => {
    expect(SORT_ORDER.map((c) => SORT_LABELS[c])).toEqual([
      "Set | #",
      "Value",
      "Playset",
      "Name",
      "Cards Owned",
      "Rarity",
      "Cost",
      "Power",
      "HP",
    ]);
    expect(SORT_ORDER).toEqual([
      "number",
      "value",
      "playset",
      "name",
      "owned",
      "rarity",
      "cost",
      "power",
      "hp",
    ]);
    expect(SORT_ORDER as string[]).not.toContain("set");
    expect(SORT_ORDER as string[]).not.toContain("variants");
    // The Sort button's accessible name uses the same labels.
    expect(sortLabel({ column: "number", direction: "asc" })).toBe("Sort: Set | #, ascending");
    expect(sortLabel({ column: "owned", direction: "desc" })).toBe("Sort: Cards Owned, descending");
  });

  it("a set or variants sort is shown as Set | # ascending (the default order); others pass through", () => {
    for (const column of ["set", "variants"] as const) {
      expect(phoneSortState({ column, direction: "asc" })).toEqual(DEFAULT_SORT_STATE);
      expect(phoneSortState({ column, direction: "desc" })).toEqual(DEFAULT_SORT_STATE);
      expect(sortLabel({ column, direction: "desc" })).toBe("Sort: Set | #, ascending");
    }
    for (const column of SORT_ORDER)
      for (const direction of ["asc", "desc"] as const) {
        const s = { column, direction };
        expect(phoneSortState(s)).toBe(s);
      }
  });

  it("the Vault's state never holds a set or variants sort: such a pick lands on Set | # ascending", () => {
    const h = renderHook(() => useVaultViewOver(CARDS, SET_ORDER));
    const base = h.result.current.list.map((c) => c.base_card_id);
    for (const column of ["set", "variants"] as const) {
      act(() => h.result.current.pickSort("name"));
      act(() => h.result.current.pickSort(column));
      expect(h.result.current.sort).toEqual({ column: "number", direction: "asc" });
      expect(h.result.current.list.map((c) => c.base_card_id)).toEqual(base);
      // ... from the default order too, and twice (desc would be the flip).
      act(() => h.result.current.pickSort(column));
      act(() => h.result.current.pickSort(column));
      expect(h.result.current.sort).toEqual({ column: "number", direction: "asc" });
      expect(h.result.current.list.map((c) => c.base_card_id)).toEqual(base);
    }
  });

  it("a list handed a set or variants sort is built in the default order, both directions", () => {
    const base = buildVaultList(CARDS, freshFilterState(), DEFAULT_SORT_STATE, CTX).list.map(
      (c) => c.base_card_id
    );
    expect(base).toEqual([3, 4, 2, 1]);
    for (const column of ["set", "variants"] as const)
      for (const direction of ["asc", "desc"] as const)
        expect(
          buildVaultList(CARDS, freshFilterState(), { column, direction }, CTX).list.map(
            (c) => c.base_card_id
          )
        ).toEqual(base);
  });

  it("Cards Owned sorts by copies owned: total unscoped, the finish's copies when scoped", () => {
    // Owned: Vader 1+1 = 2, Childsen 3, Chimaera 3 (all Hyperspace), Luke 0.
    // Default order: Chimaera (ASH), then SOR by number: Luke, Childsen, Vader.
    const h = renderHook(() => useVaultViewOver(CARDS, SET_ORDER));
    // REPLACE (owner decision 2026-10-12 after review, T2): the first tap on
    // Cards Owned lands on most owned first (was ascending); the second flips.
    // Same four orders asserted as before, reached in the new sequence.
    act(() => h.result.current.pickSort("owned"));
    expect(h.result.current.sort).toEqual({ column: "owned", direction: "desc" });
    // Most first; the 3-3 tie falls to the default order (Chimaera, Childsen).
    expect(h.result.current.list.map((c) => c.base_card_id)).toEqual([3, 2, 1, 4]);
    act(() => h.result.current.pickSort("owned"));
    expect(h.result.current.sort).toEqual({ column: "owned", direction: "asc" });
    // Fewest first; the tie is STILL in the default order (not reversed).
    expect(h.result.current.list.map((c) => c.base_card_id)).toEqual([4, 1, 3, 2]);
    // Scoped to Hyperspace: Chimaera 3, Vader 1, Childsen 0 (Luke has none).
    act(() => h.result.current.setScope("Hyperspace"));
    expect(h.result.current.list.map((c) => c.base_card_id)).toEqual([2, 1, 3]);
    act(() => h.result.current.pickSort("owned"));
    expect(h.result.current.list.map((c) => c.base_card_id)).toEqual([3, 1, 2]);
  });

  // Owner decision 2026-10-12 after review: a per-column first direction, in
  // the phone's pick logic only.
  it("nextPhoneSort: Cards Owned first lands descending; every other sort ascending; active flips", () => {
    expect(PHONE_FIRST_DIRECTION).toEqual({ owned: "desc" });
    for (const from of [
      DEFAULT_SORT_STATE,
      { column: "name", direction: "desc" },
      { column: "value", direction: "asc" },
    ] as const) {
      expect(nextPhoneSort(from, "owned")).toEqual({ column: "owned", direction: "desc" });
      for (const column of SORT_ORDER) {
        if (column === "owned" || column === from.column) continue;
        expect(nextPhoneSort(from, column), column).toEqual({ column, direction: "asc" });
      }
    }
    // The active column flips, Cards Owned included, both ways.
    for (const column of SORT_ORDER) {
      expect(nextPhoneSort({ column, direction: "asc" }, column)).toEqual({
        column,
        direction: "desc",
      });
      expect(nextPhoneSort({ column, direction: "desc" }, column)).toEqual({
        column,
        direction: "asc",
      });
    }
    // A set / variants pick is still "Set | #" ascending, from anywhere.
    for (const column of ["set", "variants"] as const) {
      expect(nextPhoneSort({ column: "owned", direction: "desc" }, column)).toEqual(
        DEFAULT_SORT_STATE
      );
      expect(nextPhoneSort(DEFAULT_SORT_STATE, column)).toEqual(DEFAULT_SORT_STATE);
    }
    // Desktop's shared rule is untouched: a new column there is ascending.
    expect(nextSortState(DEFAULT_SORT_STATE, "owned")).toEqual({
      column: "owned",
      direction: "asc",
    });
  });

  it("the badge, the button's name and the list all follow the applied direction", () => {
    const h = renderHook(() => useVaultViewOver(CARDS, SET_ORDER));
    act(() => h.result.current.pickSort("owned"));
    expect(sortLabel(h.result.current.sort)).toBe("Sort: Cards Owned, descending");
    act(() => h.result.current.pickSort("owned"));
    expect(sortLabel(h.result.current.sort)).toBe("Sort: Cards Owned, ascending");
    act(() => h.result.current.pickSort("name"));
    expect(sortLabel(h.result.current.sort)).toBe("Sort: Name, ascending");
    act(() => h.result.current.pickSort("owned"));
    expect(sortLabel(h.result.current.sort)).toBe("Sort: Cards Owned, descending");
  });

  it("Cards Owned with nothing owned is the default order, both directions", () => {
    const empty = CARDS.map((c) => ({
      ...c,
      inventory: {},
      variants: c.variants.map((x) => ({ ...x, quantity: 0 })),
    }));
    const base = buildVaultList(empty, freshFilterState(), DEFAULT_SORT_STATE, CTX).list.map(
      (c) => c.base_card_id
    );
    for (const direction of ["asc", "desc"] as const)
      expect(
        buildVaultList(empty, freshFilterState(), { column: "owned", direction }, CTX).list.map(
          (c) => c.base_card_id
        )
      ).toEqual(base);
  });
});

describe("S1-17 Sort", () => {
  it("sheet pick follows nextSortState: new column asc, same column toggles", () => {
    const h = renderHook(() => useVaultViewOver(CARDS, SET_ORDER));
    expect(h.result.current.sort).toEqual(DEFAULT_SORT_STATE);
    act(() => h.result.current.pickSort("value"));
    expect(h.result.current.sort).toEqual(nextSortState(DEFAULT_SORT_STATE, "value"));
    expect(h.result.current.sort).toEqual({ column: "value", direction: "asc" });
    act(() => h.result.current.pickSort("value"));
    expect(h.result.current.sort).toEqual({ column: "value", direction: "desc" });
    // Value desc: 53 (Chimaera) > 6.8 (Vader) > 3 (Luke) > 0.09 (Childsen).
    expect(h.result.current.list.map((c) => c.base_card_id)).toEqual([3, 1, 4, 2]);
    act(() => h.result.current.pickSort("name"));
    expect(h.result.current.sort).toEqual({ column: "name", direction: "asc" });
  });

  it("scoped default order reads the scoped printing's number", () => {
    const s = withScope(freshFilterState(), "Hyperspace");
    const r = buildVaultList(CARDS, s, DEFAULT_SORT_STATE, CTX);
    // PORT (BL-258): same intent (scoped printing's number orders cards inside
    // a set); the set order is now newest first, so ASH (3) leads SOR (2, 1).
    expect(r.list.map((c) => c.base_card_id)).toEqual([3, 2, 1]);
  });
});
