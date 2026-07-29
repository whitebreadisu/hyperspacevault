import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SetDropdown } from "./SetDropdown";
import { BASE_SET_ORDER } from "../../utils/setGrouping";
import type { CardSet } from "../../api/sets";

// BL-164 §5: SetDropdown is the custom logo-rail listbox that replaces
// AddCardsSetBar's unlocked-state native `<select>`. These tests cover the
// aria-label contract (test-facing, per Set_Grouping_Context's "Fixed"
// list), the base-only vs. all-sets grouping order, and open/close
// mechanics (Escape, click-away, pick).

function makeSet(code: string, isBase = true): CardSet {
  return { id: code.length, code, name: `${code} Name`, is_base_set: isBase, release_date: null };
}

const ALL_TEN = BASE_SET_ORDER.map((c) => makeSet(c));

describe("SetDropdown", () => {
  it("carries aria-label='Set' on the trigger AND the listbox panel", () => {
    render(<SetDropdown sets={ALL_TEN} onChoose={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Set" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "Set" })).toBeInTheDocument();
  });

  it("base-only view (default): canonical rail groups in release order, divider, then secondary", () => {
    render(<SetDropdown sets={ALL_TEN} onChoose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    const options = screen.getAllByRole("option");
    // Every one of the ten base sets appears, canonical (SOR..ASH) then
    // secondary (IBH, TS26) -- the guaranteed order.
    expect(options.map((o) => o.getAttribute("aria-label")?.split(" — ")[0])).toEqual(
      BASE_SET_ORDER
    );
  });

  it("all-sets view: 'Show all sets' reveals Exclusives subgroups after the base groups", () => {
    const sets = [...ALL_TEN, makeSet("C24", false), makeSet("C25", false)];
    render(<SetDropdown sets={sets} onChoose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.click(screen.getByText("Show all sets"));

    expect(screen.getByText("Convention Exclusives")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    const codes = options.map((o) => o.getAttribute("aria-label")?.split(" — ")[0]);
    // Base groups (in order) come before the Exclusives rows.
    expect(codes.slice(0, BASE_SET_ORDER.length)).toEqual(BASE_SET_ORDER);
    expect(codes.slice(BASE_SET_ORDER.length)).toEqual(["C24", "C25"]);
  });

  it("all-sets view nests a base set's Weekly Play row right after its own row", () => {
    const sets = [makeSet("SOR"), makeSet("SORP", false)];
    render(<SetDropdown sets={sets} onChoose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.click(screen.getByText("Show all sets"));

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-label")?.split(" — ")[0])).toEqual([
      "SOR",
      "SORP",
    ]);
  });

  it("toggling 'Show all sets' back to 'Base sets only' drops the Exclusives rows", () => {
    const sets = [...ALL_TEN, makeSet("C24", false)];
    render(<SetDropdown sets={sets} onChoose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.click(screen.getByText("Show all sets"));
    expect(screen.queryByText("Convention Exclusives")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Base sets only"));
    expect(screen.queryByText("Convention Exclusives")).not.toBeInTheDocument();
  });

  it("clicking an option calls onChoose with its code and closes the listbox", () => {
    const onChoose = vi.fn();
    render(<SetDropdown sets={ALL_TEN} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.click(screen.getByRole("option", { name: /^SHD —/ }));

    expect(onChoose).toHaveBeenCalledWith("SHD");
    expect(screen.queryByRole("listbox", { name: "Set" })).not.toBeInTheDocument();
  });

  it("Escape closes the open listbox", () => {
    render(<SetDropdown sets={ALL_TEN} onChoose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.getByRole("listbox", { name: "Set" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Set" })).not.toBeInTheDocument();
  });

  it("a click outside the trigger/panel closes the open listbox", () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <SetDropdown sets={ALL_TEN} onChoose={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.getByRole("listbox", { name: "Set" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox", { name: "Set" })).not.toBeInTheDocument();
  });

  it("omits a set entirely from either view when absent from the fetched sets list", () => {
    render(<SetDropdown sets={[makeSet("SOR")]} onChoose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
