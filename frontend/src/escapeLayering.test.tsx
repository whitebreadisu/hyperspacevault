import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCardDetail } from "./api/baseCards";

// Escape goes to the dialog on top (App Spec §5.3 `signup=1`): booting with
// `/?card=sor-012&signup=1` opens the card popup and the sign-in dialog over
// it; one Escape closes only the dialog, the next closes the card. While the
// dialog is open the popup's arrow keys stand down too.

const detail: BaseCardDetail = {
  id: 1,
  set_code: "SOR",
  set_name: "Spark of Rebellion",
  base_card_number: "12",
  name: "IG-88",
  subtitle: "Cold-Blooded Killer",
  type: "Unit",
  type2: null,
  double_sided: false,
  rarity: "R",
  cost: 3,
  power: 4,
  hp: 4,
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
  variants: [
    {
      variant_id: 1,
      variant_type: "Standard",
      finish: "Standard",
      channel: "Retail",
      stamped: false,
      source_set_code: "SOR",
      source_set_name: "Spark of Rebellion",
      card_number: "12",
      front_image_url: "https://example.test/front-1.png",
      back_image_url: null,
      stamp_group: null,
      quantity: 0,
    },
  ],
};

vi.mock("./context/AuthContext", () => ({
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
vi.mock("./api/settingsLimits", () => ({
  getLimits: vi.fn().mockResolvedValue([]),
  putLimits: vi.fn().mockResolvedValue([]),
}));
vi.mock("./api/baseCards", () => ({
  getBaseCardsList: vi.fn(async () => [detail]),
  getBaseCardDetail: vi.fn(async () => detail),
  getPriceHistory: vi.fn(async () => ({ variant_id: 1, range: "90d", series: [] })),
}));
vi.mock("./api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("./api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));

import App from "./App";
import { resetMediaMatches, setMediaMatches } from "./test/setup";
import { resetRouterForTest } from "./mobile/router";
import { PHONE_QUERY } from "./mobile/useIsPhone";

const signUp = () => screen.queryByRole("heading", { name: "Sign Up" });
const popup = () => document.querySelector(".cp-overlay");

describe("Escape with the sign-in dialog over the card popup (desktop)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/?card=sor-012&signup=1");
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("the first Escape closes only the dialog, the second closes the card", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".cp-title")?.textContent).toBe("IG-88"));
    expect(signUp()).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(signUp()).toBeNull();
    expect(popup()).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(popup()).toBeNull();
  });
});

describe("Escape with the auth layer over the card detail (phone)", () => {
  beforeEach(() => {
    resetRouterForTest();
    setMediaMatches(PHONE_QUERY, true);
    window.history.replaceState(null, "", "/?card=sor-012&signup=1");
  });
  afterEach(() => {
    resetMediaMatches();
    window.history.replaceState(null, "", "/");
  });

  it("Escape closes only the auth layer; the card detail has no Escape of its own", async () => {
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/card/1"));
    expect(signUp()).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(signUp()).toBeNull();
    expect(window.location.hash).toBe("#/card/1");
  });
});
