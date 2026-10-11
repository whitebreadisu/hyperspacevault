import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// BL-248 S2-20 (BL-244, additive): the Filters sheet captures desktop's
// filter events with desktop's property shapes + layout: "phone" --
// filter_applied {field, active_filter_count, results_count} once per user
// edit after the render that applied it (CardsPage BL-235), filters_cleared
// on Reset (FilterPanel), finish_scope_changed only on a scope pick
// (CardsPage handleScopeChange) -- never on a Finish-facet edit.
vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));

import { capture } from "../../analytics/analytics";
import { useVaultViewOver } from "../vault/useVaultView";
import { filterActions } from "./filterModel";
import { useFilterApplied } from "./FiltersSheet";

const spy = vi.mocked(capture);
const calls = (event: string) => spy.mock.calls.filter(([e]) => e === event).map(([, p]) => p);

function useSheet() {
  const vv = useVaultViewOver([], {});
  const onField = useFilterApplied(vv.list, vv.activeCount);
  return { vv, act: filterActions(vv, onField) };
}

describe("S2-20 Filters analytics (filter_applied / filters_cleared / finish_scope_changed)", () => {
  beforeEach(() => spy.mockClear());

  it("filter_applied once per edit with desktop's field names and post-change counts", () => {
    const { result } = renderHook(useSheet);
    act(() => result.current.act.toggleSet("SOR"));
    act(() => result.current.act.toggleRarity("Rare"));
    act(() => result.current.act.setAspectMode("any"));
    act(() => result.current.act.tapAspect("Aggression"));
    act(() => result.current.act.toggleIn("keyword", "Raid"));
    act(() => result.current.act.setRange("cost", [0, 5]));
    act(() => result.current.act.toggleToggle("unowned"));
    act(() => result.current.act.removeSet("SOR"));
    expect(calls("filter_applied")).toEqual([
      { field: "set", active_filter_count: 1, results_count: 0, layout: "phone" },
      { field: "rarity", active_filter_count: 2, results_count: 0, layout: "phone" },
      { field: "aspect_mode", active_filter_count: 3, results_count: 0, layout: "phone" },
      { field: "aspect", active_filter_count: 3, results_count: 0, layout: "phone" },
      { field: "keyword", active_filter_count: 4, results_count: 0, layout: "phone" },
      { field: "cost", active_filter_count: 5, results_count: 0, layout: "phone" },
      { field: "no_inventory", active_filter_count: 6, results_count: 0, layout: "phone" },
      { field: "set", active_filter_count: 5, results_count: 0, layout: "phone" },
    ]);
  });

  it("a Finish edit is filter_applied 'finish' (scope disengages, no scope event); a scope pick is finish_scope_changed; Reset is filters_cleared", () => {
    const { result } = renderHook(useSheet);
    act(() => result.current.vv.setScope("Hyperspace Foil"));
    act(() => result.current.act.toggleFinish("Standard Foil"));
    expect(result.current.vv.state.scope).toBeNull();
    act(() => result.current.act.reset());
    expect(calls("finish_scope_changed")).toEqual([{ finish: "Hyperspace Foil", layout: "phone" }]);
    expect(calls("filter_applied")).toEqual([
      { field: "finish", active_filter_count: 1, results_count: 0, layout: "phone" },
    ]);
    expect(calls("filters_cleared")).toEqual([{ layout: "phone" }]);
  });

  it("nothing fires without a user edit (a re-render or quantities refresh is silent)", () => {
    const { rerender } = renderHook(useSheet);
    rerender();
    expect(calls("filter_applied")).toEqual([]);
  });
});
