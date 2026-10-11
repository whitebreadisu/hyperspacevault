import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-248 S2 fix run F9: #/card/<non-numeric> is the card layer's not-found
// state, not a fall-through to the Vault under a card hash.
vi.mock("../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../analytics/analytics")>()),
  capture: vi.fn(),
}));
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
vi.mock("../api/baseCards", () => ({
  getBaseCardsList: vi.fn().mockResolvedValue([]),
  getBaseCardDetail: vi.fn().mockRejectedValue(new Error("404")),
}));
vi.mock("../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));

import App from "../App";
import { resetMediaMatches, setMediaMatches } from "../test/setup";
import { resetRouterForTest } from "./router";
import { PHONE_QUERY } from "./useIsPhone";

describe("F9 #/card/<non-numeric>", () => {
  beforeEach(() => {
    resetRouterForTest();
    setMediaMatches(PHONE_QUERY, true);
  });
  afterEach(() => resetMediaMatches());

  it("shows the detail's not-found state and keeps the hash", async () => {
    window.location.hash = "#/card/abc";
    const { container } = render(<App />);
    await act(async () => {});
    expect(container.querySelector(".m-cardlayer")).not.toBeNull();
    expect(container.textContent).toContain("This card is not in the catalogue.");
    expect(window.location.hash).toBe("#/card/abc");
  });
});
