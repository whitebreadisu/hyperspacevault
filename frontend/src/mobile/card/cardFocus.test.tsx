import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryCard } from "../../utils/inventory";

// BL-248 S2 fix run F4: focus management on the card layer.
vi.mock("../../api/baseCards", () => ({
  getBaseCardDetail: vi.fn().mockResolvedValue(null),
  getBaseCardsList: vi.fn().mockResolvedValue([]),
  getPriceHistory: vi.fn().mockResolvedValue({ series: [] }),
}));
const CARDS: InventoryCard[] = [];
vi.mock("../vault/useVaultData", () => ({
  useVaultData: () => ({
    cards: CARDS,
    setOrder: {},
    setNameByCode: {},
    isAuthenticated: false,
    loading: false,
    patchQuantity: () => {},
  }),
}));

import { CardDetail } from "./CardDetail";
import { resetNavForTest, setOpener } from "./navList";

describe("F4 focus management on the card layer", () => {
  beforeEach(() => resetNavForTest());
  afterEach(() => resetNavForTest());

  it("focuses the close control on open and returns focus to the opener on close", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    setOpener(opener);
    const { unmount } = render(<CardDetail id={1} params={{}} onRequestSignIn={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close card" }));
    await act(async () => {});
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
