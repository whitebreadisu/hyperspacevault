import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BaseCardCatalogWithQuantity } from "../../api/baseCards";
import { DEFAULT_FILTERS } from "../../utils/filters";
import { toInventoryCards } from "../../utils/inventory";
import { useVaultViewOver } from "../vault/useVaultView";
import { freshFilterState, withFilters, withScope } from "../vault/vaultModel";
import {
  collectionChips,
  facetBase,
  facetValid,
  filterActions,
  finishChips,
  gameplayCount,
  optionState,
  rarityOptions,
  setChips,
} from "./filterModel";

type V = BaseCardCatalogWithQuantity["variants"][number];
const v = (id: number, finish: string, num: string, qty = 0, set = "SOR"): V =>
  ({
    variant_id: id,
    variant_type: finish,
    finish,
    channel: "Retail",
    source_set_code: set,
    card_number: num,
    front_image_url: null,
    back_image_url: null,
    price: null,
    quantity: qty,
  }) as V;
const base = (
  id: number,
  set: string,
  num: string,
  name: string,
  rarity: string,
  variants: V[]
): BaseCardCatalogWithQuantity =>
  ({
    id,
    set_code: set,
    base_card_number: num,
    name,
    subtitle: null,
    type: "Unit",
    rarity,
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

const SET_ORDER = { SOR: "2024-03-08", IBH: "2025-01-01", ASH: "2026-07-01" };
const CARDS = toInventoryCards(
  [
    base(1, "SOR", "87", "Darth Vader", "Legendary", [
      v(11, "Standard", "87", 1),
      v(12, "Hyperspace", "339", 1),
    ]),
    base(2, "SOR", "35", "Lieutenant Childsen", "Common", [
      v(21, "Standard", "35", 3),
      v(22, "Hyperspace", "300", 0),
    ]),
    base(3, "ASH", "52", "Chimaera", "Rare", [
      v(31, "Standard", "52", 0, "ASH"),
      v(32, "Hyperspace", "310", 3, "ASH"),
    ]),
    base(4, "IBH", "1", "Luke Skywalker", "Special", [v(41, "Standard", "1", 0, "IBH")]),
  ],
  SET_ORDER
);

describe("S2-14 Filter model wiring (live, scope rules)", () => {
  it("edits apply live to the Vault list (no draft)", () => {
    const h = renderHook(() => useVaultViewOver(CARDS, SET_ORDER));
    act(() => filterActions(h.result.current).toggleRarity("Rare"));
    expect(h.result.current.list.map((c) => c.base_card_id)).toEqual([3]);
    expect(h.result.current.activeCount).toBe(1);
    act(() => filterActions(h.result.current).toggleRarity("Rare"));
    expect(h.result.current.list).toHaveLength(4);
    expect(h.result.current.narrowed).toBe(false);
  });

  it("b2-facet-edit-disengages: removing a Finish value disengages the scope", () => {
    const h = renderHook(() => useVaultViewOver(CARDS, SET_ORDER, { finish: "Hyperspace" }));
    expect(h.result.current.state.scope).toBe("Hyperspace");
    act(() => filterActions(h.result.current).removeFinish("Hyperspace"));
    expect(h.result.current.state.scope).toBeNull();
    expect(h.result.current.state.filters.finish.size).toBe(0);
  });

  it("b2-other-facet-keeps: Rarity, Set and toggle edits keep the scope", () => {
    const h = renderHook(() =>
      useVaultViewOver(CARDS, SET_ORDER, { finish: "Hyperspace", set: "SOR,ASH" })
    );
    act(() => filterActions(h.result.current).toggleRarity("Rare"));
    act(() => filterActions(h.result.current).removeSet("SOR"));
    act(() => h.result.current.setToggles({ ...h.result.current.state.toggles, owned: true }));
    act(() => filterActions(h.result.current).removeToggle("owned"));
    const s = h.result.current.state;
    expect(s.scope).toBe("Hyperspace");
    expect([...s.filters.finish]).toEqual(["Hyperspace"]);
    expect([...s.filters.rarity]).toEqual(["Rare"]);
    expect([...s.filters.set]).toEqual(["ASH"]);
    expect(s.toggles.owned).toBe(false);
  });

  it("b2-reset-disengages: Reset = desktop Reset (facets, search, toggles, scope)", () => {
    const h = renderHook(() =>
      useVaultViewOver(CARDS, SET_ORDER, { finish: "Hyperspace", set: "SOR", q: "vader" })
    );
    act(() => h.result.current.setToggles({ ...h.result.current.state.toggles, unowned: true }));
    expect(h.result.current.activeCount).toBe(4);
    act(() => filterActions(h.result.current).reset());
    expect(h.result.current.state).toEqual(freshFilterState());
    expect(h.result.current.activeCount).toBe(0);
  });

  it("gameplayCount = one bump per Gameplay group (mode-only counts, desktop quirk)", () => {
    expect(gameplayCount(DEFAULT_FILTERS)).toBe(0);
    expect(gameplayCount({ ...DEFAULT_FILTERS, aspectMode: "any" })).toBe(1);
    expect(
      gameplayCount({
        ...DEFAULT_FILTERS,
        type: new Set(["Leader", "Unit"]),
        arena: new Set(["Ground"]),
        costRange: [2, 15],
      })
    ).toBe(3);
  });

  it("row chips: logos for base sets, short names, amber where the scope wrote", () => {
    const f = { ...DEFAULT_FILTERS, set: new Set(["ASH", "LAWP"]) };
    expect(setChips(f, new Set(["ASH"]), { ASH: "Ashes of the Empire" })).toEqual([
      {
        v: "ASH",
        name: "Ashes of the Empire",
        logo: "/images/set_ASH.png",
        text: "ASH",
        scoped: false,
      },
      { v: "LAWP", name: "LAWP", logo: null, text: "LAWP", scoped: false },
    ]);
    const s = withScope(freshFilterState(), "Hyperspace Foil");
    expect(finishChips(s.filters, s.scope).map((c) => [c.text, c.scoped])).toEqual([
      ["HS Foil", true],
    ]);
    const edited = withFilters(s, {
      ...s.filters,
      finish: new Set(["Hyperspace Foil", "Standard"]),
    });
    expect(finishChips(edited.filters, edited.scope).every((c) => !c.scoped)).toBe(true);
    const t = { incomplete: true, owned: false, unowned: true, overcap: false };
    expect(collectionChips(t, null, true).map((c) => c.text)).toEqual(["Incomplete", "Don't own"]);
    expect(collectionChips(t, "Hyperspace", true).every((c) => c.scoped)).toBe(true);
    expect(collectionChips(t, null, false)).toEqual([]);
  });
});

describe("S2-15 Dead ends inert", () => {
  it("a 0-match rarity under the other filters is '(0)' and not addable", () => {
    const s = withFilters(freshFilterState(), { ...DEFAULT_FILTERS, set: new Set(["IBH"]) });
    const opts = rarityOptions(facetBase(CARDS, s, null), s.filters);
    expect(opts.map((o) => o.label)).toEqual([
      "Common (0)",
      "Uncommon (0)",
      "Rare (0)",
      "Legendary (0)",
      "Special",
    ]);
    expect(optionState(opts[0], s.filters.rarity)).toEqual({
      on: false,
      inert: true,
      blocked: true,
    });
    expect(optionState(opts[4], s.filters.rarity).blocked).toBe(false);
  });

  it("a field never facets itself: other sets stay addable under a set", () => {
    const s = withFilters(freshFilterState(), { ...DEFAULT_FILTERS, set: new Set(["IBH"]) });
    const valid = facetValid(facetBase(CARDS, s, null), s.filters, "set")!;
    expect(valid.has("ASH")).toBe(true);
    expect(valid.has("SOR")).toBe(true);
  });

  it("b1-selected-never-hidden: a selected value that became 0 stays, inert but removable", () => {
    const s = withFilters(freshFilterState(), {
      ...DEFAULT_FILTERS,
      set: new Set(["IBH"]),
      rarity: new Set(["Common"]),
    });
    const common = rarityOptions(facetBase(CARDS, s, null), s.filters)[0];
    expect(common.label).toBe("Common (0)");
    expect(optionState(common, s.filters.rarity)).toEqual({
      on: true,
      inert: true,
      blocked: false,
    });
  });

  it("the facet universe honours the toggles and the search (desktop toggleNarrowed + search)", () => {
    const s = { ...freshFilterState(), query: "vader" };
    const valid = facetValid(facetBase(CARDS, s, null), s.filters, "rarity")!;
    expect([...valid]).toEqual(["Legendary"]);
    const owned = {
      ...freshFilterState(),
      toggles: { ...freshFilterState().toggles, owned: true },
    };
    expect(
      facetBase(CARDS, owned, null)
        .map((c) => c.base_card_id)
        .sort()
    ).toEqual([1, 2, 3]);
    expect(facetValid([], DEFAULT_FILTERS, "rarity")).toBeNull();
  });
});
