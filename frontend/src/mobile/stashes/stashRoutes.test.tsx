import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The phone Stashes routes' guards (MobileApp): #/stashes and #/stashes/<id>
// exist signed in on the own vault only. With the shared vault shown, or
// signed out, they land on #/vault and nothing of the stashes is fetched.
// Both layouts report the page as screen_viewed {screen: "stashes"}.

const auth = vi.hoisted(() => ({ user: null as null | { email: string } }));
vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: auth.user,
    loading: false,
    logout: vi.fn(),
    emailVerified: true,
    signupInFlight: false,
    googleLinkedInFlight: false,
  }),
}));
vi.mock("../../api/settingsLimits", () => ({
  getLimits: vi.fn().mockResolvedValue({ cap_mode: "soft", limits: [] }),
  putLimits: vi.fn().mockResolvedValue({ cap_mode: "soft", limits: [] }),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/inventory")>()),
  getQuantities: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../api/sharedView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/sharedView")>()),
  resolveShare: vi.fn().mockResolvedValue({ name: "Rowan", scope: "inventory" }),
  getSharedQuantities: vi.fn().mockResolvedValue([]),
  getSharedLimits: vi.fn().mockResolvedValue({ cap_mode: "soft", limits: [] }),
}));
const api = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
}));
vi.mock("../../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../../api/stashes")>()),
  ...api,
}));

import App from "../../App";
import { capture } from "../../analytics/analytics";
import { resetMediaMatches, setMediaMatches } from "../../test/setup";
import { resetRouterForTest } from "../router";
import { PHONE_QUERY } from "../useIsPhone";

async function boot(path: string, hash: string) {
  window.history.pushState({}, "", path + hash);
  setMediaMatches(PHONE_QUERY, true);
  const r = render(<App />);
  await act(async () => {});
  await act(async () => {});
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getStashes.mockResolvedValue([
    { id: 1, name: "Red binder", description: null, created_at: "1", copies: 0 },
  ]);
  api.getStashItems.mockResolvedValue([]);
  resetRouterForTest();
  window.sessionStorage.clear();
});
afterEach(() => {
  resetMediaMatches();
  window.history.pushState({}, "", "/");
  auth.user = null;
});

describe("phone Stashes routes", () => {
  it("signed in on the own vault: #/stashes/<id> shows the stash", async () => {
    auth.user = { email: "a@b.com" };
    const r = await boot("/", "#/stashes/1");
    expect(window.location.hash).toBe("#/stashes/1");
    expect(r.container.querySelector(".m-stashscreen")).not.toBeNull();
    const screens = vi
      .mocked(capture)
      .mock.calls.filter(([e]) => e === "screen_viewed")
      .map(([, p]) => (p as { screen: string }).screen);
    expect(screens).toEqual(["stashes"]);
  });

  it("with the shared vault shown, #/stashes/<id> lands on #/vault, no stash names", async () => {
    auth.user = { email: "a@b.com" };
    const r = await boot("/shared/tok-1", "#/stashes/1");
    expect(window.location.hash).toBe("#/vault");
    expect(r.container.querySelector(".m-stashscreen, .m-stashes")).toBeNull();
    expect(r.container.textContent).not.toContain("Red binder");
  });

  it("signed out, #/stashes lands on #/vault and nothing is fetched", async () => {
    const r = await boot("/", "#/stashes");
    expect(window.location.hash).toBe("#/vault");
    expect(r.container.querySelector(".m-stashes")).toBeNull();
    expect(api.getStashes).not.toHaveBeenCalled();
  });
});

describe("desktop Stashes page analytics", () => {
  it("reports screen_viewed stashes when the pod's Stashes item opens it", async () => {
    auth.user = { email: "a@b.com" };
    window.history.pushState({}, "", "/");
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Stashes" }));
    await act(async () => {});
    const screens = vi
      .mocked(capture)
      .mock.calls.filter(([e]) => e === "screen_viewed")
      .map(([, p]) => (p as { screen: string }).screen);
    expect(screens).toEqual(["vault", "stashes"]);
  });
});
