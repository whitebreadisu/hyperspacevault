import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Stash, StashItem } from "../../api/stashes";
import { phoneCard } from "../../mobile/vault/phoneCardFixtures";
import { StashProvider } from "../../stashes/StashContext";
import { RETURN_ERRORS } from "../../stashes/useStashReturn";
import type { InventoryCard } from "../../utils/inventory";
import { StashesPane } from "./StashesPane";

// The desktop Stashes page, design 1b, one test (or more) per README state
// against the real StashesPane inside a StashProvider with the stash API
// mocked: A1/C1 table, C2 gallery, C3 empty stash, B1 no stashes, B2 New
// stash, D1 − with Undo, D2 trash, E1 in-place edit, E2 duplicate name, E3
// delete confirm; plus printing-level rows, the Vault's filters narrowing
// the pane, the row click opening the printing, and the exceeds_stash /
// exceeds_owned errors.

const api = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
  createStash: vi.fn(),
  updateStash: vi.fn(),
  deleteStash: vi.fn(),
  returnStashItems: vi.fn(),
  restoreStashItems: vi.fn(),
  putVariantAllocations: vi.fn(),
}));
vi.mock("../../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../../api/stashes")>()),
  ...api,
}));
import { StashApiError } from "../../api/stashes";

const LUKE = phoneCard({
  id: 1,
  name: "Luke Skywalker",
  subtitle: "Faithful Friend",
  set: "SOR",
  number: "5",
  variants: [
    {
      id: 11,
      finish: "Standard",
      number: "5",
      qty: 2,
      market: 4,
      frontImage: "https://cdn.example/cards/SOR_005.png",
    },
    {
      id: 12,
      finish: "Hyperspace",
      number: "269",
      qty: 1,
      market: 9,
      frontImage: "https://cdn.example/cards/SOR_269.png",
    },
  ],
});
const VADER = phoneCard({
  id: 2,
  name: "Darth Vader",
  type: "Leader",
  number: "10",
  variants: [{ id: 21, finish: "Standard", number: "10", qty: 1, market: 2 }],
});
const CARDS = [LUKE, VADER];

let stashes: Stash[];
let items: StashItem[];
const stash = (id: number, name: string, description: string | null = null): Stash => ({
  id,
  name,
  description,
  created_at: "2026-11-0" + id,
  copies: 0,
});
function withCopies(): Stash[] {
  return stashes.map((s) => ({
    ...s,
    copies: items.filter((i) => i.stash_id === s.id).reduce((n, i) => n + i.quantity, 0),
  }));
}

/** The backend's answer: the stash's remaining quantity for each printing
 * sent (0 = gone) and its new total. */
function moved(id: number, moves: { variant_id: number; quantity: number }[]) {
  const held = (v: number) =>
    items.find((i) => i.stash_id === id && i.variant_id === v)?.quantity ?? 0;
  return {
    stash_id: id,
    copies: items.filter((i) => i.stash_id === id).reduce((n, i) => n + i.quantity, 0),
    items: moves.map((m) => ({ variant_id: m.variant_id, quantity: held(m.variant_id) })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stashes = [
    stash(1, "Red binder", "Blue binder on the shelf"),
    stash(2, "Trade stash"),
    stash(3, "New box"),
  ];
  items = [
    { stash_id: 1, variant_id: 11, quantity: 2 },
    { stash_id: 1, variant_id: 12, quantity: 1 },
    { stash_id: 1, variant_id: 21, quantity: 1 },
  ];
  api.getStashes.mockImplementation(async () => withCopies());
  api.getStashItems.mockImplementation(async () => items.map((i) => ({ ...i })));
  api.returnStashItems.mockImplementation(
    async (id: number, moves: { variant_id: number; quantity: number }[]) => {
      for (const m of moves) {
        const it = items.find((i) => i.stash_id === id && i.variant_id === m.variant_id)!;
        it.quantity -= m.quantity;
      }
      items = items.filter((i) => i.quantity > 0);
      return moved(id, moves);
    }
  );
  api.restoreStashItems.mockImplementation(
    async (id: number, moves: { variant_id: number; quantity: number }[]) => {
      for (const m of moves) {
        const it = items.find((i) => i.stash_id === id && i.variant_id === m.variant_id);
        if (it) it.quantity += m.quantity;
        else items.push({ stash_id: id, ...m });
      }
      return moved(id, moves);
    }
  );
  api.updateStash.mockImplementation(async (id: number, patch: Partial<Stash>) => {
    const s = stashes.find((x) => x.id === id)!;
    Object.assign(s, patch);
    return { ...s };
  });
  api.deleteStash.mockImplementation(async (id: number) => {
    stashes = stashes.filter((s) => s.id !== id);
    items = items.filter((i) => i.stash_id !== id);
  });
  api.createStash.mockImplementation(async (name: string, description: string | null) => {
    const s = stash(9, name, description ?? null);
    stashes.push(s);
    return s;
  });
});

function Harness({
  list = CARDS,
  finishes = new Set<string>(),
  onOpen = vi.fn(),
  start = null,
}: {
  list?: InventoryCard[];
  finishes?: Set<string>;
  onOpen?: (c: number, v: number, o: number[]) => void;
  start?: number | null;
}) {
  const [selected, setSelected] = useState<number | null>(start);
  return (
    <StashProvider enabled>
      <StashesPane
        cards={CARDS}
        list={list}
        finishes={finishes}
        setOrder={{}}
        priceKind="market"
        onPriceKind={() => {}}
        selectedId={selected}
        onSelect={setSelected}
        onOpenPrinting={onOpen}
      />
    </StashProvider>
  );
}

const rows = () => document.querySelectorAll(".sp-tr:not(.sp-tr--head)");
const row = (vid: number) => document.querySelector<HTMLElement>(`.sp-tr[data-variant="${vid}"]`)!;
async function ready(props: Parameters<typeof Harness>[0] = {}) {
  const r = render(<Harness {...props} />);
  await screen.findByRole("heading", { name: "Stashes" });
  return r;
}

describe("A1 / C1: rail and table", () => {
  it("lists the stashes in creation order with copies and value; the first is selected", async () => {
    await ready();
    const names = [...document.querySelectorAll(".sp-railrow__name")].map((e) => e.textContent);
    expect(names).toEqual(["Red binder", "Trade stash", "New box"]);
    expect(document.querySelector(".sp-railrow--on .sp-railrow__name")!.textContent).toBe(
      "Red binder"
    );
    // 2 x $4 + 1 x $9 + 1 x $2
    expect(document.querySelector(".sp-railrow__value")!.textContent).toBe("$19.00");
    expect(document.querySelectorAll(".sp-railrow__value")[2].textContent).toBe("—");
    expect(screen.getByRole("heading", { name: "Red binder" })).toBeInTheDocument();
    // The rail's row and the head's full description.
    expect(screen.getAllByText("Blue binder on the shelf")).toHaveLength(2);
  });

  it("draws one row per printing in Set | # order, with the printing's own number", async () => {
    await ready();
    expect(rows()).toHaveLength(3);
    expect([...rows()].map((r) => r.getAttribute("data-variant"))).toEqual(["11", "21", "12"]);
    expect(within(row(12)).getByText("SOR 269")).toBeInTheDocument();
    expect(within(row(12)).getByText("Hyperspace")).toBeInTheDocument();
    expect(within(row(11)).getByText("$8.00")).toBeInTheDocument();
    // The leader's single copy is its playset: the chip is green.
    expect(row(21).querySelector(".sp-chip")!.className).toContain("playset-chip--complete");
  });

  it("re-sorts by a header and flips on a second click", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect([...rows()].map((r) => r.getAttribute("data-variant"))).toEqual(["21", "11", "12"]);
    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    // Ties (Luke's two printings) keep Set | # order.
    expect([...rows()].map((r) => r.getAttribute("data-variant"))).toEqual(["11", "12", "21"]);
  });

  it("switches the Value column between Total and Unit", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    expect(within(row(11)).getByText("$4.00")).toBeInTheDocument();
  });

  it("opens the card detail on that printing from a row", async () => {
    const onOpen = vi.fn();
    await ready({ onOpen });
    fireEvent.click(row(12));
    expect(onOpen).toHaveBeenCalledWith(1, 12, [1, 2]);
  });

  it("narrows to the Vault's filters", async () => {
    await ready({ list: [VADER] });
    expect([...rows()].map((r) => r.getAttribute("data-variant"))).toEqual(["21"]);
  });

  it("applies the Finish facet per printing", async () => {
    await ready({ finishes: new Set(["Hyperspace"]) });
    expect([...rows()].map((r) => r.getAttribute("data-variant"))).toEqual(["12"]);
  });

  it("says so when the filters leave nothing", async () => {
    await ready({ list: [] });
    expect(screen.getByText("No cards match the current filters.")).toBeInTheDocument();
  });
});

describe("C2 / C3", () => {
  it("C2: the gallery draws one tile per printing", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(document.querySelectorAll(".sp-tile")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Luke Skywalker, Hyperspace, 1 in this stash" })
    ).toBeInTheDocument();
  });

  it("C2: each tile is that printing's own art", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    const hyp = screen.getByRole("button", { name: "Luke Skywalker, Hyperspace, 1 in this stash" });
    expect(hyp.querySelector("img")!.getAttribute("src")).toContain("SOR_269");
    const std = screen.getByRole("button", { name: "Luke Skywalker, Standard, 2 in this stash" });
    expect(std.querySelector("img")!.getAttribute("src")).toContain("SOR_005");
  });

  it("C3: an empty stash says where copies come from", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /New box/ }));
    expect(
      screen.getByText("New box has no copies. Copies go into a stash from a card’s detail.")
    ).toBeInTheDocument();
  });
});

describe("B1 / B2", () => {
  it("B1: no stashes is one sentence and New stash", async () => {
    stashes = [];
    items = [];
    render(<Harness />);
    expect(
      await screen.findByText(
        "You have no stashes. A stash records where copies are kept, like a binder or a trade box."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New stash" })).toBeInTheDocument();
  });

  it("B2: New stash creates and selects it; no counts change", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /New stash/ }));
    const dlg = screen.getByRole("dialog", { name: "New stash" });
    expect(within(dlg).getByRole("button", { name: "Create stash" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    fireEvent.change(within(dlg).getAllByRole("textbox")[0], { target: { value: "With Bob" } });
    await act(async () => {
      fireEvent.click(within(dlg).getByRole("button", { name: "Create stash" }));
    });
    expect(api.createStash).toHaveBeenCalledWith("With Bob", null);
    await waitFor(() =>
      expect(document.querySelector(".sp-railrow--on .sp-railrow__name")!.textContent).toBe(
        "With Bob"
      )
    );
    expect(api.returnStashItems).not.toHaveBeenCalled();
  });

  it("B2: a duplicate name is refused inline", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /New stash/ }));
    const dlg = screen.getByRole("dialog", { name: "New stash" });
    fireEvent.change(within(dlg).getAllByRole("textbox")[0], { target: { value: "red BINDER" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Create stash" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent(
      "You already have a stash named red BINDER. Pick another name."
    );
    expect(api.createStash).not.toHaveBeenCalled();
  });
});

describe("D1 / D2: taking copies out, with Undo", () => {
  it("D1: − returns one copy at once, with the line, the sub-line and Undo", async () => {
    await ready();
    await act(async () => {
      fireEvent.click(within(row(11)).getByRole("button", { name: /Return one/ }));
    });
    expect(api.returnStashItems).toHaveBeenCalledWith(1, [{ variant_id: 11, quantity: 1 }]);
    await waitFor(() => expect(row(11).querySelector(".sp-chip")!.textContent).toBe("1"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    expect(screen.getByText("1 back in Vault")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(api.restoreStashItems).toHaveBeenCalledWith(1, [{ variant_id: 11, quantity: 1 }]);
    await waitFor(() => expect(row(11).querySelector(".sp-chip")!.textContent).toBe("2"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("D2: trash returns every copy of the printing and the row leaves", async () => {
    await ready();
    await act(async () => {
      fireEvent.click(within(row(11)).getByRole("button", { name: /Return all 2/ }));
    });
    expect(api.returnStashItems).toHaveBeenCalledWith(1, [{ variant_id: 11, quantity: 2 }]);
    await waitFor(() => expect(row(11)).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 Luke Skywalker · Standard are back in your Vault."
    );
  });

  it("another return replaces the line; leaving the stash drops it", async () => {
    await ready();
    await act(async () => {
      fireEvent.click(within(row(11)).getByRole("button", { name: /Return one/ }));
    });
    await act(async () => {
      fireEvent.click(within(row(21)).getByRole("button", { name: /Return one/ }));
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 Darth Vader · Standard is back")
    );
    fireEvent.click(screen.getByRole("button", { name: /Trade stash/ }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("exceeds_stash: says what is wrong, re-reads, writes nothing more", async () => {
    await ready();
    api.returnStashItems.mockRejectedValueOnce(new StashApiError("exceeds_stash", 409));
    const reads = api.getStashItems.mock.calls.length;
    await act(async () => {
      fireEvent.click(within(row(11)).getByRole("button", { name: /Return one/ }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(RETURN_ERRORS.exceedsStash);
    expect(screen.getByRole("alert")).toHaveTextContent(RETURN_ERRORS.exceedsStashHint);
    expect(api.getStashItems.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("exceeds_owned on Undo: says so and the Undo is gone", async () => {
    await ready();
    await act(async () => {
      fireEvent.click(within(row(11)).getByRole("button", { name: /Return one/ }));
    });
    api.restoreStashItems.mockRejectedValueOnce(new StashApiError("exceeds_owned", 409));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(RETURN_ERRORS.exceedsOwned);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("refresh failures", () => {
  it("a return shows the server's answer at once; a failed refresh offers Try again", async () => {
    await ready();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getStashItems.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      fireEvent.click(within(row(11)).getByRole("button", { name: /Return one/ }));
    });
    expect(row(11).querySelector(".sp-chip")!.textContent).toBe("1");
    expect(document.querySelector(".sp-railrow__copies")!.textContent).toBe("3");
    expect(screen.getByText(/The stash list did not refresh\./)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(screen.queryByText(/The stash list did not refresh\./)).toBeNull();
    err.mockRestore();
  });

  it("Undo shows the restored rows even when its refresh fails", async () => {
    await ready();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      fireEvent.click(within(row(11)).getByRole("button", { name: /Return all 2/ }));
    });
    await waitFor(() => expect(row(11)).toBeNull());
    api.getStashItems.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(row(11).querySelector(".sp-chip")!.textContent).toBe("2");
    expect(screen.getByText(/The stash list did not refresh\./)).toBeInTheDocument();
    err.mockRestore();
  });

  it("the first load failing offers Try again instead of loading forever", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getStashes.mockRejectedValueOnce(new Error("offline"));
    render(<Harness />);
    expect(await screen.findByText(/Your stashes did not load\./)).toBeInTheDocument();
    expect(screen.queryByText("Loading stashes…")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByRole("heading", { name: "Stashes" })).toBeInTheDocument();
    err.mockRestore();
  });
});

describe("E1 / E2 / E3", () => {
  it("E1: the pencil edits name and description in place", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Edit name and description" }));
    const form = screen.getByRole("form", { name: "Edit stash" });
    fireEvent.change(within(form).getAllByRole("textbox")[0], { target: { value: "Binder A" } });
    fireEvent.change(within(form).getAllByRole("textbox")[1], { target: { value: "Shelf two" } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    });
    expect(api.updateStash).toHaveBeenCalledWith(1, { name: "Binder A", description: "Shelf two" });
    expect(await screen.findByRole("heading", { name: "Binder A" })).toBeInTheDocument();
  });

  it("E2: a duplicate name turns the field red, Save off until it changes", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Edit name and description" }));
    const form = screen.getByRole("form", { name: "Edit stash" });
    const name = within(form).getAllByRole("textbox")[0];
    fireEvent.change(name, { target: { value: "Trade stash" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "You already have a stash named Trade stash. Pick another name."
    );
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(within(form).getByRole("button", { name: "Save" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(api.updateStash).not.toHaveBeenCalled();
  });

  it("E2: the server's 409 is the same error", async () => {
    await ready();
    api.updateStash.mockRejectedValueOnce(new StashApiError("duplicate_name", 409));
    fireEvent.click(screen.getByRole("button", { name: "Edit name and description" }));
    const form = screen.getByRole("form", { name: "Edit stash" });
    fireEvent.change(within(form).getAllByRole("textbox")[0], { target: { value: "Elsewhere" } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    });
    expect(within(form).getByRole("alert")).toHaveTextContent(
      "You already have a stash named Elsewhere."
    );
  });

  it("E3: delete asks first, then the copies go back and the next stash shows", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Edit name and description" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete stash" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent("Delete Red binder?");
    expect(dlg).toHaveTextContent("Its 4 copies go back to your Vault.");
    expect(dlg).toHaveTextContent(
      "You still own every copy. Only the stash and its name and description are deleted."
    );
    // Cancel keeps it.
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(api.deleteStash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete stash" }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete stash" })
      );
    });
    expect(api.deleteStash).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(document.querySelector(".sp-railrow--on .sp-railrow__name")!.textContent).toBe(
        "Trade stash"
      )
    );
  });
});
