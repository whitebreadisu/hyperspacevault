import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";

// The card detail top bar's share control (App Spec §25.2): the system share
// sheet with the card's name and the selected printing's page link, else a
// copy with "Link copied" in the bar's readout; a cancelled sheet does
// nothing; tokens have no page and keep the plain spacer.
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
const v = (id: number, finish: string, num: string): InventoryVariant => ({
  variant_id: id,
  variant_type: finish,
  finish,
  channel: "Retail",
  source_set_code: "SOR",
  card_number: num,
  front_image_url: null,
  back_image_url: null,
  quantity: 0,
});
const card = (id: number, num: string, extra: Partial<InventoryCard> = {}): InventoryCard => ({
  base_card_id: id,
  set_code: "SOR",
  base_card_number: num,
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
  variants: [v(id * 10, "Standard", num), v(id * 10 + 1, "Hyperspace", "271")],
  inventory: {},
  ...extra,
});
const CARDS = [card(1, "5"), card(2, "T01", { is_token: true, name: "Shield" })];
vi.mock("../../vault/useVaultData", () => ({
  useVaultData: () => ({
    cards: CARDS,
    setOrder: { SOR: "2024-03-08" },
    setNameByCode: { SOR: "Spark of Rebellion" },
    isAuthenticated: false,
    loading: false,
    patchQuantity: () => {},
  }),
}));

import { capture } from "../../analytics/analytics";
import { CardDetail } from "./CardDetail";
import { resetNavForTest } from "./navList";
import { SHARE_NOTE_MS } from "./useCardShare";

const spy = vi.mocked(capture);
const linkEvents = () => spy.mock.calls.filter(([e]) => e === "card_link_copied").map(([, p]) => p);
// Off production the link names the page's own origin (App Spec §5.3).
const PAGE = `${window.location.origin}/cards/sor/005/`;
const shareButton = () => screen.getByRole("button", { name: "Share link to this card" });

function setNav(name: "clipboard" | "share", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

describe("card detail share", () => {
  beforeEach(() => {
    spy.mockClear();
    resetNavForTest();
    window.location.hash = "#/card/1";
  });
  afterEach(() => {
    vi.useRealTimers();
    setNav("clipboard", undefined);
    setNav("share", undefined);
    resetNavForTest();
  });

  it("sits top-left in the bar, opposite the X", () => {
    render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    const bar = document.querySelector(".m-hdr__bar")!;
    expect(bar.firstElementChild).toBe(shareButton());
    expect(bar.lastElementChild?.getAttribute("aria-label")).toBe("Close card");
  });

  it("shares the card's name and the selected printing's link", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNav("share", share);
    render(<CardDetail id={1} params={{ v: "11" }} onRequestSignIn={() => {}} />);
    await act(async () => {
      fireEvent.click(shareButton());
    });
    expect(share).toHaveBeenCalledWith({
      title: "Luke Skywalker",
      url: PAGE + "?v=hyperspace-sor-271",
    });
    expect(linkEvents()).toEqual([{ method: "share", surface: "phone", layout: "phone" }]);
    // A share shows no copy confirmation: the readout stays the position.
    expect(screen.queryByText("Link copied")).toBeNull();
  });

  it("a cancelled share does nothing and sends nothing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav("clipboard", { writeText });
    setNav("share", vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")));
    render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    await act(async () => {
      fireEvent.click(shareButton());
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(linkEvents()).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByText("Link copied")).toBeNull();
  });

  it("copies when there is no share sheet, and says so in the readout for a moment", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav("clipboard", { writeText });
    render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    // The live region is there, empty and polite, before anything is copied.
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    expect(region.getAttribute("aria-live")).toBe("polite");
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(shareButton());
    });
    expect(writeText).toHaveBeenCalledWith(PAGE);
    // The same element receives the text; the visible readout takes it too,
    // hidden from screen readers so it is announced once.
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("Link copied");
    const pos = document.querySelector(".m-hdr__pos")!;
    expect(pos.textContent).toBe("Link copied");
    expect(pos.getAttribute("aria-hidden")).toBe("true");

    expect(linkEvents()).toEqual([{ method: "copy", surface: "phone", layout: "phone" }]);
    act(() => {
      vi.advanceTimersByTime(SHARE_NOTE_MS);
    });
    expect(region.textContent).toBe("");
    expect(pos.textContent).toMatch(/ of /);
  });

  it("a share that settles after the detail closed sets nothing", async () => {
    let settle!: () => void;
    setNav(
      "share",
      vi.fn(() => new Promise<void>((r) => (settle = r)))
    );
    const { unmount } = render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    fireEvent.click(shareButton());
    unmount();
    await act(async () => {
      settle();
    });
    expect(linkEvents()).toEqual([{ method: "share", surface: "phone", layout: "phone" }]);
  });

  it("a token has no page, so no share control", () => {
    window.location.hash = "#/card/2";
    render(<CardDetail id={2} params={{}} onRequestSignIn={() => {}} />);
    expect(screen.queryByRole("button", { name: "Share link to this card" })).toBeNull();
    expect(document.querySelector(".m-hdr__balance")).not.toBeNull();
  });
});
