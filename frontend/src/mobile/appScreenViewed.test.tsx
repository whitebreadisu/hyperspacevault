import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-247 review F2: at the phone query App's BL-235 screen_viewed effect must
// stay silent -- MobileApp's router is the single source on the phone.
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
vi.mock("../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));

import App from "../App";
import { capture } from "../analytics/analytics";
import { resetMediaMatches, setMediaMatches } from "../test/setup";
import { resetRouterForTest } from "./router";
import { PHONE_QUERY } from "./useIsPhone";

const spy = vi.mocked(capture);

describe("F2 single screen_viewed on phone boot", () => {
  beforeEach(() => {
    spy.mockClear();
    resetRouterForTest();
    window.location.hash = "#/vault";
  });
  afterEach(() => resetMediaMatches());

  it("captures exactly one screen_viewed", async () => {
    setMediaMatches(PHONE_QUERY, true);
    render(<App />);
    await act(async () => {});
    expect(spy.mock.calls.filter(([e]) => e === "screen_viewed")).toHaveLength(1);
  });
});
