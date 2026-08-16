import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { GallerySortHeader } from "./GallerySortHeader";
import { DEFAULT_SORT_STATE } from "../../utils/cardSort";
import type { SortState } from "../../utils/cardSort";

// CREATE (BL-222, Issue #134): unit coverage for the Gallery view's own
// header bar. The shared-state PROOF that a sort/scope set from this
// component is visible in CardsTable too lives at the CardsPage level
// (CardsPage.test.tsx's own BL-222 describe block) -- this file only proves
// GallerySortHeader itself renders the ten entries correctly and reports
// clicks up through its props, mirroring CardsTable.test.tsx's own
// "sortable headers" coverage shape (BL-213) for the table.

const ALL_ENTRY_LABELS = [
  "#",
  "Name",
  "Variants",
  "Playset",
  "Value",
  "Rarity",
  "Cost",
  "Power",
  "HP",
  "Set",
];

function renderHeader(
  overrides: Partial<{
    sortState: SortState;
    onSortChange: (column: string) => void;
    scope: string | null;
    onScopeChange: (raw: string | null) => void;
    valueDisplay: "unit" | "collection";
    priceKind: "market" | "low";
  }> = {}
) {
  const onSortChange = overrides.onSortChange ?? vi.fn();
  const onScopeChange = overrides.onScopeChange ?? vi.fn();
  const onValueDisplayChange = vi.fn();
  const onPriceKindChange = vi.fn();
  const utils = render(
    <GallerySortHeader
      sortState={overrides.sortState ?? DEFAULT_SORT_STATE}
      onSortChange={onSortChange}
      scope={overrides.scope ?? null}
      onScopeChange={onScopeChange}
      valueDisplay={overrides.valueDisplay ?? "unit"}
      onValueDisplayChange={onValueDisplayChange}
      priceKind={overrides.priceKind ?? "market"}
      onPriceKindChange={onPriceKindChange}
    />
  );
  return { ...utils, onSortChange, onScopeChange, onValueDisplayChange, onPriceKindChange };
}

// CREATE (BL-225): full table-header parity -- the Value entry hosts the
// same UNIT/COLLECTION + MKT/LOW switches as the table's Value column, and
// scope-driven entries take the table's scoped amber vocabulary.
describe("GallerySortHeader table parity (BL-225, CREATE)", () => {
  // Round 6 (owner): the gallery has no price surface, so the switches
  // render ONLY while Value is the active sort (their sole in-gallery
  // effect is the Value ordering).
  it("renders the UNIT/COLLECTION and MKT/LOW switches while sorted by Value, and reports toggles", () => {
    const { container, onValueDisplayChange, onPriceKindChange } = renderHeader({
      sortState: { column: "value", direction: "asc" },
    });
    const valueEntry = container.querySelector(".gallery-sort-header__entry--value")!;
    const switches = within(valueEntry as HTMLElement).getAllByRole("switch");
    expect(switches).toHaveLength(2);
    fireEvent.click(switches[0]); // UNIT/COLLECTION (large, first per table order)
    expect(onValueDisplayChange).toHaveBeenCalledWith("collection");
    fireEvent.click(switches[1]); // MKT/LOW
    expect(onPriceKindChange).toHaveBeenCalledWith("low");
  });

  it("renders NO switches while the sort is anything other than Value", () => {
    const { container } = renderHeader(); // default: # ascending
    const valueEntry = container.querySelector(".gallery-sort-header__entry--value")!;
    expect(within(valueEntry as HTMLElement).queryAllByRole("switch")).toHaveLength(0);
  });

  // Round 3 (owner): Playset joins #/Value in the scoped amber vocabulary.
  it("marks the #, Playset, and Value entries scoped (amber vocabulary) while a scope is active", () => {
    const { container } = renderHeader({ scope: "Standard Foil" });
    const scoped = container.querySelectorAll(".gallery-sort-header__entry--scoped");
    expect(scoped).toHaveLength(3);
  });

  it("renders no scoped modifier without a scope", () => {
    const { container } = renderHeader();
    expect(container.querySelector(".gallery-sort-header__entry--scoped")).toBeNull();
  });

  // Round 3 (owner): the table's amber bracket, mirrored -- overlays the
  // #-through-Value group while a scope is active, naming the scope and the
  // affected content exactly like .vs-bracket--inhead does.
  it("renders the amber bracket with the scope's short name while scoped, and not otherwise", () => {
    const { container } = renderHeader({ scope: "Standard Foil" });
    const bracket = container.querySelector(".gallery-sort-header__bracket");
    expect(bracket).toBeTruthy();
    expect(bracket!.textContent).toContain("CARD # + PIPS + VALUE");
    const { container: unscoped } = renderHeader();
    expect(unscoped.querySelector(".gallery-sort-header__bracket")).toBeNull();
  });
});

describe("GallerySortHeader entries (BL-222, CREATE)", () => {
  it("renders all ten sortable entries, each as a button with its label", () => {
    renderHeader();
    for (const label of ALL_ENTRY_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("defaults to # ascending, matching CardsPage's own default", () => {
    const { container } = renderHeader();
    const numberEntry = container.querySelector(".gallery-sort-header__entry");
    expect(numberEntry).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("button", { name: "#" }).className).toContain("th-sort-btn--asc");
  });

  it("every other entry reads aria-sort='none' while # is active", () => {
    const { container } = renderHeader();
    const entries = Array.from(container.querySelectorAll(".gallery-sort-header__entry"));
    // First entry is # (ascending); every remaining entry is "none".
    for (const entry of entries.slice(1)) {
      expect(entry).toHaveAttribute("aria-sort", "none");
    }
  });

  it("reflects an active descending sort on the matching entry, and 'none' elsewhere", () => {
    const { container } = renderHeader({ sortState: { column: "value", direction: "desc" } });
    const valueBtn = screen.getByRole("button", { name: "Value" });
    expect(valueBtn.className).toContain("th-sort-btn--desc");
    const numberEntry = container.querySelector(".gallery-sort-header__entry")!;
    expect(numberEntry).toHaveAttribute("aria-sort", "none");
  });

  it("clicking any entry's button reports its column via onSortChange", () => {
    const { onSortChange } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Rarity" }));
    expect(onSortChange).toHaveBeenCalledWith("rarity");
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(onSortChange).toHaveBeenCalledWith("set");
    fireEvent.click(screen.getByRole("button", { name: "HP" }));
    expect(onSortChange).toHaveBeenCalledWith("hp");
  });

  it("clicking the Playset entry's own sort button reports 'playset' without triggering the scope trigger", () => {
    const { onSortChange, onScopeChange, container } = renderHeader();
    // The scope trigger button carries `.vs-header-scope__trigger`, not
    // `.th-sort-btn` -- scoping to the latter reaches the Playset entry's
    // OWN sort button specifically, mirroring CardsTable.test.tsx's
    // equivalent `.th-playset-label` query.
    fireEvent.click(container.querySelector(".gallery-sort-header__entry--playset .th-sort-btn")!);
    expect(onSortChange).toHaveBeenCalledWith("playset");
    expect(onScopeChange).not.toHaveBeenCalled();
  });
});

// CREATE (BL-222 point 2): the Playset entry hosts the SAME variant-scope
// trigger the table's Playset header hosts (VariantScopeControls'
// CardsScopeTrigger, reused verbatim) -- unscoped/scoped labels and the
// amber "on" treatment prove it's the real shared control, not a fork. No
// bracket -- "nothing to span in the gallery" (owner spec).
describe("GallerySortHeader scope trigger (BL-222, CREATE)", () => {
  it("hosts the scope trigger on the Playset entry, reading ALL FINISHES unscoped", () => {
    const { container } = renderHeader({ scope: null });
    const playsetEntry = container.querySelector(".gallery-sort-header__entry--playset")!;
    const trigger = playsetEntry.querySelector(".vs-header-scope__trigger")!;
    expect(trigger.textContent).toContain("ALL FINISHES");
    expect(trigger.className).not.toContain("vs-header-scope__trigger--on");
  });

  it("reads the scoped finish and carries the amber --on treatment while scoped", () => {
    const { container } = renderHeader({ scope: "Hyperspace" });
    const playsetEntry = container.querySelector(".gallery-sort-header__entry--playset")!;
    const trigger = playsetEntry.querySelector(".vs-header-scope__trigger")!;
    expect(trigger.textContent).toContain("Hyperspace");
    expect(trigger.className).toContain("vs-header-scope__trigger--on");
  });

  // RETIRED (owner round 3, 2026-08-16): the original "never renders a
  // bracket -- nothing to span" decision was reversed by BL-225's
  // full-table-parity direction; the #-through-Value group now IS the span.
  // The bracket's positive behavior is covered in the BL-225 describe above.

  it("clicking a scope option in the trigger's menu reports it via onScopeChange", () => {
    const { onScopeChange, container } = renderHeader({ scope: null });
    const trigger = container.querySelector(".vs-header-scope__trigger")!;
    fireEvent.click(trigger);
    // Mirrors CardsPage.test.tsx's own scope-picking helper: two pair rows
    // both carry a "Non-foil" chip (Standard's and Hyperspace's), so the
    // pick must be scoped to the specific row by its label first.
    const pairRows = document.querySelectorAll(".vs-scope-menu__row--chips");
    const standardRow = Array.from(pairRows).find(
      (r) => r.querySelector(".vs-scope-menu__row-label")?.textContent === "Standard"
    )!;
    fireEvent.click(within(standardRow as HTMLElement).getByText("Non-foil"));
    expect(onScopeChange).toHaveBeenCalledWith("Standard");
  });
});

// CREATE (BL-222 point 1, shared-state shape): proves this component reads
// and writes the SAME SortState/scope props it's given rather than owning
// any local copy -- the cross-view persistence itself (CardsPage handing the
// identical state to both CardsTable and this component) is proven at the
// CardsPage level.
describe("GallerySortHeader has no local sort/scope state of its own (BL-222, CREATE)", () => {
  it("re-rendering with a new sortState prop immediately reflects it (no internal state to go stale)", () => {
    const valueProps = {
      valueDisplay: "unit" as const,
      onValueDisplayChange: vi.fn(),
      priceKind: "market" as const,
      onPriceKindChange: vi.fn(),
    };
    const { rerender } = render(
      <GallerySortHeader
        sortState={DEFAULT_SORT_STATE}
        onSortChange={vi.fn()}
        scope={null}
        onScopeChange={vi.fn()}
        {...valueProps}
      />
    );
    expect(screen.getByRole("button", { name: "#" }).className).toContain("th-sort-btn--asc");

    rerender(
      <GallerySortHeader
        sortState={{ column: "name", direction: "desc" }}
        onSortChange={vi.fn()}
        scope={null}
        onScopeChange={vi.fn()}
        {...valueProps}
      />
    );
    expect(screen.getByRole("button", { name: "#" }).className).not.toContain("th-sort-btn--asc");
    expect(screen.getByRole("button", { name: "Name" }).className).toContain("th-sort-btn--desc");
  });
});
