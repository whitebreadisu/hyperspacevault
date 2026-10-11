import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseCardCatalog } from "../../api/baseCards";
import { getQuantities } from "../../api/inventory";
import { useVaultDataSource } from "./useVaultData";

const CARD: BaseCardCatalog = {
  id: 7,
  set_code: "SOR",
  base_card_number: "87",
  name: "Darth Vader",
  subtitle: "Commanding the First Wave",
  type: "Unit",
  rarity: "Legendary",
  cost: 7,
  power: 5,
  hp: 8,
  arena: "Ground",
  is_token: false,
  aspects: ["Aggression", "Villainy"],
  keywords: [],
  traits: [],
  variants: [
    {
      variant_id: 101,
      variant_type: "Standard",
      finish: "Standard",
      channel: "Retail",
      source_set_code: "SOR",
      card_number: "87",
      front_image_url: null,
      back_image_url: null,
    },
    {
      variant_id: 102,
      variant_type: "Hyperspace",
      finish: "Hyperspace",
      channel: "Retail",
      source_set_code: "SOR",
      card_number: "339",
      front_image_url: null,
      back_image_url: null,
    },
  ],
} as BaseCardCatalog;

vi.mock("../../api/baseCards", () => ({
  getBaseCardsList: vi.fn(() => Promise.resolve([CARD])),
}));
vi.mock("../../api/sets", () => ({
  getSets: vi.fn(() =>
    Promise.resolve([
      {
        id: 1,
        code: "SOR",
        name: "Spark of Rebellion",
        is_base_set: true,
        release_date: "2024-03-08",
      },
    ])
  ),
}));
vi.mock("../../api/inventory", () => ({
  getQuantities: vi.fn(() => Promise.resolve([{ variant_id: 102, quantity: 2 }])),
}));

describe("S1-12 Vault data hook", () => {
  afterEach(() => vi.mocked(getQuantities).mockClear());

  it("anonymous: no quantities fetch, every quantity 0", async () => {
    const { result } = renderHook(() => useVaultDataSource(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.setNameByCode.SOR).toBe("Spark of Rebellion"));
    expect(getQuantities).not.toHaveBeenCalled();
    expect(result.current.cards).toHaveLength(1);
    expect(Object.values(result.current.cards[0].inventory)).toEqual([0, 0]);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("signed in: cards carry the caller's inventory", async () => {
    const { result } = renderHook(() => useVaultDataSource(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.cards[0]?.inventory[102]).toBe(2));
    expect(getQuantities).toHaveBeenCalledTimes(1);
    expect(result.current.cards[0].inventory[101]).toBe(0);
    expect(result.current.cards[0].variants.find((v) => v.variant_id === 102)?.quantity).toBe(2);
    expect(result.current.setOrder.SOR).toBe("2024-03-08");
  });
});
