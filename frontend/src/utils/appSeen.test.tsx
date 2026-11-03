import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app writes the returning-visitor marker on every boot, on either tree
// (App Spec §5.3, §25.0); a storage failure never breaks the boot.

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
import { APP_SEEN_KEY, hasSeenApp, markAppSeen } from "./appSeen";

describe("app-seen marker", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRouterForTest();
  });
  afterEach(() => {
    resetMediaMatches();
    window.localStorage.clear();
  });

  it.each([
    ["desktop", false],
    ["phone", true],
  ])("the %s boot writes the marker", async (_, phone) => {
    if (phone) setMediaMatches(PHONE_QUERY, true);
    expect(window.localStorage.getItem(APP_SEEN_KEY)).toBeNull();
    const { container } = render(<App />);
    await act(async () => {});
    // The tree under test is the one that rendered.
    expect(!!container.querySelector(".m-app")).toBe(phone);
    expect(window.localStorage.getItem(APP_SEEN_KEY)).toBe("1");
  });

  it("a throwing storage is silent on write and reads as unseen", () => {
    const throwing = {
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError");
      }),
      getItem: vi.fn(() => {
        throw new Error("SecurityError");
      }),
    } as unknown as Storage;
    expect(() => markAppSeen(throwing)).not.toThrow();
    expect(hasSeenApp(throwing)).toBe(false);
    expect(hasSeenApp(null)).toBe(false);
  });

  it("only the exact marker value counts", () => {
    window.localStorage.setItem(APP_SEEN_KEY, "0");
    expect(hasSeenApp()).toBe(false);
    markAppSeen();
    expect(hasSeenApp()).toBe(true);
  });
});
