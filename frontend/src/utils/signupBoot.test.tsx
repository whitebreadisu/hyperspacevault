import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `signup=1` at boot (App Spec §5.3, §25.0): the public card page's "Create
// free account" lands on the app's sign-in dialog in create-account mode,
// beside the `?card=` card; the parameter leaves the address bar. Both trees.

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
vi.mock("../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));

import App from "../App";
import { resetMediaMatches, setMediaMatches } from "../test/setup";
import { resetRouterForTest } from "../mobile/router";
import { PHONE_QUERY } from "../mobile/useIsPhone";

const TREES = [
  ["desktop", false],
  ["phone", true],
] as const;

describe("signup=1 boot parameter", () => {
  beforeEach(() => {
    resetRouterForTest();
  });
  afterEach(() => {
    resetMediaMatches();
    window.history.replaceState(null, "", "/");
  });

  async function boot(url: string, phone: boolean) {
    if (phone) setMediaMatches(PHONE_QUERY, true);
    window.history.replaceState(null, "", url);
    render(<App />);
    await act(async () => {});
  }

  it.each(TREES)(
    "%s: with ?card= it opens the dialog in create-account mode and reads the card",
    async (_, phone) => {
      await boot("/?card=sor-005&signup=1", phone);
      expect(screen.getByRole("heading", { name: "Sign Up" })).toBeTruthy();
      // The card parameter was consumed by the card boot (unknown here, so
      // it is only dropped); signup is dropped by the auth boot.
      await waitFor(() => expect(window.location.search).toBe(""));
    }
  );

  it.each(TREES)("%s: signup=1 alone opens the dialog in create-account mode", async (_, phone) => {
    await boot("/?signup=1", phone);
    expect(screen.getByRole("heading", { name: "Sign Up" })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it.each(TREES)("%s: without it no dialog opens", async (_, phone) => {
    await boot("/?x=1", phone);
    expect(screen.queryByRole("heading", { name: "Sign Up" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Log In" })).toBeNull();
    expect(window.location.search).toBe("?x=1");
  });
});
