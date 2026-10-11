import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";

// BL-248 S2-11 (BL-244, additive): the card detail captures desktop's
// events with desktop's property names, each with layout: "phone" --
// card_popup_opened {source, set_code} (CardPopup.tsx:255), quantity_changed
// {direction, surface} (CardPopupInventory.tsx:347), price_history_opened
// (PriceHistoryPanel.tsx:293), popup_card_navigated {method}
// (CardPopupNav.tsx:46). The seam's capture() is a spy.
vi.mock("../../analytics/analytics", async (orig) => ({
  ...(await orig<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../api/baseCards", async (orig) => ({
  ...(await orig<typeof import("../../api/baseCards")>()),
  getBaseCardDetail: vi.fn().mockRejectedValue(new Error("offline")),
  getPriceHistory: vi.fn().mockResolvedValue({ variant_id: 1, range: "90d", series: [] }),
}));
vi.mock("../../api/inventory", async (orig) => ({
  ...(await orig<typeof import("../../api/inventory")>()),
  adjustCard: vi.fn().mockResolvedValue({ variant_id: 1, quantity: 1 }),
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
const card = (id: number, num: string): InventoryCard => ({
  base_card_id: id,
  set_code: "SOR",
  base_card_number: num,
  name: "Card " + num,
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
  variants: [v(id * 10, "Standard", num)],
  inventory: {},
});
const CARDS = [card(1, "1"), card(2, "2")];
vi.mock("../vault/useVaultData", () => ({
  useVaultData: () => ({
    cards: CARDS,
    setOrder: { SOR: "2024-03-08" },
    setNameByCode: { SOR: "Spark of Rebellion" },
    isAuthenticated: true,
    loading: false,
    patchQuantity: () => {},
  }),
}));

import { capture } from "../../analytics/analytics";
import { CardDetail } from "./CardDetail";
import { publishNav, resetNavForTest, setOpenSource } from "./navList";

const spy = vi.mocked(capture);
const calls = (e: string) => spy.mock.calls.filter(([x]) => x === e).map(([, p]) => p);

describe("S2-11 card detail analytics", () => {
  beforeEach(() => {
    spy.mockClear();
    resetNavForTest();
    window.location.hash = "#/card/1";
  });
  afterEach(() => resetNavForTest());

  it("card_popup_opened carries how it was opened + set_code, once per card", async () => {
    publishNav({ ids: [1, 2], narrowed: false, scope: null, source: "gallery", finishes: [] });
    setOpenSource("gallery");
    const { rerender } = render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    await waitFor(() => expect(calls("card_popup_opened")).toHaveLength(1));
    rerender(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    expect(calls("card_popup_opened")).toEqual([
      { source: "gallery", set_code: "SOR", layout: "phone" },
    ]);
  });

  it("stepper taps report quantity_changed with surface detail", async () => {
    render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    await screen.findByText("No price data for this printing");
    fireEvent.click(screen.getByRole("button", { name: /^Increment/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Decrement/ }));
    expect(calls("quantity_changed")).toEqual([
      { direction: "increment", surface: "detail", layout: "phone" },
      { direction: "decrement", surface: "detail", layout: "phone" },
    ]);
  });

  it("price_history_opened on the first deliberate use of the chart, once", async () => {
    render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    await screen.findByText("No price data for this printing");
    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    await screen.findByText("No price data for this printing");
    fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    await screen.findByText("No price data for this printing");
    expect(calls("price_history_opened")).toEqual([{ layout: "phone" }]);
  });

  it("a chevron reports popup_card_navigated prev_next and hands source nav on", async () => {
    publishNav({ ids: [1, 2], narrowed: false, scope: null, source: "row", finishes: [] });
    const { unmount } = render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    });
    await waitFor(() => expect(calls("popup_card_navigated")).toHaveLength(1), { timeout: 2000 });
    expect(calls("popup_card_navigated")[0]).toEqual({ method: "prev_next", layout: "phone" });
    await waitFor(() => expect(window.location.hash).toBe("#/card/2"));
    unmount();
    spy.mockClear();
    render(<CardDetail id={2} params={{}} onRequestSignIn={() => {}} />);
    await waitFor(() =>
      expect(calls("card_popup_opened")).toEqual([
        { source: "nav", set_code: "SOR", layout: "phone" },
      ])
    );
  });
});
