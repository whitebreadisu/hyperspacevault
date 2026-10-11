import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BaseCardCatalogWithQuantity } from "../../api/baseCards";
import { nextSortState, DEFAULT_SORT_STATE } from "../../utils/cardSort";
import { DEFAULT_FILTERS } from "../../utils/filters";
import { toInventoryCards } from "../../utils/inventory";
import { useVaultViewOver } from "./useVaultView";
import {
  activeFilterCount,
  buildVaultList,
  freshFilterState,
  isNarrowed,
  matchesQuery,
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
  it("13 scope values, Showcase excluded", () => {
    expect(SCOPE_VALUES).toHaveLength(13);
    expect(SCOPE_VALUES).not.toContain("Showcase");
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
    expect(r.list.map((c) => c.base_card_id)).toEqual([2, 1, 3]);
  });
});
