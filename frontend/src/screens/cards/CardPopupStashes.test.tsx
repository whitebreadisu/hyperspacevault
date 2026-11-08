import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";
import type { Stash, StashItem } from "../../api/stashes";
import { StashProvider } from "../../stashes/StashContext";
import { resetStashSaveStoreForTests } from "../../stashes/stashSaveStore";
import { resetOwnedSettleForTests } from "../../utils/ownedSettle";
import { STASH_ERRORS, STASH_FLOOR_HINT, staleSaveMessage } from "../../stashes/useStashEditor";
import { CardPopup } from "./CardPopup";

// BL-344 slice 1, desktop 1a "Place rows" (claude_design/design_handoff_card_stash
// README; BL-344 owner decisions). One test (or more) per README state, a1
// through f2, against the real CardPopup inside a StashProvider with the
// stash and inventory APIs mocked:
//   a1 no stashes -> Stash copies     a2 New stash form, Create -> rows
//   b1 stashes, none of this printing b2 rows, + stashes from the Vault
//   c1 read-only list + Edit          c2 rows seeded from the saved split
//   d1 stash -> stash (- then +)      d2 stash -> Vault (-)
//   e1 all stashed: Vault 0 red, + off   e2 0 owned: no stash UI
//   f1 shared (readOnly) / f2 signed out: no stash UI, nothing fetched
// plus save on click (BL-344 R1-11: coalesced per printing, serialized,
// rolled back on failure; no Cancel; Done collapses), the open window sent
// on a printing change, the decrease floor and the inline create errors.

const { getBaseCardDetail, getPriceHistory } = vi.hoisted(() => ({
  getBaseCardDetail: vi.fn(),
  getPriceHistory: vi.fn(),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardDetail, getPriceHistory }));

const { adjustCard } = vi.hoisted(() => ({ adjustCard: vi.fn() }));
vi.mock("../../api/inventory", async (orig) => ({
  ...(await orig<typeof import("../../api/inventory")>()),
  adjustCard,
}));

const { getStashes, getStashItems, createStash, putVariantAllocations } = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
  createStash: vi.fn(),
  putVariantAllocations: vi.fn(),
}));
// The save store sends `expected` and an abort signal as a third argument;
// assertions read the first two (the printing and the split) on
// `putVariantAllocations`, and the third on `putOptions`.
const putOptions: unknown[] = [];
vi.mock("../../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../../api/stashes")>()),
  getStashes,
  getStashItems,
  createStash,
  putVariantAllocations: (variantId: number, allocations: unknown, opts: unknown) => {
    putOptions.push(opts);
    return putVariantAllocations(variantId, allocations);
  },
}));
vi.mock("../../analytics/analytics", () => ({ capture: vi.fn() }));

import { StashApiError } from "../../api/stashes";

const STD = 1;
const HYP = 2;
const FOIL = 3;

function variant(id: number, finish: string, quantity: number, num = "5"): VariantDetail {
  return {
    variant_id: id,
    variant_type: finish,
    finish,
    channel: "Retail",
    stamped: false,
    source_set_code: "SOR",
    source_set_name: "Spark of Rebellion",
    card_number: num,
    front_image_url: null,
    back_image_url: null,
    stamp_group: null,
    quantity,
  };
}

function detail(type = "Leader"): BaseCardDetail {
  return {
    id: 7,
    set_code: "SOR",
    set_name: "Spark of Rebellion",
    base_card_number: "5",
    name: "Luke Skywalker",
    subtitle: "Faithful Friend",
    type,
    type2: null,
    double_sided: false,
    rarity: "C",
    cost: 6,
    power: 4,
    hp: 7,
    arena: null,
    is_unique: true,
    front_text: null,
    back_text: null,
    epic_action: null,
    artist: null,
    is_token: false,
    aspects: [],
    keywords: [],
    traits: [],
    variants: [
      variant(STD, "Standard", 3),
      variant(HYP, "Hyperspace", 1, "269"),
      variant(FOIL, "Foil", 0),
    ],
  };
}

const ST = (id: number, name: string): Stash => ({
  id,
  name,
  description: null,
  created_at: `2026-11-0${id}T00:00:00Z`,
  copies: 0,
});
const ALL = [ST(1, "Red binder"), ST(2, "Trade stash"), ST(3, "With Bob")];

function seed(stashes: Stash[], items: StashItem[]) {
  getStashes.mockResolvedValue(stashes);
  getStashItems.mockResolvedValue(items);
}

async function renderPopup(
  opts: {
    enabled?: boolean;
    isAuthenticated?: boolean;
    readOnly?: boolean;
    type?: string;
    initialVariantId?: number;
  } = {}
) {
  getBaseCardDetail.mockResolvedValue(detail(opts.type));
  await act(async () => {
    render(
      <StashProvider enabled={opts.enabled ?? true}>
        <CardPopup
          baseCardId={7}
          isAuthenticated={opts.isAuthenticated ?? true}
          readOnly={opts.readOnly}
          setNameByCode={{ SOR: "Spark of Rebellion" }}
          onClose={vi.fn()}
          initialVariantId={opts.initialVariantId ?? STD}
        />
      </StashProvider>
    );
  });
  await waitFor(() => {
    if (screen.queryByText("Loading…")) throw new Error("loading");
  });
}

const panel = () => document.querySelector(".cp-plate__inner") as HTMLElement;
const rowFor = (id: number) =>
  panel().querySelector(`.cp-stash__row[data-stash="${id}"]`) as HTMLElement;
const steps = (id: number) => rowFor(id).querySelectorAll<HTMLButtonElement>(".cp-stash__step");
const minus = (id: number) => steps(id)[0];
const plus = (id: number) => steps(id)[1];
const vaultNum = () => panel().querySelector(".cp-stash__vault") as HTMLElement;
const count = (id: number) => rowFor(id).querySelector(".cp-stash__num")!.textContent;
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const button = (name: string | RegExp) => within(panel()).getByRole("button", { name });
const selectPrinting = async (name: RegExp) => {
  await click(screen.getAllByRole("button", { name }).find((b) => b.closest(".cp-rail"))!);
};

beforeEach(() => {
  vi.clearAllMocks();
  // The save store and the owned tracker are app-wide modules.
  resetStashSaveStoreForTests();
  resetOwnedSettleForTests();
  putOptions.length = 0;
  getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
  putVariantAllocations.mockImplementation(async (variantId, allocations) => ({
    variant_id: variantId,
    owned: 3,
    allocations,
  }));
});

describe("BL-344 desktop 1a states", () => {
  it("a1: no stashes -> one quiet Stash copies button, no list", async () => {
    seed([], []);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    expect(panel().querySelector(".cp-stash__list")).toBeNull();
    expect(panel().querySelector(".cp-stash__rows")).toBeNull();
  });

  it("a2: Stash copies with no stashes opens New stash; Create goes straight to edit mode", async () => {
    seed([], []);
    createStash.mockResolvedValue(ST(1, "Red binder"));
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    const form = within(panel()).getByRole("form", { name: "New stash" });
    const create = within(form).getByRole("button", { name: "Create stash" });
    // Name required: Create stays aria-disabled until one is typed.
    expect(create.getAttribute("aria-disabled")).toBe("true");
    await click(create);
    expect(createStash).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), {
      target: { value: "  Red binder  " },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: "Description" }), {
      target: { value: "Shelf" },
    });
    await click(create);
    expect(createStash).toHaveBeenCalledWith("Red binder", "Shelf");
    // Rows: Vault 3, the new stash at 0; no copies moved, owned untouched.
    await waitFor(() => expect(vaultNum().textContent).toBe("3"));
    expect(count(1)).toBe("0");
    expect(putVariantAllocations).not.toHaveBeenCalled();
    expect(adjustCard).not.toHaveBeenCalled();
    expect(document.querySelector(".cp-plate__qty")!.textContent).toBe("3");
  });

  it("a2: Cancel in the form returns to the label", async () => {
    seed([], []);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(button("Cancel"));
    expect(button(/stash copies/i)).toBeTruthy();
    expect(panel().querySelector(".cp-stash__create")).toBeNull();
  });

  it("b1: stashes exist, none hold this printing -> the label, which opens the rows", async () => {
    seed(ALL, [{ stash_id: 2, variant_id: HYP, quantity: 1 }]);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    expect(panel().querySelectorAll(".cp-stash__row")).toHaveLength(4); // Vault + 3
    expect(vaultNum().textContent).toBe("3");
  });

  // REPLACE (R1-11): was "staged; Done sends one PUT". The clicks now save
  // themselves; Done collapses and sends the still-open window at once.
  it("b2: + moves Vault -> stash at once; Done collapses and sends one PUT with the full split", async () => {
    seed(ALL, []);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await click(plus(1));
    expect(count(1)).toBe("2");
    expect(vaultNum().textContent).toBe("1");
    expect(putVariantAllocations).not.toHaveBeenCalled();
    getStashItems.mockResolvedValue([{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await click(button("Done"));
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 2 }]);
    // Back to read only: c1's list.
    await waitFor(() => expect(panel().querySelector(".cp-stash__list")).not.toBeNull());
    expect(adjustCard).not.toHaveBeenCalled();
  });

  it("c1: read-only list of the stashes holding this printing, playset chip, Edit", async () => {
    seed(ALL, [
      { stash_id: 1, variant_id: STD, quantity: 1 },
      { stash_id: 3, variant_id: STD, quantity: 1 },
      { stash_id: 2, variant_id: HYP, quantity: 1 },
    ]);
    await renderPopup({ type: "Unit" });
    await waitFor(() => expect(panel().querySelector(".cp-stash__list")).not.toBeNull());
    const names = [...panel().querySelectorAll(".cp-stash__readrow .cp-stash__name")].map(
      (n) => n.textContent
    );
    expect(names).toEqual(["Red binder", "With Bob"]); // creation order, holders only
    const chip = panel().querySelector(".cp-stash__readrow .playset-chip")!;
    expect(chip.textContent).toBe("1");
    expect(chip.className).not.toContain("playset-chip--complete"); // a Unit's playset is 3
    expect(panel().querySelector(".cp-stash__rows")).toBeNull();
    expect(button(/edit/i)).toBeTruthy();
  });

  it("c1: the chip goes complete at the card's own playset size (a leader's is 1)", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderPopup({ type: "Leader" });
    await waitFor(() => expect(panel().querySelector(".playset-chip")).not.toBeNull());
    expect(panel().querySelector(".playset-chip")!.className).toContain("playset-chip--complete");
  });

  it("c2: Edit seeds the rows from the saved split", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    expect(vaultNum().textContent).toBe("1");
    expect(count(1)).toBe("2");
    expect(count(2)).toBe("0");
    expect(within(panel()).getByRole("button", { name: /new stash/i })).toBeTruthy();
  });

  it("d1: stash to stash is - on the source, + on the destination", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    await click(minus(1));
    expect(vaultNum().textContent).toBe("2");
    await click(plus(2));
    expect([count(1), count(2), vaultNum().textContent]).toEqual(["1", "1", "1"]);
    await click(button("Done"));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [
      { stash_id: 1, quantity: 1 },
      { stash_id: 2, quantity: 1 },
    ]);
  });

  it("d2: - sends a copy back to the Vault; at 0 the stash's - is off", async () => {
    seed(ALL, [{ stash_id: 2, variant_id: HYP, quantity: 1 }]);
    await renderPopup({ initialVariantId: HYP });
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    expect(vaultNum().textContent).toBe("0");
    await click(minus(2));
    expect(vaultNum().textContent).toBe("1");
    expect(count(2)).toBe("0");
    expect(minus(2).getAttribute("aria-disabled")).toBe("true");
    await click(minus(2));
    expect(count(2)).toBe("0");
    await click(button("Done"));
    expect(putVariantAllocations).toHaveBeenCalledWith(HYP, []);
  });

  it("e1: every copy stashed -> Vault 0 in red, every + off (and inert)", async () => {
    seed(ALL, [
      { stash_id: 1, variant_id: STD, quantity: 2 },
      { stash_id: 3, variant_id: STD, quantity: 1 },
    ]);
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    expect(vaultNum().textContent).toBe("0");
    expect(vaultNum().className).toContain("cp-stash__vault--empty");
    for (const id of [1, 2, 3]) expect(plus(id).getAttribute("aria-disabled")).toBe("true");
    await click(plus(2));
    expect(count(2)).toBe("0");
    // No extra text in edit mode.
    expect(panel().querySelector(".cp-stash__saveerror")).toBeNull();
  });

  it("e2: a printing with 0 owned shows no stash UI", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await renderPopup({ initialVariantId: FOIL });
    await waitFor(() => expect(getStashItems).toHaveBeenCalled());
    await act(async () => {});
    expect(panel().querySelector("[class^='cp-stash']")).toBeNull();
    expect(screen.queryByText(/stash copies/i)).toBeNull();
  });

  it("f1: a shared vault (readOnly) shows no stash UI and fetches nothing", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await renderPopup({ enabled: false, readOnly: true });
    expect(document.querySelector("[class^='cp-stash']")).toBeNull();
    expect(screen.queryByText("Red binder")).toBeNull();
    expect(getStashes).not.toHaveBeenCalled();
    expect(getStashItems).not.toHaveBeenCalled();
  });

  it("f1: even inside an enabled provider, readOnly draws no stash UI", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await renderPopup({ readOnly: true });
    await waitFor(() => expect(getStashItems).toHaveBeenCalled());
    await act(async () => {});
    expect(document.querySelector("[class^='cp-stash']")).toBeNull();
  });

  it("f2: signed out shows the Sign in nudge only and fetches nothing", async () => {
    seed(ALL, []);
    await renderPopup({ enabled: false, isAuthenticated: false });
    expect(screen.getByText("Sign in to manage inventory")).toBeTruthy();
    expect(document.querySelector("[class^='cp-stash']")).toBeNull();
    expect(getStashes).not.toHaveBeenCalled();
  });
});

// BL-344 R1-11 (owner 2026-11-08): a -/+ saves on click like the owned
// stepper. Disposition of the old "desktop staging" block:
//   "Cancel discards the draft"            RETIRE: Cancel is designed away;
//                                          replaced by "no Cancel; Done collapses".
//   "Done with no change writes nothing"   PORT (unchanged behaviour).
//   "switching the printing discards..."   REPLACE: the open window is sent.
//   "New stash ... draft kept"             PORT.
//   "a failed Done keeps the rows..."      REPLACE: failure rollback + message.
describe("BL-344 R1-11 desktop save on click", () => {
  it("no Cancel: Done is the foot's only button and collapses the rows", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    const foot = panel().querySelector(".cp-stash__foot") as HTMLElement;
    expect(
      within(foot)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Done"]);
    expect(within(panel()).queryByRole("button", { name: "Cancel" })).toBeNull();
    await click(button("Done"));
    expect(panel().querySelector(".cp-stash__rows")).toBeNull();
    expect(panel().querySelector(".cp-stash__list")).not.toBeNull();
    expect(putVariantAllocations).not.toHaveBeenCalled();
  });

  it("Done with no change writes nothing", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    await click(button("Done"));
    expect(putVariantAllocations).not.toHaveBeenCalled();
    expect(panel().querySelector(".cp-stash__list")).not.toBeNull();
  });

  it("a click saves by itself: the Vault moves at once, the PUT follows the window", async () => {
    seed(ALL, []);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(2));
    expect([count(2), vaultNum().textContent]).toEqual(["1", "2"]);
    expect(putVariantAllocations).not.toHaveBeenCalled();
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 2, quantity: 1 }]);
    // Still editing: the rows stay open after a save.
    expect(panel().querySelector(".cp-stash__rows")).not.toBeNull();
  });

  it("rapid clicks across stashes coalesce into one PUT with the latest split", async () => {
    seed(ALL, []);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await click(plus(1));
    await click(plus(2));
    await click(minus(1));
    await click(plus(3));
    expect([count(1), count(2), count(3), vaultNum().textContent]).toEqual(["1", "1", "1", "0"]);
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [
      { stash_id: 1, quantity: 1 },
      { stash_id: 2, quantity: 1 },
      { stash_id: 3, quantity: 1 },
    ]);
  });

  it("a click while a save is on the wire waits for it: saves land in order, latest wins", async () => {
    seed(ALL, []);
    const first = deferred<{ variant_id: number; owned: number; allocations: unknown[] }>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    await click(plus(1));
    await click(plus(1));
    // The second window closes while the first PUT is still out: it waits.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    expect(count(1)).toBe("3");
    // The server's re-read after the saves (the provider refreshes on each).
    getStashItems.mockResolvedValue([{ stash_id: 1, variant_id: STD, quantity: 3 }]);
    await act(async () => {
      first.resolve({ variant_id: STD, owned: 3, allocations: [{ stash_id: 1, quantity: 1 }] });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations.mock.calls[1]).toEqual([STD, [{ stash_id: 1, quantity: 3 }]]);
    expect(count(1)).toBe("3");
  });

  it("a failed save rolls the rows and the Vault back and says what went wrong", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    putVariantAllocations.mockRejectedValue(new StashApiError("unknown", 500));
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    await click(plus(2));
    expect([count(2), vaultNum().textContent]).toEqual(["1", "1"]);
    await waitFor(() =>
      expect(within(panel()).getByRole("alert").textContent).toBe(STASH_ERRORS.saveFailed)
    );
    expect([count(1), count(2), vaultNum().textContent]).toEqual(["1", "0", "2"]);
    // The next save that lands clears the message.
    putVariantAllocations.mockImplementation(async (variantId, allocations) => ({
      variant_id: variantId,
      owned: 3,
      allocations,
    }));
    await click(plus(3));
    await waitFor(() => expect(within(panel()).queryByRole("alert")).toBeNull());
  });

  it("exceeds_owned after Done: the rows reopen, rolled back, with its message", async () => {
    seed(ALL, []);
    putVariantAllocations.mockRejectedValue(new StashApiError("exceeds_owned", 409));
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await click(button("Done"));
    await waitFor(() =>
      expect(within(panel()).getByRole("alert").textContent).toBe(STASH_ERRORS.exceeds)
    );
    expect(panel().querySelector(".cp-stash__rows")).not.toBeNull();
    expect([count(1), vaultNum().textContent]).toEqual(["0", "3"]);
  });

  it("switching the printing sends the open window: nothing is discarded", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    await click(plus(2));
    getStashItems.mockResolvedValue([
      { stash_id: 1, variant_id: STD, quantity: 1 },
      { stash_id: 2, variant_id: STD, quantity: 1 },
    ]);
    await selectPrinting(/Hyperspace/);
    // Sent at once, for Standard, not after the window.
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [
      { stash_id: 1, quantity: 1 },
      { stash_id: 2, quantity: 1 },
    ]);
    // Hyperspace: 1 owned, nothing stashed -> the label.
    expect(button(/stash copies/i)).toBeTruthy();
    await selectPrinting(/^Standard/);
    await waitFor(() => {
      const names = [...panel().querySelectorAll(".cp-stash__readrow .cp-stash__name")].map(
        (n) => n.textContent
      );
      expect(names).toEqual(["Red binder", "Trade stash"]);
    });
  });

  it("New stash from the rows returns to the rows with the clicks kept", async () => {
    seed(ALL.slice(0, 1), []);
    createStash.mockResolvedValue(ST(2, "Trade stash"));
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await click(within(panel()).getByRole("button", { name: /new stash/i }));
    fireEvent.change(within(panel()).getByRole("textbox", { name: "Name" }), {
      target: { value: "Trade stash" },
    });
    await click(button("Create stash"));
    await waitFor(() => expect(rowFor(2)).not.toBeNull());
    expect(count(1)).toBe("1");
    expect(count(2)).toBe("0");
  });
});

describe("BL-344 create errors (inline, under Name)", () => {
  it("duplicate name", async () => {
    seed(ALL, []);
    createStash.mockRejectedValue(new StashApiError("duplicate_name", 409));
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(within(panel()).getByRole("button", { name: /new stash/i }));
    const name = within(panel()).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "red binder" } });
    await click(button("Create stash"));
    const err = within(panel()).getByRole("alert");
    expect(err.textContent).toBe(STASH_ERRORS.duplicate);
    expect(name.getAttribute("aria-describedby")).toBe(err.id);
    // Still the form; typing clears the error.
    fireEvent.change(name, { target: { value: "red binder 2" } });
    expect(within(panel()).queryByRole("alert")).toBeNull();
  });

  it("stash limit", async () => {
    seed([], []);
    createStash.mockRejectedValue(new StashApiError("stash_limit", 409));
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    fireEvent.change(within(panel()).getByRole("textbox", { name: "Name" }), {
      target: { value: "One more" },
    });
    await click(button("Create stash"));
    expect(within(panel()).getByRole("alert").textContent).toBe(STASH_ERRORS.limit);
  });
});

describe("BL-344 decrease floor (owner decision)", () => {
  it("owned = stashed: - is aria-disabled with the hint (title + name) and queues nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      seed(ALL, [{ stash_id: 2, variant_id: HYP, quantity: 1 }]);
      await renderPopup({ initialVariantId: HYP });
      const dec = document.querySelector(".cp-plate__step--dec") as HTMLButtonElement;
      await waitFor(() => expect(dec.getAttribute("aria-disabled")).toBe("true"));
      expect(dec.disabled).toBe(false);
      expect(dec.getAttribute("title")).toBe(STASH_FLOOR_HINT);
      expect(dec.getAttribute("aria-label")).toContain(STASH_FLOOR_HINT);
      await click(dec);
      await act(async () => {
        vi.advanceTimersByTime(800);
      });
      expect(adjustCard).not.toHaveBeenCalled();
      expect(document.querySelector(".cp-plate__qty")!.textContent).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("above the floor - still works, and stops at the floor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
      adjustCard.mockResolvedValue({ variant_id: STD, quantity: 2 });
      await renderPopup();
      const dec = document.querySelector(".cp-plate__step--dec") as HTMLButtonElement;
      await waitFor(() => expect(panel().querySelector(".cp-stash__list")).not.toBeNull());
      expect(dec.getAttribute("aria-disabled")).toBeNull();
      await click(dec); // 3 -> 2
      await click(dec); // at the floor: ignored
      await click(dec);
      expect(document.querySelector(".cp-plate__qty")!.textContent).toBe("2");
      await act(async () => {
        vi.advanceTimersByTime(800);
      });
      expect(adjustCard).toHaveBeenCalledTimes(1);
      expect(adjustCard).toHaveBeenCalledWith(STD, -1);
      expect(dec.getAttribute("aria-disabled")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("no stashes: - is a plain stepper down to 0", async () => {
    seed([], []);
    await renderPopup({ initialVariantId: HYP });
    await waitFor(() => button(/stash copies/i));
    const dec = document.querySelector(".cp-plate__step--dec") as HTMLButtonElement;
    expect(dec.getAttribute("aria-disabled")).toBeNull();
    expect(dec.getAttribute("title")).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Fold-in round 1 (F1): a late Create / Done response must not touch an edit
// that is gone (a printing change or a Cancel while it was in flight).
describe("BL-344 fold-in F1: late responses", () => {
  it("delayed Create, then a printing change: the new printing stays read only, nothing written", async () => {
    seed([], []);
    const create = deferred<Stash>();
    createStash.mockReturnValue(create.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    fireEvent.change(within(panel()).getByRole("textbox", { name: "Name" }), {
      target: { value: "Red binder" },
    });
    await click(button("Create stash"));
    await selectPrinting(/Hyperspace/);
    await act(async () => {
      create.resolve(ST(1, "Red binder"));
    });
    // Hyperspace (1 owned, nothing stashed): the label, not Standard's rows.
    expect(panel().querySelector(".cp-stash__rows")).toBeNull();
    expect(button(/stash copies/i)).toBeTruthy();
    // The stash exists; editing Hyperspace starts from Hyperspace's split.
    await click(button(/stash copies/i));
    expect(vaultNum().textContent).toBe("1");
    expect(count(1)).toBe("0");
    await click(button("Done"));
    expect(putVariantAllocations).not.toHaveBeenCalled();
  });

  it("delayed Create, then Cancel: back to the label, the late response opens nothing", async () => {
    seed([], []);
    const create = deferred<Stash>();
    createStash.mockReturnValue(create.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    fireEvent.change(within(panel()).getByRole("textbox", { name: "Name" }), {
      target: { value: "Red binder" },
    });
    await click(button("Create stash"));
    await click(button("Cancel"));
    await act(async () => {
      create.resolve(ST(1, "Red binder"));
    });
    expect(panel().querySelector(".cp-stash__rows")).toBeNull();
    expect(panel().querySelector(".cp-stash__create")).toBeNull();
    expect(button(/stash copies/i)).toBeTruthy();
  });

  // PORT (R1-11): Done now sends the open window at once; the late answer
  // for Standard still leaves Hyperspace's rows alone.
  it("delayed Done, then a printing change: the late response leaves the new edit alone", async () => {
    seed(ALL, []);
    const put = deferred<{ variant_id: number; owned: number; allocations: [] }>();
    putVariantAllocations.mockReturnValue(put.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await click(button("Done"));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 1 }]);
    await selectPrinting(/Hyperspace/);
    await click(button(/stash copies/i));
    await click(plus(2));
    await act(async () => {
      put.resolve({ variant_id: STD, owned: 3, allocations: [] });
    });
    // Still editing Hyperspace, with its own staged copy.
    expect(panel().querySelector(".cp-stash__rows")).not.toBeNull();
    expect(count(2)).toBe("1");
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
  });
});

// Fold-in round 1 (F3): Done first settles the owned stepper's open batch,
// so the PUT is checked against the owned count on screen.
describe("BL-344 fold-in F3: Done waits for the owned batch", () => {
  it("tap owned -, then Done at once: the adjust resolves before the PUT is sent", async () => {
    seed(ALL, []);
    const adj = deferred<{ variant_id: number; quantity: number }>();
    adjustCard.mockReturnValue(adj.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(document.querySelector(".cp-plate__step--dec")!); // 3 -> 2, batch open
    await click(plus(1));
    await click(button("Done"));
    expect(adjustCard).toHaveBeenCalledWith(STD, -1); // flushed now, not after 400 ms
    expect(putVariantAllocations).not.toHaveBeenCalled();
    await act(async () => {
      adj.resolve({ variant_id: STD, quantity: 2 });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 1 }]);
  });
});

// Review fold-in (combined branch, 2026-11-08): saves are queued per
// printing across visits and editors; each settles its own printing's owned
// batch; nothing is lost on close or sign-out; a failure after the card
// moved on is said in the card's error line.
describe("BL-344 R1-11 fold-in: per-printing queue and settle", () => {
  const wait = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  const okPut = async (variantId: number, allocations: unknown) => ({
    variant_id: variantId,
    owned: 3,
    allocations,
  });

  it("A -> B -> A: a later save for a printing waits for its earlier one, and builds on it", async () => {
    seed(ALL, []);
    const first = deferred<{ variant_id: number; owned: number; allocations: unknown[] }>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    await selectPrinting(/Hyperspace/);
    await selectPrinting(/^Standard/);
    // Back on Standard: the rows continue from the split still being saved.
    await click(button(/edit|stash copies/i));
    expect([count(1), count(2)]).toEqual(["1", "0"]);
    await click(plus(2));
    await wait(600);
    expect(putVariantAllocations).toHaveBeenCalledTimes(1); // queued behind the first
    await act(async () => {
      first.resolve({ variant_id: STD, owned: 3, allocations: [{ stash_id: 1, quantity: 1 }] });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations.mock.calls[1]).toEqual([
      STD,
      [
        { stash_id: 1, quantity: 1 },
        { stash_id: 2, quantity: 1 },
      ],
    ]);
  });

  it("switching printing with an owned batch open: the stash PUT waits for THAT printing's adjust", async () => {
    seed(ALL, []);
    const adj = deferred<{ variant_id: number; quantity: number }>();
    adjustCard.mockReturnValue(adj.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(document.querySelector(".cp-plate__step--dec")!); // 3 -> 2, batch open
    await click(plus(1));
    await selectPrinting(/Hyperspace/);
    expect(adjustCard).toHaveBeenCalledWith(STD, -1);
    await wait(50);
    expect(putVariantAllocations).not.toHaveBeenCalled();
    await act(async () => {
      adj.resolve({ variant_id: STD, quantity: 2 });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 1 }]);
  });

  it("closing the popup (unmount) sends the open window at once", async () => {
    seed(ALL, []);
    getBaseCardDetail.mockResolvedValue(detail());
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(
        <StashProvider enabled>
          <CardPopup
            baseCardId={7}
            isAuthenticated
            setNameByCode={{ SOR: "Spark of Rebellion" }}
            onClose={vi.fn()}
            initialVariantId={STD}
          />
        </StashProvider>
      );
    });
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(3));
    expect(putVariantAllocations).not.toHaveBeenCalled();
    await act(async () => {
      utils.rerender(
        <StashProvider enabled>
          <div />
        </StashProvider>
      );
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 3, quantity: 1 }]);
  });

  it("sign-out inside the window sends the open save at once, not after the window", async () => {
    seed(ALL, []);
    getBaseCardDetail.mockResolvedValue(detail());
    const tree = (enabled: boolean) => (
      <StashProvider enabled={enabled}>
        <CardPopup
          baseCardId={7}
          isAuthenticated
          setNameByCode={{ SOR: "Spark of Rebellion" }}
          onClose={vi.fn()}
          initialVariantId={STD}
        />
      </StashProvider>
    );
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(tree(true));
    });
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await act(async () => {
      utils.rerender(tree(false));
    });
    // Sent from the captured provider function, before the 400 ms window.
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 1 }]);
  });

  it("a rejected save keeps the clicks made after it was sent (a cross-stash move), then saves them", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    const first = deferred<never>();
    putVariantAllocations.mockReturnValueOnce(first.promise).mockImplementation(okPut);
    await renderPopup();
    await waitFor(() => button(/edit/i));
    await click(button(/edit/i));
    await click(minus(1));
    await click(plus(2)); // move 1 -> 2
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    expect(putVariantAllocations.mock.calls[0]).toEqual([
      STD,
      [
        { stash_id: 1, quantity: 1 },
        { stash_id: 2, quantity: 1 },
      ],
    ]);
    await click(plus(3)); // after dispatch
    await act(async () => {
      first.reject(new StashApiError("unknown", 500));
    });
    // The move is undone; the later + on With Bob is kept, and the message
    // says so (REPLACE, round 4: was the plain "not saved" message).
    await waitFor(() =>
      expect(within(panel()).getByRole("alert").textContent).toBe(STASH_ERRORS.keptLater)
    );
    expect([count(1), count(2), count(3), vaultNum().textContent]).toEqual(["2", "0", "1", "0"]);
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations.mock.calls[1]).toEqual([
      STD,
      [
        { stash_id: 1, quantity: 2 },
        { stash_id: 3, quantity: 1 },
      ],
    ]);
  });

  it("a save that fails after a printing switch is said in the card's error line", async () => {
    seed(ALL, []);
    const first = deferred<never>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await selectPrinting(/Hyperspace/);
    await act(async () => {
      first.reject(new StashApiError("unknown", 500));
    });
    const line = await waitFor(() => document.querySelector(".cp-mutation-error")!);
    expect(line.textContent).toBe(staleSaveMessage("Standard – #5 – SOR"));
  });
});

// Round 3 (combined-branch reviews): the save store outside React. One
// serial queue for every stash PUT; editors read the store's desired split;
// owned requests per printing are all awaited before its stash PUT.
describe("R1-11 round 3: the app-wide save store", () => {
  const wait = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  const okPut = async (variantId: number, allocations: unknown) => ({
    variant_id: variantId,
    owned: 3,
    allocations,
  });
  const popup = (key: string | number = 1, enabled = true) => (
    <StashProvider key={key} enabled={enabled}>
      <CardPopup
        baseCardId={7}
        isAuthenticated
        setNameByCode={{ SOR: "Spark of Rebellion" }}
        onClose={vi.fn()}
        initialVariantId={STD}
      />
    </StashProvider>
  );
  const dec = () => document.querySelector(".cp-plate__step--dec") as HTMLButtonElement;

  it("leak repro: disabled then re-enabled, Edit starts from the server and the PUT is server + click", async () => {
    seed(ALL, []);
    getBaseCardDetail.mockResolvedValue(detail());
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(popup(1, true));
    });
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await act(async () => {
      utils.rerender(popup(1, false));
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    await wait(50);
    // Meanwhile the server's split changed elsewhere: nothing stashed now.
    seed(ALL, []);
    await act(async () => {
      utils.rerender(popup(1, true));
    });
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    expect([count(1), count(2), count(3)]).toEqual(["0", "0", "0"]);
    await click(plus(2));
    expect([count(1), count(2)]).toEqual(["0", "1"]);
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations.mock.calls[1]).toEqual([STD, [{ stash_id: 2, quantity: 1 }]]);
  });

  it("provider remount mid-flight: the new tree joins the same queue and the same desired split", async () => {
    seed(ALL, []);
    getBaseCardDetail.mockResolvedValue(detail());
    const first = deferred<{ variant_id: number; owned: number; allocations: unknown[] }>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(popup("a"));
    });
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    // The phone/desktop breakpoint switch remounts the provider and the card.
    await act(async () => {
      utils.rerender(popup("b"));
    });
    await waitFor(() => button(/edit|stash copies/i));
    await click(button(/edit|stash copies/i));
    expect([count(1), count(2)]).toEqual(["1", "0"]); // the pending desired split
    await click(plus(2));
    await wait(600);
    expect(putVariantAllocations).toHaveBeenCalledTimes(1); // one PUT on the wire, ever
    await act(async () => {
      first.resolve({ variant_id: STD, owned: 3, allocations: [{ stash_id: 1, quantity: 1 }] });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations.mock.calls[1]).toEqual([
      STD,
      [
        { stash_id: 1, quantity: 1 },
        { stash_id: 2, quantity: 1 },
      ],
    ]);
  });

  it("two overlapping owned requests: the stash PUT waits for both", async () => {
    seed(ALL, []);
    const adj1 = deferred<{ variant_id: number; quantity: number }>();
    const adj2 = deferred<{ variant_id: number; quantity: number }>();
    adjustCard.mockReturnValueOnce(adj1.promise).mockReturnValueOnce(adj2.promise);
    await renderPopup();
    await waitFor(() => button(/stash copies/i));
    await click(dec()); // 3 -> 2
    await waitFor(() => expect(adjustCard).toHaveBeenCalledTimes(1));
    await click(dec()); // 2 -> 1, a second request while the first is out
    await waitFor(() => expect(adjustCard).toHaveBeenCalledTimes(2));
    await click(button(/stash copies/i));
    await click(plus(1));
    await click(button("Done"));
    await act(async () => {
      adj2.resolve({ variant_id: STD, quantity: 1 });
    });
    await wait(50);
    expect(putVariantAllocations).not.toHaveBeenCalled(); // the first is still out
    await act(async () => {
      adj1.resolve({ variant_id: STD, quantity: 2 });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
  });

  it("A -> B -> A with A's save in flight: the list and the owned floor show the pending split", async () => {
    seed(ALL, []);
    const first = deferred<{ variant_id: number; owned: number; allocations: unknown[] }>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    await renderPopup({ initialVariantId: HYP }); // 1 owned
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(2));
    await click(button("Done"));
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    await selectPrinting(/^Standard/);
    await selectPrinting(/Hyperspace/);
    // Still unconfirmed: the read list holds it and the owned - is at the floor.
    const names = [...panel().querySelectorAll(".cp-stash__readrow .cp-stash__name")].map(
      (n) => n.textContent
    );
    expect(names).toEqual(["Trade stash"]);
    expect(dec().getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      first.resolve({ variant_id: HYP, owned: 1, allocations: [{ stash_id: 2, quantity: 1 }] });
    });
  });

  it("close and reopen: the reopened card joins the pending save", async () => {
    seed(ALL, []);
    getBaseCardDetail.mockResolvedValue(detail());
    const first = deferred<{ variant_id: number; owned: number; allocations: unknown[] }>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(popup());
    });
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await act(async () => {
      utils.rerender(
        <StashProvider key={1} enabled>
          <div />
        </StashProvider>
      );
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1)); // sent on close
    await act(async () => {
      utils.rerender(popup());
    });
    await waitFor(() => button(/edit|stash copies/i));
    await click(button(/edit|stash copies/i));
    expect(count(1)).toBe("1");
    await click(plus(3));
    await wait(600);
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ variant_id: STD, owned: 3, allocations: [{ stash_id: 1, quantity: 1 }] });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations.mock.calls[1]).toEqual([
      STD,
      [
        { stash_id: 1, quantity: 1 },
        { stash_id: 3, quantity: 1 },
      ],
    ]);
  });

  it("failure after a switch to a printing with a different owned count: the rollback uses the saved printing's count", async () => {
    seed(ALL, []);
    const first = deferred<never>();
    putVariantAllocations.mockReturnValueOnce(first.promise).mockImplementation(okPut);
    await renderPopup(); // Standard, 3 owned
    await waitFor(() => button(/stash copies/i));
    await click(button(/stash copies/i));
    await click(plus(1));
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    await click(plus(2));
    await click(plus(3)); // after the snapshot
    await selectPrinting(/Hyperspace/); // 1 owned
    await act(async () => {
      first.reject(new StashApiError("unknown", 500));
    });
    // Standard keeps its two later clicks (3 owned), sent next.
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations.mock.calls[1]).toEqual([
      STD,
      [
        { stash_id: 2, quantity: 1 },
        { stash_id: 3, quantity: 1 },
      ],
    ]);
    // Later clicks were kept: the notice says so (REPLACE, round 4 wording).
    expect(document.querySelector(".cp-mutation-error")!.textContent).toBe(
      staleSaveMessage("Standard – #5 – SOR", true)
    );
  });
});
