import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedStashPage } from "./SharedStashPage";
import { ShareResolveError } from "../../api/sharedView";
import type { SharedStashView } from "../../api/sharedView";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";

// BL-209 slice (c): a stash link's desktop viewer, end to end below the API:
// SharedStashPage -> CardsPage (`sharedStash`) -> SharedStashPane and the
// card popup, over a mocked catalogue and stash read. The LimitsProvider and
// StashProvider are the real ones (signed out / disabled: neither fetches).

const { getSharedStash, getSharedQuantities, resolveShare } = vi.hoisted(() => ({
  getSharedStash: vi.fn(),
  getSharedQuantities: vi.fn(),
  resolveShare: vi.fn(),
}));
vi.mock("../../api/sharedView", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/sharedView")>("../../api/sharedView");
  return { ...actual, getSharedStash, getSharedQuantities, resolveShare };
});

const { getBaseCardsList, getBaseCardDetail } = vi.hoisted(() => ({
  getBaseCardsList: vi.fn(),
  getBaseCardDetail: vi.fn(),
}));
vi.mock("../../api/baseCards", () => ({
  getBaseCardsList: () => getBaseCardsList(),
  getBaseCardDetail: (id: number) => getBaseCardDetail(id),
  getPriceHistory: vi.fn().mockResolvedValue({ variant_id: 0, range: "90d", series: [] }),
}));
vi.mock("../../api/sets", () => ({
  getSets: vi.fn().mockResolvedValue([
    {
      id: 1,
      code: "SOR",
      name: "Spark of Rebellion",
      is_base_set: true,
      release_date: "2024-03-08",
    },
  ]),
}));
vi.mock("../../analytics/analytics", () => ({ capture: vi.fn() }));

function variant(id: number, n: string, price: number | null): VariantDetail {
  return {
    variant_id: id,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    stamped: false,
    source_set_code: "SOR",
    source_set_name: "Spark of Rebellion",
    card_number: n,
    front_image_url: null,
    back_image_url: null,
    stamp_group: null,
    quantity: 0,
    price: price == null ? null : { market: price, low: price / 2 },
  } as VariantDetail;
}

function card(id: number, name: string, price: number | null): BaseCardDetail {
  return {
    id,
    set_code: "SOR",
    set_name: "Spark of Rebellion",
    base_card_number: String(id),
    name,
    subtitle: null,
    type: "Unit",
    type2: null,
    double_sided: false,
    rarity: "C",
    cost: 1,
    power: 1,
    hp: 1,
    arena: "Ground",
    is_unique: false,
    front_text: null,
    back_text: null,
    epic_action: null,
    artist: null,
    is_token: false,
    aspects: [],
    keywords: [],
    traits: [],
    variants: [variant(id, String(id), price)],
  };
}

const CATALOG = [card(1, "Alpha", 2), card(2, "Bravo", 5), card(3, "Charlie", null)];

function view(over: Partial<SharedStashView> = {}): SharedStashView {
  return {
    share_name: "Rowan",
    stash: { name: "Trade binder", description: "Doubles for locals." },
    rows: [
      { variant_id: 1, quantity: 3, stashed_at: "2026-11-01T00:00:00Z", market: 2, low: 1 },
      { variant_id: 2, quantity: 1, stashed_at: "2026-11-05T00:00:00Z", market: 5, low: 2.5 },
    ],
    totals: { printings: 2, copies: 4, value_market: 11, value_low: 5.5 },
    ...over,
  };
}

async function renderPage(token = "stok-1", onResolved = vi.fn()) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<SharedStashPage token={token} onResolved={onResolved} />);
  });
  return utils;
}

describe("SharedStashPage (BL-209 slice c)", () => {
  beforeEach(() => {
    getSharedStash.mockReset();
    getSharedQuantities.mockReset();
    resolveShare.mockReset();
    getBaseCardsList.mockResolvedValue(CATALOG);
    getBaseCardDetail.mockImplementation(async (id: number) => CATALOG.find((c) => c.id === id));
    window.localStorage.clear();
  });

  it("shows the loading sentence while the stash reads", async () => {
    getSharedStash.mockReturnValue(new Promise(() => {}));
    await renderPage();
    expect(screen.getByText("Loading shared stash…")).toBeInTheDocument();
  });

  it("renders the head -- eyebrow, name, description -- and reports the label up", async () => {
    getSharedStash.mockResolvedValue(view());
    const onResolved = vi.fn();
    const { container } = await renderPage("stok-1", onResolved);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Trade binder" })).toBeVisible()
    );
    expect(container.querySelector(".ss-eyebrow")!.textContent).toBe("Rowan's stash · Read only");
    expect(screen.getByText("Doubles for locals.")).toBeInTheDocument();
    expect(onResolved).toHaveBeenCalledWith("stok-1", "Rowan · Trade binder");
    // The stash read is the only share read: no resolve, no quantities.
    expect(getSharedStash).toHaveBeenCalledWith("stok-1");
    expect(resolveShare).not.toHaveBeenCalled();
    expect(getSharedQuantities).not.toHaveBeenCalled();
  });

  it("omits the description entirely when the stash has none", async () => {
    getSharedStash.mockResolvedValue(view({ stash: { name: "Spare box", description: null } }));
    const { container } = await renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Spare box" })).toBeVisible());
    expect(container.querySelector(".ss-desc, .sp-read__desc")).toBeNull();
    expect(screen.queryByText("No description")).toBeNull();
  });

  it("Cards and Value tiles total the stash, following Market / Low", async () => {
    getSharedStash.mockResolvedValue(view());
    const { container } = await renderPage();
    await waitFor(() => expect(container.querySelectorAll(".sp-table tbody tr")).toHaveLength(2));
    const values = () =>
      [...container.querySelectorAll(".ss-page .inv-summary__value")].map((e) => e.textContent);
    // 3 x $2 + 1 x $5 at Market.
    expect(values()).toEqual(["4", "$11.00"]);
    fireEvent.click(
      within(container.querySelector(".ss-page")!).getByRole("switch", {
        name: "Showing market price — switch to low",
      })
    );
    await waitFor(() => expect(values()).toEqual(["4", "$5.50"]));
  });

  it("the table is read-only: In stash is the count chip alone, no edit controls", async () => {
    getSharedStash.mockResolvedValue(view());
    const { container } = await renderPage();
    await waitFor(() => expect(container.querySelectorAll(".sp-table tbody tr")).toHaveLength(2));
    const chips = [...container.querySelectorAll(".sp-td--qty .playset-chip")].map(
      (c) => c.textContent
    );
    expect(chips.sort()).toEqual(["1", "3"]);
    expect(
      container.querySelector(".sp-minus, .sp-trash, .sp-pencil, .sp-rail, .sp-newbtn")
    ).toBeNull();
    for (const name of [/return/i, /^share$/i, /new stash/i, /add cards/i, /edit/i, /delete/i])
      expect(screen.queryByRole("button", { name })).toBeNull();
    // Recently stashed is in the sort bar (rows carry stashed_at).
    expect(screen.getByRole("button", { name: "Sort by Recently stashed" })).toBeInTheDocument();
  });

  it("a row opens the read-only detail with the in-stash count, no stepper", async () => {
    getSharedStash.mockResolvedValue(view());
    const { container } = await renderPage();
    await waitFor(() => expect(container.querySelectorAll(".sp-table tbody tr")).toHaveLength(2));
    const row = container.querySelector('.sp-table tbody tr[data-variant="1"]')!;
    await act(async () => {
      fireEvent.click(row);
    });
    await waitFor(() =>
      expect(container.ownerDocument.querySelector(".cp-plate__owned-label")).not.toBeNull()
    );
    const doc = container.ownerDocument;
    expect(doc.querySelector(".cp-plate__owned-label")!.textContent).toBe("IN STASH — Standard #1");
    expect(doc.querySelector(".cp-plate__count")!.textContent).toBe("3");
    expect(doc.querySelector(".cp-plate__step, .cp-plate__bar")).toBeNull();
  });

  it("an empty stash: the head, 0 and —, then the one sentence", async () => {
    getSharedStash.mockResolvedValue(
      view({
        stash: { name: "Spare box", description: null },
        rows: [],
        totals: { printings: 0, copies: 0, value_market: 0, value_low: 0 },
      })
    );
    const { container } = await renderPage();
    await waitFor(() =>
      expect(screen.getByText("Spare box has no cards right now.")).toBeInTheDocument()
    );
    const values = [...container.querySelectorAll(".ss-page .inv-summary__value")].map(
      (e) => e.textContent
    );
    expect(values).toEqual(["0", "—"]);
    expect(container.querySelector(".sp-table")).toBeNull();
  });

  it("a dead link (404, or any other error) shows one sentence and no pane", async () => {
    getSharedStash.mockRejectedValue(new ShareResolveError("not_found", 404));
    const onResolved = vi.fn();
    const { container } = await renderPage("dead", onResolved);
    await waitFor(() =>
      expect(screen.getByText("This shared stash is no longer available.")).toBeInTheDocument()
    );
    expect(container.querySelector(".ss-page")).toBeNull();
    expect(onResolved).not.toHaveBeenCalled();
    getSharedStash.mockRejectedValue(new ShareResolveError("unknown", 500));
    await renderPage("other");
    await waitFor(() =>
      expect(screen.getAllByText("This shared stash is no longer available.")).toHaveLength(2)
    );
  });

  it("a rate-limited link shows the traffic sentence", async () => {
    getSharedStash.mockRejectedValue(new ShareResolveError("rate_limited", 429, 30));
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(
          "This shared stash is getting a lot of traffic right now — please try again in a moment."
        )
      ).toBeInTheDocument()
    );
  });

  // PORT (fold-in): this case reads a new token; the same-token live reads are
  // the "live updates" block below.
  it("a new token's read shows its stash (token change re-reads)", async () => {
    getSharedStash.mockResolvedValue(view());
    const { container, rerender } = await renderPage("stok-1");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Trade binder" })).toBeVisible()
    );
    getSharedStash.mockResolvedValue(
      view({
        stash: { name: "Trade box", description: null },
        rows: [
          { variant_id: 1, quantity: 2, stashed_at: "2026-11-01T00:00:00Z", market: 2, low: 1 },
        ],
      })
    );
    const onResolved = vi.fn();
    await act(async () => {
      rerender(<SharedStashPage token="stok-2" onResolved={onResolved} />);
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Trade box" })).toBeVisible());
    expect(container.querySelectorAll(".sp-table tbody tr")).toHaveLength(1);
    expect(onResolved).toHaveBeenCalledWith("stok-2", "Rowan · Trade box");
  });

  describe("live updates: a re-read when the viewer returns to the tab", () => {
    let now = 1_000_000;
    beforeEach(() => {
      now = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const returnToTab = async (kind: "focus" | "visible") => {
      await act(async () => {
        if (kind === "focus") window.dispatchEvent(new Event("focus"));
        else document.dispatchEvent(new Event("visibilitychange"));
      });
    };

    it("same token: a rename and a count change reach the open viewer, keeping the pane", async () => {
      getSharedStash.mockResolvedValue(view());
      const onResolved = vi.fn();
      const { container } = await renderPage("stok-1", onResolved);
      await waitFor(() => expect(container.querySelectorAll(".sp-table tbody tr")).toHaveLength(2));
      fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
      getSharedStash.mockResolvedValue(
        view({
          stash: { name: "Trade box", description: "Renamed." },
          rows: [
            { variant_id: 1, quantity: 1, stashed_at: "2026-11-01T00:00:00Z", market: 2, low: 1 },
          ],
        })
      );
      // Within 30 s of the last read: nothing.
      now += 10_000;
      await returnToTab("focus");
      expect(getSharedStash).toHaveBeenCalledTimes(1);
      // Past 30 s: the tab becoming visible re-reads.
      now += 25_000;
      await returnToTab("visible");
      await waitFor(() => expect(screen.getByRole("heading", { name: "Trade box" })).toBeVisible());
      expect(getSharedStash).toHaveBeenCalledTimes(2);
      expect(getSharedStash).toHaveBeenLastCalledWith("stok-1");
      expect(screen.getByText("Renamed.")).toBeInTheDocument();
      const values = [...container.querySelectorAll(".ss-page .inv-summary__value")].map(
        (e) => e.textContent
      );
      expect(values).toEqual(["1", "$2.00"]);
      // The pane was kept, not remounted: still on Gallery.
      expect(screen.getByRole("button", { name: "Gallery" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      expect(onResolved).toHaveBeenLastCalledWith("stok-1", "Rowan · Trade box");
    });

    it("same token: a revocation (404) turns the open viewer into the dead link", async () => {
      getSharedStash.mockResolvedValue(view());
      const onGone = vi.fn();
      let utils!: ReturnType<typeof render>;
      await act(async () => {
        utils = render(<SharedStashPage token="stok-1" onResolved={vi.fn()} onGone={onGone} />);
      });
      await waitFor(() =>
        expect(utils.container.querySelectorAll(".sp-table tbody tr")).toHaveLength(2)
      );
      getSharedStash.mockRejectedValue(new ShareResolveError("not_found", 404));
      now += 31_000;
      await returnToTab("focus");
      await waitFor(() =>
        expect(screen.getByText("This shared stash is no longer available.")).toBeInTheDocument()
      );
      expect(utils.container.querySelector(".ss-page")).toBeNull();
      expect(onGone).toHaveBeenCalledWith("stok-1");
    });

    it("a later 429 or other failure keeps what is shown", async () => {
      getSharedStash.mockResolvedValue(view());
      const { container } = await renderPage();
      await waitFor(() => expect(container.querySelectorAll(".sp-table tbody tr")).toHaveLength(2));
      getSharedStash.mockRejectedValue(new ShareResolveError("rate_limited", 429));
      now += 31_000;
      await returnToTab("focus");
      getSharedStash.mockRejectedValue(new ShareResolveError("unknown", 500));
      now += 31_000;
      await returnToTab("focus");
      expect(getSharedStash).toHaveBeenCalledTimes(3);
      expect(screen.getByRole("heading", { name: "Trade binder" })).toBeVisible();
      expect(container.querySelectorAll(".sp-table tbody tr")).toHaveLength(2);
    });
  });
});
