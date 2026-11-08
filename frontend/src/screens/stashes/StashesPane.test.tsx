import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stash, StashItem } from "../../api/stashes";
import { phoneCard } from "../../mobile/vault/phoneCardFixtures";
import { StashProvider } from "../../stashes/StashContext";
import { RETURN_ERRORS } from "../../stashes/useStashReturn";
import type { InventoryCard } from "../../utils/inventory";
import { RAIL_DOCK_MIN_WIDTH, StashesPane } from "./StashesPane";

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
  // The rail's folded state is per viewer (localStorage); each test starts open.
  window.localStorage.removeItem("swu.stashes.railCollapsed");
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

const rows = () => document.querySelectorAll("tbody .sp-tr");
const table = () => screen.getByRole("table", { name: "Copies in this stash" });
const order = () => [...rows()].map((r) => r.getAttribute("data-variant"));
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

  // Replaces "draws one row per printing in Set | # order" (R1-15,
  // 2026-11-08: the default is the base card number, so Luke's two
  // printings sit together).
  it("draws one row per printing, base card order first, with the printing's own number", async () => {
    await ready();
    expect(rows()).toHaveLength(3);
    expect(order()).toEqual(["11", "12", "21"]);
    expect(within(row(12)).getByText("SOR 269")).toBeInTheDocument();
    expect(within(row(12)).getByText("Hyperspace")).toBeInTheDocument();
    expect(within(row(11)).getByText("$8.00")).toBeInTheDocument();
    // The leader's single copy is its playset: the chip is green.
    expect(row(21).querySelector(".playset-chip")!.className).toContain("playset-chip--complete");
  });

  // Ported (the header is the Vault's data-table th-sort-btn; the sort bar
  // carries a second Name button bound to the same sort).
  it("re-sorts by a header and flips on a second click", async () => {
    await ready();
    fireEvent.click(within(table()).getByRole("button", { name: "Name" }));
    expect(order()).toEqual(["21", "11", "12"]);
    expect(within(table()).getByRole("button", { name: "Name" }).className).toContain(
      "th-sort-btn--asc"
    );
    fireEvent.click(within(table()).getByRole("button", { name: "Name" }));
    // Ties (Luke's two printings) keep base card order.
    expect(order()).toEqual(["11", "12", "21"]);
  });

  // Ported: Unit / Total is the Vault's ValueSwitch (was a two-button seg).
  it("switches the Value column between Total and Unit", async () => {
    await ready();
    fireEvent.click(screen.getByRole("switch", { name: /Showing total value/ }));
    expect(within(row(11)).getByText("$4.00")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Showing unit value/ })).toBeInTheDocument();
  });

  it("R1-15: Set | # offers base card number or card number", async () => {
    await ready();
    const head = within(table()).getByRole("button", { name: /^Set \| #/ });
    expect(head).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(head);
    const menu = screen.getByRole("menu", { name: "Sort Set | # by" });
    expect(within(menu).getByRole("menuitemradio", { name: /Base card number/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Card number" }));
    // The printing's own number: SOR 5, SOR 10, SOR 269.
    expect(order()).toEqual(["11", "21", "12"]);
    expect(screen.queryByRole("menu")).toBeNull();
    // Picking the active choice again flips its direction.
    fireEvent.click(within(table()).getByRole("button", { name: /^Set \| #/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Card number/ }));
    expect(order()).toEqual(["12", "21", "11"]);
  });

  it("the sort bar marks its active entry on the button (no aria-sort off a header)", async () => {
    await ready();
    const bar = screen.getByRole("group", { name: "Sort" });
    expect(bar.querySelector("[aria-sort]")).toBeNull();
    const b = within(bar);
    expect(b.getByRole("button", { name: /^Set \| #/ })).toHaveAttribute("aria-current", "true");
    expect(b.getByRole("button", { name: /^Set \| #/ })).toHaveAccessibleName(
      "Set | #, sorted by base card number, ascending"
    );
    expect(b.getByRole("button", { name: "Sort by Name" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    fireEvent.click(b.getByRole("button", { name: "Sort by Name" }));
    // Pressed, with the direction in its name; pressing again flips it.
    const name = b.getByRole("button", { name: "Sort by Name, ascending" });
    expect(name).toHaveAttribute("aria-pressed", "true");
    expect(name.className).toContain("th-sort-btn--asc");
    fireEvent.click(name);
    expect(b.getByRole("button", { name: "Sort by Name, descending" }).className).toContain(
      "th-sort-btn--desc"
    );
    expect(b.getByRole("button", { name: /^Set \| #/ })).not.toHaveAttribute("aria-current");
    // The table's column headers keep aria-sort.
    expect(within(table()).getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("only one Set | # menu is open at a time", async () => {
    await ready();
    const bar = within(screen.getByRole("group", { name: "Sort" }));
    fireEvent.click(within(table()).getByRole("button", { name: /^Set \| #/ }));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    fireEvent.click(bar.getByRole("button", { name: /^Set \| #/ }));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(bar.getByRole("button", { name: /^Set \| #/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(table()).getByRole("button", { name: /^Set \| #/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("R1-16: the sort bar sorts by Copies in stash, Rarity and Recently stashed", async () => {
    items = [
      { stash_id: 1, variant_id: 11, quantity: 2, stashed_at: "2026-11-01T10:00:00" },
      { stash_id: 1, variant_id: 12, quantity: 1, stashed_at: "2026-11-08T10:00:00" },
      { stash_id: 1, variant_id: 21, quantity: 1, stashed_at: "2026-11-04T10:00:00" },
    ];
    await ready();
    const bar = within(screen.getByRole("group", { name: "Sort" }));
    for (const label of [
      "Set | #",
      "Name",
      "Value",
      "Copies in stash",
      "Rarity",
      "Recently stashed",
    ])
      expect(
        bar.getByRole("button", { name: label === "Set | #" ? /^Set \| #/ : `Sort by ${label}` })
      ).toBeInTheDocument();
    fireEvent.click(bar.getByRole("button", { name: "Sort by Recently stashed" }));
    // Newest first on the first pick.
    expect(order()).toEqual(["12", "21", "11"]);
    fireEvent.click(bar.getByRole("button", { name: "Sort by Copies in stash" }));
    expect(order()[2]).toBe("11");
    // The table header and the bar share one sort.
    expect(within(table()).getByRole("button", { name: "In stash" }).className).toContain(
      "th-sort-btn--asc"
    );
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
    expect(document.querySelectorAll(".sp-gallery .gallery-cell")).toHaveLength(3);
    // The Vault's plate: green ring and count at a playset (the leader's 1).
    const vader = screen.getByRole("button", { name: "Darth Vader, Standard, 1 in this stash" });
    expect(vader.querySelector(".gallery-plate")!.className).toContain("gallery-plate--complete");
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
    await waitFor(() => expect(row(11).querySelector(".playset-chip")!.textContent).toBe("1"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    expect(screen.getByText("1 back in Vault")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(api.restoreStashItems).toHaveBeenCalledWith(1, [{ variant_id: 11, quantity: 1 }]);
    await waitFor(() => expect(row(11).querySelector(".playset-chip")!.textContent).toBe("2"));
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
    expect(row(11).querySelector(".playset-chip")!.textContent).toBe("1");
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
    expect(row(11).querySelector(".playset-chip")!.textContent).toBe("2");
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

  // Copy replaced (R1-9, 2026-11-08: the confirm says every card returns,
  // with the count).
  it("E3: delete asks first, then the copies go back and the next stash shows", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Edit name and description" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete stash" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent("Delete Red binder?");
    expect(dlg).toHaveTextContent("Every card in it returns to your Vault: 4 copies.");
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

describe("R1-9: delete from the Stashes screen", () => {
  it("the head's trash opens the confirm with the count; the stash beside it shows after", async () => {
    await ready({ start: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Delete New box" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent("Delete New box?");
    expect(dlg).toHaveTextContent("It holds no copies.");
    await act(async () => {
      fireEvent.click(within(dlg).getByRole("button", { name: "Delete stash" }));
    });
    expect(api.deleteStash).toHaveBeenCalledWith(3);
    // The last stash goes: its neighbour before it shows.
    await waitFor(() =>
      expect(document.querySelector(".sp-railrow--on .sp-railrow__name")!.textContent).toBe(
        "Trade stash"
      )
    );
  });

  it("deleting the only stash lands on the no-stashes state", async () => {
    stashes = [stash(1, "Red binder")];
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Delete Red binder" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Every card in it returns to your Vault: 4 copies."
    );
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete stash" })
      );
    });
    expect(
      await screen.findByText(
        "You have no stashes. A stash records where copies are kept, like a binder or a trade box."
      )
    ).toBeInTheDocument();
  });

  it("uses the transactional modal family", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Delete Red binder" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.className).toContain("auth-modal-card");
    expect(within(dlg).getByRole("button", { name: "Delete stash" }).className).toContain(
      "auth-danger-submit"
    );
  });
});

describe("R1-6: Market / Low in the rail and the value tile", () => {
  function PriceHarness() {
    const [kind, setKind] = useState<"market" | "low">("market");
    return (
      <StashProvider enabled>
        <StashesPane
          cards={CARDS}
          list={CARDS}
          finishes={new Set()}
          setOrder={{}}
          priceKind={kind}
          onPriceKind={setKind}
          selectedId={null}
          onSelect={() => {}}
          onOpenPrinting={() => {}}
        />
      </StashProvider>
    );
  }
  it("both switches show and drive one state", async () => {
    render(<PriceHarness />);
    await screen.findByRole("heading", { name: "Stashes" });
    const rail = within(screen.getByRole("complementary", { name: "Stashes" }));
    const tile = document.querySelector<HTMLElement>(".sp-stats .inv-summary__pricemode")!;
    expect(rail.getByRole("switch", { name: /Showing market price/ })).toBeInTheDocument();
    expect(within(tile).getByRole("switch", { name: /Showing market price/ })).toBeInTheDocument();
    fireEvent.click(within(tile).getByRole("switch"));
    expect(rail.getByRole("switch", { name: /Showing low price/ })).toBeInTheDocument();
    // Low = half of market in the fixture: $19.00 -> $9.50.
    expect(document.querySelector(".sp-railrow__value")!.textContent).toBe("$9.50");
    fireEvent.click(rail.getByRole("switch"));
    expect(within(tile).getByRole("switch", { name: /Showing market price/ })).toBeInTheDocument();
  });

  it("the tiles are the Vault's collection tiles", async () => {
    await ready();
    const tiles = document.querySelectorAll(".sp-stats .inv-summary__block-wrap");
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector(".inv-summary__label")!.textContent).toBe("Cards");
    expect(tiles[0].querySelector(".inv-summary__value")!.textContent).toBe("4");
    expect(tiles[1].querySelector(".inv-summary__value")!.textContent).toBe("$19.00");
  });
});

// Replaced (R2-2, owner 2026-11-08): the rail docks or floats like the
// Vault's filter sidebar. Docked (window >= RAIL_DOCK_MIN_WIDTH) its tab
// unfolds the docked rail (the list reflows); narrower the tab floats it.
// Retires the old single-mode tests "collapses to the edge tab, keeps every
// stash a click away, and is remembered" (the flyout from a folded docked
// rail is designed away) and moves "Escape closes the flyout" to the
// floating mode.
describe("R1-7 / R2-2: the rail docks or floats", () => {
  const width = window.innerWidth;
  function setWidth(w: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    window.dispatchEvent(new Event("resize"));
  }
  afterEach(() => setWidth(width));
  const tab = () => screen.getByRole("button", { name: "Stashes, 3: show the list" });
  const rail = () => screen.queryByRole("complementary", { name: "Stashes" });
  async function floating() {
    setWidth(RAIL_DOCK_MIN_WIDTH - 1);
    render(<Harness />);
    await screen.findByRole("heading", { name: "Red binder" });
  }

  it("docks from RAIL_DOCK_MIN_WIDTH (1284: the column ratios plus rail, gutter, padding)", () => {
    expect(RAIL_DOCK_MIN_WIDTH).toBe(1284);
  });

  it("docked: folds to the edge tab and back, remembered per viewer", async () => {
    setWidth(RAIL_DOCK_MIN_WIDTH);
    const r = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Collapse the stash list" }));
    expect(rail()).toBeNull();
    expect(window.localStorage.getItem("swu.stashes.railCollapsed")).toBe("1");
    r.unmount();
    // A fresh visit opens folded; the tab unfolds the docked rail (no flyout).
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Stashes, 3: show the list" }));
    expect(rail()!.className).not.toContain("sp-rail--flyout");
    expect(screen.getByRole("button", { name: "Collapse the stash list" })).toBeInTheDocument();
    expect(window.localStorage.getItem("swu.stashes.railCollapsed")).toBe("0");
  });

  it("docked: focus moves chevron -> tab on fold and tab -> chevron on unfold", async () => {
    setWidth(RAIL_DOCK_MIN_WIDTH);
    await ready();
    const chevron = screen.getByRole("button", { name: "Collapse the stash list" });
    chevron.focus();
    fireEvent.click(chevron);
    expect(document.activeElement).toBe(tab());
    fireEvent.click(tab());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Collapse the stash list" })
    );
  });

  it("floating: the tab floats the rail; a pick closes it and focuses the stash heading", async () => {
    await floating();
    // No docked rail below the threshold: the tab only.
    expect(rail()).toBeNull();
    fireEvent.click(tab());
    expect(rail()!.className).toContain("sp-rail--flyout");
    const row = within(rail()!).getByRole("button", { name: /Trade stash/ });
    row.focus();
    fireEvent.click(row);
    expect(rail()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Trade stash" }));
    // Floating never writes the docked state.
    expect(window.localStorage.getItem("swu.stashes.railCollapsed")).toBeNull();
  });

  it("floating: the chevron and Escape close it and return focus to the tab", async () => {
    await floating();
    fireEvent.click(tab());
    const hide = screen.getByRole("button", { name: "Hide the stash list" });
    hide.focus();
    fireEvent.click(hide);
    expect(rail()).toBeNull();
    expect(document.activeElement).toBe(tab());
    fireEvent.click(tab());
    within(rail()!)
      .getByRole("button", { name: /Red binder/ })
      .focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rail()).toBeNull();
    expect(document.activeElement).toBe(tab());
  });

  it("floating: a click outside closes it; focus returns to the tab only if it was lost", async () => {
    await floating();
    fireEvent.click(tab());
    within(rail()!)
      .getByRole("button", { name: /Red binder/ })
      .focus();
    fireEvent.mouseDown(document.body);
    expect(rail()).toBeNull();
    expect(document.activeElement).toBe(tab());
    // Clicking another control keeps that control's focus.
    fireEvent.click(tab());
    const pencil = screen.getByRole("button", { name: "Edit name and description" });
    pencil.focus();
    fireEvent.mouseDown(pencil);
    expect(rail()).toBeNull();
    expect(document.activeElement).toBe(pencil);
  });

  it("Escape closes only the topmost layer: an open Set | # menu first", async () => {
    await floating();
    fireEvent.click(tab());
    // A menu opened from the keyboard path, over the flyout.
    act(() => {
      const menu = document.createElement("div");
      menu.className = "sp-numsort__menu";
      document.body.appendChild(menu);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rail()).not.toBeNull();
    document.querySelector(".sp-numsort__menu")!.remove();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rail()).toBeNull();
  });

  it("follows the window across the threshold, dropping an open flyout and keeping focus", async () => {
    setWidth(RAIL_DOCK_MIN_WIDTH + 100);
    await ready();
    expect(rail()).toBeInTheDocument();
    screen.getByRole("button", { name: "Collapse the stash list" }).focus();
    act(() => setWidth(RAIL_DOCK_MIN_WIDTH - 100));
    expect(rail()).toBeNull();
    expect(document.activeElement).toBe(tab());
    fireEvent.click(tab());
    expect(rail()!.className).toContain("sp-rail--flyout");
    within(rail()!)
      .getByRole("button", { name: /Red binder/ })
      .focus();
    act(() => setWidth(RAIL_DOCK_MIN_WIDTH + 100));
    expect(rail()!.className).not.toContain("sp-rail--flyout");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Collapse the stash list" })
    );
  });
});

describe("R1-5: the filters' slot", () => {
  // Replaced (review fold-in, 2026-11-08): an empty stash keeps the list
  // area and its corner, so the filters anchor the same way on every stash.
  it("hands CardsPage the card list's corner, an empty stash included", async () => {
    const slot = vi.fn();
    function SlotHarness() {
      const [selected, setSelected] = useState<number | null>(1);
      return (
        <StashProvider enabled>
          <StashesPane
            cards={CARDS}
            list={CARDS}
            finishes={new Set()}
            setOrder={{}}
            priceKind="market"
            onPriceKind={() => {}}
            selectedId={selected}
            onSelect={setSelected}
            onOpenPrinting={() => {}}
            onFilterSlot={slot}
          />
        </StashProvider>
      );
    }
    render(<SlotHarness />);
    await screen.findByRole("heading", { name: "Stashes" });
    const el = slot.mock.lastCall![0] as HTMLElement;
    expect(el.className).toBe("sp-list__filters");
    expect(el.parentElement!.className).toBe("sp-list");
    fireEvent.click(screen.getByRole("button", { name: /New box/ }));
    expect(screen.getByText(/New box has no copies/)).toBeInTheDocument();
    const after = slot.mock.lastCall![0] as HTMLElement;
    expect(after).not.toBeNull();
    expect(after.className).toBe("sp-list__filters");
  });
});

describe("R1-10: scale", () => {
  it("60 stashes with long names all list in the rail", async () => {
    stashes = Array.from({ length: 60 }, (_, i) => stash(i + 1, `Stash number ${i + 1}`));
    stashes[59].name = "x".repeat(40);
    await ready();
    const rail = document.querySelector(".sp-rail__list")!;
    expect(rail.querySelectorAll(".sp-railrow")).toHaveLength(60);
    expect(screen.getByRole("button", { name: new RegExp("x{40}") })).toBeInTheDocument();
  });

  it("a stash with hundreds of printings draws every row, a card's printings together", async () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      phoneCard({
        id: 100 + i,
        name: `Card ${i}`,
        number: String(i + 1),
        variants: [
          { id: 1000 + i * 2, finish: "Standard", number: String(i + 1), market: 1 },
          { id: 1001 + i * 2, finish: "Hyperspace", number: String(300 + i), market: 2 },
        ],
      })
    );
    items = many.flatMap((c) =>
      c.variants.map((v) => ({ stash_id: 1, variant_id: v.variant_id, quantity: 1 }))
    );
    render(
      <StashProvider enabled>
        <StashesPane
          cards={many}
          list={many}
          finishes={new Set()}
          setOrder={{}}
          priceKind="market"
          onPriceKind={() => {}}
          selectedId={1}
          onSelect={() => {}}
          onOpenPrinting={() => {}}
        />
      </StashProvider>
    );
    await screen.findByRole("heading", { name: "Stashes" });
    expect(rows()).toHaveLength(300);
    expect(order().slice(0, 4)).toEqual(["1000", "1001", "1002", "1003"]);
    expect(document.querySelector(".sp-stats .inv-summary__value")!.textContent).toBe("300");
  });
});
