import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A shared card link at boot (App Spec §5.3): `/?card=sor-005&v=<slug>&signup=1`
// opens the sign-in dialog in create-account mode and the card's popup on the
// printing the slug names; the link's printing applies to that first open
// only, so browsing away and back, or reopening under a Vault scope, follows
// the usual rules again.

vi.mock("../context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    loading: false,
    logout: vi.fn(),
    emailVerified: false,
    signupInFlight: false,
    googleLinkedInFlight: false,
  }),
}));
vi.mock("../api/settingsLimits", () => ({
  getLimits: vi.fn().mockResolvedValue([]),
  putLimits: vi.fn().mockResolvedValue([]),
}));

const variant = (variant_id: number, finish: string, card_number: string) => ({
  variant_id,
  variant_type: finish,
  finish,
  channel: "Retail",
  stamped: false,
  source_set_code: "SOR",
  source_set_name: "Spark of Rebellion",
  card_number,
  front_image_url: null,
  back_image_url: null,
  stamp_group: null,
  quantity: 0,
  price: null,
});
const card = (id: number, num: string, name: string, variants: ReturnType<typeof variant>[]) => ({
  id,
  set_code: "SOR",
  set_name: "Spark of Rebellion",
  base_card_number: num,
  name,
  subtitle: null,
  type: "Unit",
  type2: null,
  double_sided: false,
  rarity: "Common",
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
  variants,
});
const CARDS = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../api/baseCards", () => ({
  getBaseCardsList: vi.fn(async () => CARDS.list),
  getBaseCardDetail: vi.fn(async (id: number) =>
    (CARDS.list as { id: number }[]).find((c) => c.id === id)
  ),
  getPriceHistory: vi.fn(async () => ({ variant_id: 1, range: "90d", series: [] })),
}));
vi.mock("../api/sets", () => ({
  getSets: vi
    .fn()
    .mockResolvedValue([
      { code: "SOR", name: "Spark of Rebellion", is_base_set: true, release_date: "2024-03-08" },
    ]),
}));
vi.mock("../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));

import App from "../App";
import { resetRouterForTest } from "../mobile/router";

const activeRow = () =>
  document.querySelector(".cp-rail__item--active")?.getAttribute("data-variant-id");
const title = () => document.querySelector(".cp-title")?.textContent;

describe("card link boot: card + v + signup=1", () => {
  beforeEach(() => {
    resetRouterForTest();
    CARDS.list = [
      card(5, "5", "Link Card", [
        variant(70, "Standard", "5"),
        variant(71, "Hyperspace", "271"),
        variant(72, "Standard Foil", "5"),
      ]),
      card(6, "6", "Next Card", [variant(80, "Standard", "6")]),
    ];
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("opens Sign Up and the linked printing; prev / next back to the card opens its default", async () => {
    window.history.replaceState(null, "", "/?card=sor-005&v=standard-foil-sor-5&signup=1");
    render(<App />);
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Sign Up" })).toBeTruthy();
    await waitFor(() => expect(title()).toBe("Link Card"));
    expect(activeRow()).toBe("72");
    await waitFor(() => expect(window.location.search).toBe(""));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    });
    await waitFor(() => expect(title()).toBe("Next Card"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous card" }));
    });
    await waitFor(() => expect(title()).toBe("Link Card"));
    expect(activeRow()).toBe("70");
  });

  it("reopened under a Vault finish scope, the card follows the scope, not the link", async () => {
    window.history.replaceState(null, "", "/?card=sor-005&v=standard-foil-sor-5");
    render(<App />);
    await waitFor(() => expect(title()).toBe("Link Card"));
    expect(activeRow()).toBe("72");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByTitle("Scope pips + Value to a single variant"));
    const hsRow = [...document.querySelectorAll(".vs-scope-menu__row--chips")].find(
      (r) => r.querySelector(".vs-scope-menu__row-label")?.textContent === "Hyperspace"
    ) as HTMLElement;
    fireEvent.click(within(hsRow).getByText("Non-foil"));
    await act(async () => {
      fireEvent.click(screen.getByText("Link Card"));
    });
    await waitFor(() => expect(title()).toBe("Link Card"));
    expect(activeRow()).toBe("71");
  });
});
