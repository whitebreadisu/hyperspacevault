import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-252 stage 6a: the shared vault on the phone -- the gate no longer yields
// /shared/{token} to the desktop tree (S6-01), the bottom bar's Vault switch
// (S6-04) and the share analytics (S6-08).

vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../context/AuthContext", () => ({
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
vi.mock("../../api/settingsLimits", () => ({
  getLimits: vi.fn().mockResolvedValue({ cap_mode: "soft", limits: [] }),
  putLimits: vi.fn().mockResolvedValue({ cap_mode: "soft", limits: [] }),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sharedView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/sharedView")>()),
  resolveShare: vi.fn().mockResolvedValue({ name: "Rowan", scope: "inventory" }),
  getSharedQuantities: vi.fn().mockResolvedValue([]),
  getSharedLimits: vi.fn().mockResolvedValue({ cap_mode: "soft", limits: [] }),
}));
vi.mock("../../screens/cards/CardsPage", () => ({ CardsPage: () => <p>cards-stub</p> }));

import App from "../../App";
import { capture } from "../../analytics/analytics";
import { resolveShare } from "../../api/sharedView";
import { getBaseCardsList } from "../../api/baseCards";
import { getSets } from "../../api/sets";
import { resetMediaMatches, setMediaMatches } from "../../test/setup";
import { loadShareSession } from "../../utils/shareSession";
import { resetRouterForTest } from "../router";
import { PHONE_QUERY } from "../useIsPhone";
import { switchFace, switchStep } from "./vaultSwitch";

const spy = vi.mocked(capture);
const calls = (event: string) =>
  spy.mock.calls.filter(([e]) => e === event).map(([, props]) => props);

async function bootShared(path = "/shared/tok-1") {
  window.history.pushState({}, "", path + "#/vault");
  setMediaMatches(PHONE_QUERY, true);
  const r = render(<App />);
  await act(async () => {});
  await act(async () => {});
  return r;
}

beforeEach(() => {
  spy.mockClear();
  vi.mocked(resolveShare).mockClear();
  resetRouterForTest();
  window.sessionStorage.clear();
});
afterEach(() => {
  resetMediaMatches();
  window.history.pushState({}, "", "/");
});

// BL-253 S7-24 PORT (flag flipped in S7-09): the centre button's accessible
// name was "Keypad"; with the camera on it names both modes.
const TOOL_BUTTON = "Keypad or camera: opens the mode you used last";
describe("S6-01 share route renders the phone tree", () => {
  it("the gate no longer yields /shared/<token> to the desktop tree", async () => {
    const r = await bootShared();
    expect(r.container.querySelector(".m-app")).not.toBeNull();
    expect(r.container.querySelector(".app-layout")).toBeNull();
    expect(resolveShare).toHaveBeenCalledWith("tok-1");
  });

  it("a resolved token persists the tab's session and names the header + bar", async () => {
    await bootShared();
    expect(loadShareSession()).toEqual({ token: "tok-1", name: "Rowan" });
    expect(screen.getByText("Rowan's collection")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rowan: switch vault" })).toBeTruthy();
    // No keypad in a share; the bar is the switch + More.
    expect(screen.queryByRole("button", { name: TOOL_BUTTON })).toBeNull();
    expect(document.querySelector(".m-nav--shared")).not.toBeNull();
    // The hash router works beneath the pathname.
    expect(window.location.pathname).toBe("/shared/tok-1");
    expect(window.location.hash).toBe("#/vault");
  });

  it("a session from earlier in the tab comes back on another path, own vault shown", async () => {
    window.sessionStorage.setItem(
      "swu.share.session",
      JSON.stringify({ token: "tok-1", name: "Rowan" })
    );
    await bootShared("/");
    expect(document.querySelector(".m-nav--shared")).toBeNull();
    expect(screen.getByRole("button", { name: "Vault: switch vault" })).toBeTruthy();
    expect(screen.getByRole("button", { name: TOOL_BUTTON })).toBeTruthy();
  });
});

describe("S6-04 the Vault switch", () => {
  it("state machine: face expands / collapses, a pick collapses and selects", () => {
    const s0 = { expanded: false, shown: true };
    const open = switchStep(s0, { type: "face", hasName: true });
    expect(open).toEqual({ expanded: true, shown: true });
    expect(switchStep(open, { type: "face", hasName: true })).toEqual(s0);
    expect(switchStep(open, { type: "pick", shared: false })).toEqual({
      expanded: false,
      shown: false,
    });
    expect(switchStep({ expanded: true, shown: false }, { type: "pick", shared: true })).toEqual({
      expanded: false,
      shown: true,
    });
    expect(switchStep(open, { type: "dismiss" })).toEqual(s0);
    expect(switchStep(s0, { type: "dismiss" })).toBe(s0);
    // No name known yet (a fresh link resolving / invalid): the tab goes home.
    expect(switchStep(s0, { type: "face", hasName: false })).toEqual({
      expanded: false,
      shown: false,
    });
    expect(switchFace(false, true)).toBe("plain");
    expect(switchFace(true, true)).toBe("shared");
    expect(switchFace(true, false)).toBe("own");
  });

  it("in the app: expand, pick own vault (keypad back), expand, pick the share", async () => {
    await bootShared();
    fireEvent.click(screen.getByRole("button", { name: "Rowan: switch vault" }));
    const own = screen.getByRole("button", { name: "Your vault" });
    expect(screen.getByRole("button", { name: "Rowan's vault" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    fireEvent.click(own);
    await act(async () => {});
    expect(screen.queryByRole("group", { name: "Choose a vault" })).toBeNull();
    expect(screen.getByRole("button", { name: TOOL_BUTTON })).toBeTruthy();
    expect(document.querySelector('[data-pane="shared"]')?.className).toContain("--parked");
    fireEvent.click(screen.getByRole("button", { name: "Vault: switch vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Rowan's vault" }));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: TOOL_BUTTON })).toBeNull();
    expect(document.querySelector('[data-pane="own"]')?.className).toContain("--parked");
    expect(document.querySelector('[data-pane="shared"]')?.className).not.toContain("--parked");
  });
});

describe("S6-04 focus (F2)", () => {
  it("S6-F2: expand focuses the current choice; Escape and a pick return focus to the face", async () => {
    await bootShared();
    fireEvent.click(screen.getByRole("button", { name: "Rowan: switch vault" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rowan's vault" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {});
    expect(screen.queryByRole("group", { name: "Choose a vault" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rowan: switch vault" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Rowan: switch vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Your vault" }));
    await act(async () => {});
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Vault: switch vault" })
    );
    // Expanding from the own face focuses the pressed (own) choice.
    fireEvent.click(screen.getByRole("button", { name: "Vault: switch vault" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Your vault" }));
  });
});

describe("S6-01 ShareScope data (F5)", () => {
  it("S6-F5: an invalid token fetches no catalogue / sets for the share", async () => {
    vi.mocked(resolveShare).mockRejectedValueOnce(new Error("404"));
    vi.mocked(getBaseCardsList).mockClear();
    vi.mocked(getSets).mockClear();
    await bootShared("/shared/bad-tok");
    // Only the own vault's instance fetched (once each); the share's never mounted.
    expect(getBaseCardsList).toHaveBeenCalledTimes(1);
    expect(getSets).toHaveBeenCalledTimes(1);
    expect(screen.getByText("This shared vault is no longer available.")).toBeTruthy();
  });
});

describe("S6-08 share analytics (additive)", () => {
  it("share_link_viewed + screen_viewed shared_view, layout phone; own vault reports vault", async () => {
    await bootShared();
    expect(calls("share_link_viewed")).toEqual([{ layout: "phone" }]);
    expect(calls("screen_viewed")).toEqual([{ screen: "shared_view", layout: "phone" }]);
    fireEvent.click(screen.getByRole("button", { name: "Rowan: switch vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Your vault" }));
    await act(async () => {});
    expect(calls("screen_viewed")).toEqual([
      { screen: "shared_view", layout: "phone" },
      { screen: "vault", layout: "phone" },
    ]);
    expect(calls("share_link_viewed")).toHaveLength(1);
  });
});
