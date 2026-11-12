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
  getSharedStash: vi.fn().mockResolvedValue({
    share_name: "Rowan",
    stash: { name: "Trade binder", description: null },
    rows: [],
    totals: { printings: 0, copies: 0, value_market: 0, value_low: 0 },
  }),
}));
vi.mock("../../screens/cards/CardsPage", () => ({ CardsPage: () => <p>cards-stub</p> }));

import App from "../../App";
import { capture } from "../../analytics/analytics";
import { getSharedStash, resolveShare, ShareResolveError } from "../../api/sharedView";
import { getBaseCardsList } from "../../api/baseCards";
import { getSets } from "../../api/sets";
import { resetMediaMatches, setMediaMatches } from "../../test/setup";
import { loadShareSession, saveShareSession } from "../../utils/shareSession";
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
  vi.mocked(getSharedStash).mockClear();
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

// BL-209 slice (c): a stash link on the phone -- its own route, the stash
// read only, the viewer panel; dead and rate-limited sentences; and the
// vault link stays stash-free.
describe("BL-209 stash links on the phone", () => {
  it("a stash link takes the stash read, keeps a stash session and shows the viewer panel", async () => {
    await bootShared("/shared/stash/stok-1");
    expect(getSharedStash).toHaveBeenCalledWith("stok-1");
    expect(resolveShare).not.toHaveBeenCalled();
    expect(loadShareSession()).toEqual({
      token: "stok-1",
      name: "Rowan · Trade binder",
      kind: "stash",
      // The share name alone rides along for the signed-out chip.
      shareName: "Rowan",
    });
    const pane = document.querySelector('.m-app__screen[data-pane="shared"]')!;
    expect(pane.querySelector(".m-stashpanel .m-summary__label")!.textContent).toBe(
      "Rowan's stash"
    );
    expect(pane.querySelector(".m-stashpanel__name")!.textContent).toBe("Trade binder");
    // No description: omitted, never "No description".
    expect(pane.querySelector(".m-stashpanel__desc")).toBeNull();
    expect(pane.textContent).toContain("Trade binder has no cards right now.");
    // Read-only: no pencil, trash or Return.
    expect(pane.querySelector(".m-stashctl__icon, .m-stashline__return")).toBeNull();
    // Signed out: the bar's amber chip carries the share name alone.
    expect(screen.getByRole("button", { name: "Rowan: switch vault" })).toBeTruthy();
  });

  it("a dead stash link is the one sentence (label type), no panel", async () => {
    vi.mocked(getSharedStash).mockRejectedValueOnce(new ShareResolveError("not_found", 404));
    await bootShared("/shared/stash/dead");
    const text = screen.getByText("This shared stash is no longer available.");
    expect(text.getAttribute("role")).toBe("alert");
    expect(text.classList.contains("m-shared-status__text--dead")).toBe(true);
    const pane = document.querySelector('.m-app__screen[data-pane="shared"]')!;
    expect(pane.querySelector(".m-summary")).toBeNull();
    // No name on a dead link: the bar's plain Vault tab, no switch.
    expect(document.querySelector(".m-vswitch")).toBeNull();
  });

  it("a rate-limited stash link says so", async () => {
    vi.mocked(getSharedStash).mockRejectedValueOnce(new ShareResolveError("rate_limited", 429));
    await bootShared("/shared/stash/busy");
    expect(
      screen.getByText(
        "This shared stash is getting a lot of traffic right now — please try again in a moment."
      )
    ).toBeTruthy();
  });

  it("the vault link's pane stays stash-free and never reads a stash", async () => {
    await bootShared();
    const pane = document.querySelector('.m-app__screen[data-pane="shared"]')!;
    expect(pane.textContent).not.toMatch(/stash/i);
    expect(pane.querySelector('[class*="stash"]')).toBeNull();
    expect(getSharedStash).not.toHaveBeenCalled();
  });

  it("a restored stash session: the stash read, the share name on the chip, the stash in its spoken name", async () => {
    saveShareSession({
      token: "stok-9",
      name: "Rowan · Spare box",
      kind: "stash",
      shareName: "Rowan",
    });
    vi.mocked(getSharedStash).mockResolvedValueOnce({
      share_name: "Rowan",
      stash: { name: "Spare box", description: null },
      rows: [],
      totals: { printings: 0, copies: 0, value_market: 0, value_low: 0 },
    });
    await bootShared("/");
    expect(getSharedStash).toHaveBeenCalledWith("stok-9");
    expect(resolveShare).not.toHaveBeenCalled();
    // Own vault shown; the switch expands to the stash, named as a stash.
    fireEvent.click(screen.getByRole("button", { name: "Vault: switch vault" }));
    const pick = screen.getByRole("button", { name: "Rowan's stash Spare box" });
    expect(pick.textContent).toBe("Rowan");
    fireEvent.click(pick);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Rowan: switch vault" }).textContent).toBe("Rowan");
  });

  it("a stored session with no kind is a vault link", async () => {
    window.sessionStorage.setItem(
      "swu.share.session",
      JSON.stringify({ token: "tok-old", name: "Rowan" })
    );
    await bootShared("/");
    expect(resolveShare).toHaveBeenCalledWith("tok-old");
    expect(getSharedStash).not.toHaveBeenCalled();
  });

  it("live: returning to the tab re-reads the same stash (rename), then a revocation kills it", async () => {
    let now = 5_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await bootShared("/shared/stash/stok-1");
      const pane = () => document.querySelector('.m-app__screen[data-pane="shared"]')!;
      expect(pane().querySelector(".m-stashpanel__name")!.textContent).toBe("Trade binder");
      vi.mocked(getSharedStash).mockResolvedValueOnce({
        share_name: "Rowan",
        stash: { name: "Trade box", description: "Renamed." },
        rows: [],
        totals: { printings: 0, copies: 0, value_market: 0, value_low: 0 },
      });
      now += 31_000;
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(getSharedStash).toHaveBeenLastCalledWith("stok-1");
      expect(pane().querySelector(".m-stashpanel__name")!.textContent).toBe("Trade box");
      expect(pane().querySelector(".m-stashpanel__desc")!.textContent).toBe("Renamed.");
      vi.mocked(getSharedStash).mockRejectedValueOnce(new ShareResolveError("not_found", 404));
      now += 31_000;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(screen.getByText("This shared stash is no longer available.")).toBeTruthy();
      expect(document.querySelector(".m-vswitch")).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});
