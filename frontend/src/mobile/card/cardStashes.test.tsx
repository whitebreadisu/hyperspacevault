import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Stash, StashItem } from "../../api/stashes";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";

// BL-344 slice 1, phone 1e "Stash sheet" (claude_design/design_handoff_card_stash
// README; BL-344 owner decisions). The real CardDetail inside a StashProvider
// and a SheetHost, the vault data and the stash / inventory APIs mocked. One
// test (or more) per README state:
//   a1 entry under the plate          a2 the sheet in New stash mode
//   b1 entry -> rows when stashes exist  b2 rows, + from the Vault, Done
//   c1 read-only list on the plate    g  the list pinned under the collapsed row
//   c2 Edit -> rows from the saved split  d1 stash -> stash   d2 stash -> Vault
//   e1 all stashed: Vault 0 red, + off    e2 0 owned: nothing
//   f1 a share / f2 signed out: nothing drawn, nothing fetched
// plus save on click (BL-344 R1-11: no Cancel; Done, the X and the scrim
// close the sheet and send the open window; a failure reopens it rolled
// back with the message), and the owned stepper's floor.
// Pixel sizes (44 px targets, the pinned list's place) are measured in the
// browser: e2e/mobile/bl344-stashes.spec.ts.

vi.mock("../../analytics/analytics", async (orig) => ({
  ...(await orig<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../api/baseCards", async (orig) => ({
  ...(await orig<typeof import("../../api/baseCards")>()),
  getBaseCardDetail: vi.fn().mockRejectedValue(new Error("offline")),
  getPriceHistory: vi.fn().mockResolvedValue({ variant_id: 1, range: "90d", series: [] }),
}));
vi.mock("../../context/LimitsContext", () => ({
  useLimits: () => ({ limits: null, capMode: "hard" }),
}));
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

const v = (id: number, finish: string, num: string, quantity: number): InventoryVariant => ({
  variant_id: id,
  variant_type: finish,
  finish,
  channel: "Retail",
  source_set_code: "SOR",
  card_number: num,
  front_image_url: null,
  back_image_url: null,
  quantity,
});
const STD = 10;
const HYP = 11;
const FOIL = 12;
const CARD: InventoryCard = {
  base_card_id: 1,
  set_code: "SOR",
  base_card_number: "5",
  name: "Luke Skywalker",
  subtitle: null,
  type: "Unit",
  rarity: "Common",
  aspects: [],
  keywords: [],
  traits: [],
  cost: 1,
  power: 1,
  hp: 1,
  arena: "Ground",
  is_token: false,
  variants: [v(STD, "Standard", "5", 3), v(HYP, "Hyperspace", "269", 1), v(FOIL, "Foil", "5", 0)],
  inventory: { [STD]: 3, [HYP]: 1 },
};
const vault = vi.hoisted(() => ({ isAuthenticated: true, readOnly: false }));
vi.mock("../../vault/useVaultData", () => ({
  useVaultData: () => ({
    cards: [CARD],
    setOrder: { SOR: "2024-03-08" },
    setNameByCode: { SOR: "Spark of Rebellion" },
    isAuthenticated: vault.isAuthenticated,
    readOnly: vault.readOnly,
    loading: false,
    patchQuantity: () => {},
  }),
}));

import { StashApiError } from "../../api/stashes";
import { StashProvider } from "../../stashes/StashContext";
import { resetStashSaveStoreForTests } from "../../stashes/stashSaveStore";
import { resetOwnedSettleForTests } from "../../utils/ownedSettle";
import { STASH_ERRORS, STASH_FLOOR_HINT } from "../../stashes/useStashEditor";
import { SheetHost } from "../Sheet";
import { CardDetail } from "./CardDetail";
import { resetNavForTest } from "./navList";

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

async function renderDetail(opts: { enabled?: boolean; v?: number } = {}) {
  await act(async () => {
    render(
      <div className="m-app">
        <SheetHost>
          <StashProvider enabled={opts.enabled ?? true}>
            <CardDetail id={1} params={{ v: String(opts.v ?? STD) }} onRequestSignIn={() => {}} />
          </StashProvider>
        </SheetHost>
      </div>
    );
  });
}

const own = () => document.querySelector(".m-dreg3__own") as HTMLElement;
const sheet = () => document.querySelector(".m-sheet-layer--stash") as HTMLElement | null;
const row = (id: number) =>
  sheet()!.querySelector(`.m-stash__row[data-stash="${id}"]`) as HTMLElement;
const minus = (id: number) => row(id).querySelectorAll<HTMLButtonElement>(".m-step")[0];
const plus = (id: number) => row(id).querySelectorAll<HTMLButtonElement>(".m-step")[1];
const count = (id: number) => row(id).querySelector(".m-step__qty")!.textContent;
const vaultNum = () => sheet()!.querySelector(".m-stash__vault") as HTMLElement;
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const entry = () => own().querySelector(".m-stash__entry") as HTMLButtonElement | null;
const listNames = (root: Element) =>
  [...root.querySelectorAll(".m-stash__readrow .m-stash__name")].map((n) => n.textContent);
const closed = () => waitFor(() => expect(sheet()).toBeNull(), { timeout: 2000 });

beforeEach(() => {
  vi.clearAllMocks();
  // The save store and the owned tracker are app-wide modules.
  resetStashSaveStoreForTests();
  resetOwnedSettleForTests();
  putOptions.length = 0;
  resetNavForTest();
  window.location.hash = "#/card/1";
  vault.isAuthenticated = true;
  vault.readOnly = false;
  putVariantAllocations.mockImplementation(async (variantId, allocations) => ({
    variant_id: variantId,
    owned: 3,
    allocations,
  }));
});

describe("BL-344 phone 1e states", () => {
  it("a1: Stash copies under the plate (between the plate and the rest)", async () => {
    seed([], []);
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    expect(entry()!.textContent).toMatch(/Stash copies/);
    // After the plate inside the expanded block.
    const kids = [...own().children];
    expect(kids.indexOf(entry()!)).toBeGreaterThan(
      kids.findIndex((k) => k.classList.contains("m-plate-hit"))
    );
    expect(document.querySelector(".m-dreg3__pinned")).toBeNull();
  });

  it("a2: no stashes -> the sheet opens on New stash; Create switches it to rows", async () => {
    seed([], []);
    createStash.mockResolvedValue(ST(1, "Red binder"));
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(entry()!);
    expect(within(sheet()!).getByRole("heading").textContent).toBe("New stash");
    expect(sheet()!.querySelector(".m-sheet__sub")).toBeNull();
    const create = within(sheet()!).getByRole("button", { name: "Create stash" });
    expect(create.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(within(sheet()!).getByRole("textbox", { name: "Name" }), {
      target: { value: "Red binder" },
    });
    await click(create);
    expect(createStash).toHaveBeenCalledWith("Red binder", null);
    await waitFor(() =>
      expect(within(sheet()!).getByRole("heading").textContent).toBe("Stash copies")
    );
    expect(sheet()!.querySelector(".m-sheet__sub")!.textContent).toBe("Standard · SOR 5 · 3 owned");
    expect(vaultNum().textContent).toBe("3");
    expect(count(1)).toBe("0");
    expect(putVariantAllocations).not.toHaveBeenCalled();
    expect(adjustCard).not.toHaveBeenCalled();
  });

  it("a2: Cancel in New stash (first stash) closes the sheet", async () => {
    seed([], []);
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(entry()!);
    await click(within(sheet()!).getByRole("button", { name: "Cancel" }));
    await closed();
    expect(createStash).not.toHaveBeenCalled();
  });

  it("b1: stashes exist, none hold this printing -> entry, then the rows", async () => {
    seed(ALL, [{ stash_id: 2, variant_id: HYP, quantity: 1 }]);
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(entry()!);
    expect(sheet()!.querySelectorAll(".m-stash__row")).toHaveLength(4);
    expect(vaultNum().textContent).toBe("3");
  });

  // REPLACE (R1-11): was staged; the clicks save themselves and Done sends
  // the still-open window at once, then closes.
  it("b2: + stashes from the Vault; Done sends one PUT and closes", async () => {
    seed(ALL, []);
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(entry()!);
    await click(plus(1));
    await click(plus(1));
    expect([count(1), vaultNum().textContent]).toEqual(["2", "1"]);
    getStashItems.mockResolvedValue([{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await click(within(sheet()!).getByRole("button", { name: "Done" }));
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 2 }]);
    await closed();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
  });

  it("c1: the read-only list on the plate (holders only), chip, Edit", async () => {
    seed(ALL, [
      { stash_id: 1, variant_id: STD, quantity: 3 },
      { stash_id: 2, variant_id: HYP, quantity: 1 },
    ]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    const chip = own().querySelector(".m-stash__readrow .playset-chip")!;
    expect(chip.textContent).toBe("3");
    expect(chip.className).toContain("playset-chip--complete"); // a Unit's playset is 3
    expect(entry()).toBeNull();
    expect(within(own()).getByRole("button", { name: /edit/i })).toBeTruthy();
  });

  it("g: the same list is pinned for the collapsed row (shown only collapsed)", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderDetail();
    await waitFor(() => expect(document.querySelector(".m-dreg3__pinned")).not.toBeNull());
    const pinned = document.querySelector(".m-dreg3__pinned")!;
    expect(listNames(pinned)).toEqual(["Red binder"]);
    // Expanded: hidden from assistive tech (it fades in with the mini row).
    expect(pinned.getAttribute("aria-hidden")).toBe("true");
    // The region's layout box grows by the pinned list (cardDetailModel stashGeom).
    const reg = document.querySelector(".m-dreg3") as HTMLElement;
    expect(reg.style.getPropertyValue("--reg-min")).toBe(100 + 44 + 40 + 7 + "px");
  });

  it("c2: Edit opens the rows seeded from the saved split", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    await click(within(own()).getByRole("button", { name: /edit/i }));
    expect([vaultNum().textContent, count(1), count(2), count(3)]).toEqual(["1", "2", "0", "0"]);
  });

  it("d1 / d2: stash -> stash, stash -> Vault", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 2 }]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    await click(within(own()).getByRole("button", { name: /edit/i }));
    await click(minus(1));
    await click(plus(2));
    expect([count(1), count(2), vaultNum().textContent]).toEqual(["1", "1", "1"]);
    await click(minus(2));
    expect([count(2), vaultNum().textContent]).toEqual(["0", "2"]);
    expect(minus(2).getAttribute("aria-disabled")).toBe("true");
  });

  it("e1: every copy stashed -> Vault 0 red, every + off and inert", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 3 }]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    await click(within(own()).getByRole("button", { name: /edit/i }));
    expect(vaultNum().textContent).toBe("0");
    expect(vaultNum().className).toContain("m-stash__vault--empty");
    for (const id of [1, 2, 3]) expect(plus(id).getAttribute("aria-disabled")).toBe("true");
    await click(plus(2));
    expect(count(2)).toBe("0");
  });

  it("e2: 0 owned -> no entry, no list", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 3 }]);
    await renderDetail({ v: FOIL });
    await waitFor(() => expect(getStashItems).toHaveBeenCalled());
    await act(async () => {});
    expect(document.querySelector("[class*='m-stash']")).toBeNull();
    expect(document.querySelector(".m-dreg3__pinned")).toBeNull();
  });

  it("f1: a share (disabled provider, readOnly) draws nothing and fetches nothing", async () => {
    vault.readOnly = true;
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 3 }]);
    await renderDetail({ enabled: false });
    expect(document.querySelector("[class*='m-stash']")).toBeNull();
    expect(getStashes).not.toHaveBeenCalled();
    expect(getStashItems).not.toHaveBeenCalled();
  });

  it("f2: signed out draws nothing and fetches nothing", async () => {
    vault.isAuthenticated = false;
    seed(ALL, []);
    await renderDetail({ enabled: false });
    expect(document.querySelector("[class*='m-stash']")).toBeNull();
    expect(getStashes).not.toHaveBeenCalled();
  });
});

describe("BL-344 phone staging", () => {
  // Disposition (R1-11): "the X = Cancel" REPLACE -> the X closes and sends
  // the open window; "the footer Cancel discards too" RETIRE (Cancel is
  // designed away) -> "the rows' foot is Done alone".
  it("the X closes the sheet and sends the open window: nothing is discarded", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    await click(within(own()).getByRole("button", { name: /edit/i }));
    await click(plus(2));
    getStashItems.mockResolvedValue([
      { stash_id: 1, variant_id: STD, quantity: 1 },
      { stash_id: 2, variant_id: STD, quantity: 1 },
    ]);
    await click(within(sheet()!).getByRole("button", { name: "Close" }));
    await closed();
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [
      { stash_id: 1, quantity: 1 },
      { stash_id: 2, quantity: 1 },
    ]);
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder", "Trade stash"]));
  });

  it("the rows' foot is Done alone (no Cancel)", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    await click(within(own()).getByRole("button", { name: /edit/i }));
    const foot = sheet()!.querySelector(".m-stash__foot") as HTMLElement;
    expect(
      within(foot)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Done"]);
    expect(within(sheet()!).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("rapid clicks save once, after the window, with the latest split", async () => {
    seed(ALL, []);
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(entry()!);
    await click(plus(1));
    await click(plus(2));
    await click(plus(2));
    await click(minus(2));
    expect([count(1), count(2), vaultNum().textContent]).toEqual(["1", "1", "1"]);
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [
      { stash_id: 1, quantity: 1 },
      { stash_id: 2, quantity: 1 },
    ]);
    expect(sheet()).not.toBeNull(); // saving never closes the sheet
  });

  it("a save that fails after Done reopens the sheet, rolled back, with the message", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    putVariantAllocations.mockRejectedValue(new StashApiError("unknown", 500));
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    await click(within(own()).getByRole("button", { name: /edit/i }));
    await click(plus(2));
    await click(within(sheet()!).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(within(sheet()!).getByRole("alert").textContent).toBe(STASH_ERRORS.saveFailed)
    );
    expect([count(1), count(2), vaultNum().textContent]).toEqual(["1", "0", "2"]);
    expect(listNames(own())).toEqual(["Red binder"]);
  });

  it("a duplicate name is an inline error under Name", async () => {
    seed(ALL, []);
    createStash.mockRejectedValue(new StashApiError("duplicate_name", 409));
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(entry()!);
    await click(within(sheet()!).getByRole("button", { name: /new stash/i }));
    fireEvent.change(within(sheet()!).getByRole("textbox", { name: "Name" }), {
      target: { value: "red binder" },
    });
    await click(within(sheet()!).getByRole("button", { name: "Create stash" }));
    expect(within(sheet()!).getByRole("alert").textContent).toBe(STASH_ERRORS.duplicate);
    // New stash from the rows: Cancel goes back to the rows.
    await click(within(sheet()!).getByRole("button", { name: "Cancel" }));
    expect(within(sheet()!).getByRole("heading").textContent).toBe("Stash copies");
  });
});

describe("BL-344 phone decrease floor", () => {
  it("owned = stashed: the owned - is aria-disabled with the hint and queues nothing", async () => {
    seed(ALL, [{ stash_id: 2, variant_id: HYP, quantity: 1 }]);
    await renderDetail({ v: HYP });
    const dec = () =>
      document.querySelector(
        '.m-print.cp-rail__item--active .m-step[aria-label^="Decrement"]'
      ) as HTMLButtonElement;
    await waitFor(() => expect(dec().getAttribute("aria-disabled")).toBe("true"));
    expect(dec().getAttribute("aria-label")).toContain(STASH_FLOOR_HINT);
    expect(dec().disabled).toBe(false);
    await click(dec());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(adjustCard).not.toHaveBeenCalled();
    expect(document.querySelector(".m-print.cp-rail__item--active .m-step__qty")!.textContent).toBe(
      "1"
    );
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("BL-344 fold-in round 1 (phone)", () => {
  it("F3: tap owned -, then Done at once: the adjust resolves before the PUT is sent", async () => {
    seed(ALL, []);
    const adj = deferred<{ variant_id: number; quantity: number }>();
    adjustCard.mockReturnValue(adj.promise);
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(
      document.querySelector('.m-print.cp-rail__item--active .m-step[aria-label^="Decrement"]')!
    ); // 3 -> 2, batch open
    await click(entry()!);
    expect(sheet()!.querySelector(".m-sheet__sub")!.textContent).toContain("2 owned");
    await click(plus(1));
    await click(within(sheet()!).getByRole("button", { name: "Done" }));
    expect(adjustCard).toHaveBeenCalledWith(STD, -1); // flushed now, not after 400 ms
    expect(putVariantAllocations).not.toHaveBeenCalled();
    await act(async () => {
      adj.resolve({ variant_id: STD, quantity: 2 });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 1 }]);
  });

  // REPLACE (R1-11): a printing change no longer discards; it sends the
  // open window for the old printing (and still closes the sheet).
  it("F3: a printing change sends the open window (and closes the sheet)", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    await click(within(own()).getByRole("button", { name: /edit/i }));
    await click(plus(2));
    getStashItems.mockResolvedValue([
      { stash_id: 1, variant_id: STD, quantity: 1 },
      { stash_id: 2, variant_id: STD, quantity: 1 },
    ]);
    // A printing change under the sheet (the rail; a route change does the same).
    await click(document.querySelector(`.m-print[data-variant="${HYP}"] .m-print__main`)!);
    expect(sheet()).toBeNull();
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [
      { stash_id: 1, quantity: 1 },
      { stash_id: 2, quantity: 1 },
    ]);
    await click(document.querySelector(`.m-print[data-variant="${STD}"] .m-print__main`)!);
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder", "Trade stash"]));
  });

  it("F4: the owned - floor counts the staged split too (max of saved and staged)", async () => {
    seed(ALL, [{ stash_id: 1, variant_id: STD, quantity: 1 }]);
    await renderDetail();
    await waitFor(() => expect(listNames(own())).toEqual(["Red binder"]));
    const dec = () =>
      document.querySelector(
        '.m-print.cp-rail__item--active .m-step[aria-label^="Decrement"]'
      ) as HTMLButtonElement;
    expect(dec().getAttribute("aria-disabled")).toBeNull(); // 3 owned, 1 stashed
    await click(within(own()).getByRole("button", { name: /edit/i }));
    await click(plus(1));
    await click(plus(2)); // staged: 3 stashed
    expect(dec().getAttribute("aria-disabled")).toBe("true");
    expect(dec().getAttribute("aria-label")).toContain(STASH_FLOOR_HINT);
  });

  it("F6: while the first stash read is in flight the region keeps the entry's room", async () => {
    const list = deferred<Stash[]>();
    getStashes.mockReturnValue(list.promise);
    getStashItems.mockResolvedValue([]);
    await renderDetail();
    const page = document.querySelector(".m-page:not(.m-page--ghost)") as HTMLElement;
    const full = () => page.style.getPropertyValue("--d-full");
    const before = full();
    // 14 + 392 + 12 + 52 + 12, plus the held 6 + 44.
    expect(before).toBe(482 + 50 + "px");
    expect(document.querySelector(".m-stash__placeholder")).not.toBeNull();
    expect(entry()).toBeNull();
    await act(async () => {
      list.resolve([]);
    });
    await waitFor(() => expect(entry()).not.toBeNull());
    expect(full()).toBe(before);
  });
});

// Review fold-in (combined branch, 2026-11-08): a stash save settles ITS
// printing's owned batch, even after the printing changed (the phone stepper
// does not flush on a printing change by itself).
describe("BL-344 R1-11 fold-in (phone)", () => {
  it("printing change with an owned batch open: the stash PUT waits for that printing's adjust", async () => {
    seed(ALL, []);
    const adj = deferred<{ variant_id: number; quantity: number }>();
    adjustCard.mockReturnValue(adj.promise);
    await renderDetail();
    await waitFor(() => expect(entry()).not.toBeNull());
    await click(
      document.querySelector('.m-print.cp-rail__item--active .m-step[aria-label^="Decrement"]')!
    ); // 3 -> 2, batch open
    await click(entry()!);
    await click(plus(1));
    await click(document.querySelector(`.m-print[data-variant="${HYP}"] .m-print__main`)!);
    expect(sheet()).toBeNull();
    await waitFor(() => expect(adjustCard).toHaveBeenCalledWith(STD, -1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(putVariantAllocations).not.toHaveBeenCalled();
    await act(async () => {
      adj.resolve({ variant_id: STD, quantity: 2 });
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    expect(putVariantAllocations).toHaveBeenCalledWith(STD, [{ stash_id: 1, quantity: 1 }]);
  });
});
