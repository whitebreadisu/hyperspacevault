import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { resetMediaMatches, setMediaMatches } from "../test/setup";
import { PHONE_QUERY, useIsPhone } from "./useIsPhone";

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
vi.mock("../screens/cards/CardsPage", () => ({ CardsPage: () => <p>cards-stub</p> }));

describe("S1-01 phone gate", () => {
  afterEach(() => resetMediaMatches());

  it("hook flips on a dispatched media change", () => {
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
    act(() => setMediaMatches(PHONE_QUERY, true));
    expect(result.current).toBe(true);
    act(() => setMediaMatches(PHONE_QUERY, false));
    expect(result.current).toBe(false);
  });

  it("App renders .m-app when the query matches and the desktop tree when not", () => {
    setMediaMatches(PHONE_QUERY, true);
    const phone = render(<App />);
    expect(phone.container.querySelector(".m-app")).not.toBeNull();
    expect(phone.container.querySelector(".app-layout")).toBeNull();
    phone.unmount();

    setMediaMatches(PHONE_QUERY, false);
    const desktop = render(<App />);
    expect(desktop.container.querySelector(".app-layout")).not.toBeNull();
    expect(desktop.container.querySelector(".m-app")).toBeNull();
  });

  // BL-252 S6-01 (replaces S1 review F1's "keeps the desktop tree"): the
  // shared vault now has a phone layout, so a share path renders the phone
  // tree at phone width -- and still the desktop tree above it.
  it("S6-01: a /shared/<token> path renders the phone tree at phone width", () => {
    window.history.pushState({}, "", "/shared/abc");
    try {
      setMediaMatches(PHONE_QUERY, true);
      const r = render(<App />);
      expect(r.container.querySelector(".m-app")).not.toBeNull();
      expect(r.container.querySelector(".app-layout")).toBeNull();
      r.unmount();
      setMediaMatches(PHONE_QUERY, false);
      const d = render(<App />);
      expect(d.container.querySelector(".app-layout")).not.toBeNull();
      expect(d.container.querySelector(".m-app")).toBeNull();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
});
