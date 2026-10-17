import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-249 S3-01 / S3-07: the tool layer route + mode memory, and the tool's
// analytics (desktop's add_cards_* shapes + layout: "phone").
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
  getLimits: vi.fn().mockResolvedValue([]),
  putLimits: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../api/baseCards", () => ({
  getBaseCardsList: vi.fn().mockResolvedValue([]),
  getBaseCardDetail: vi.fn().mockRejectedValue(new Error("404")),
}));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));

import App from "../../App";
import { capture } from "../../analytics/analytics";
import { resetMediaMatches, setMediaMatches } from "../../test/setup";
import { resetRouterForTest } from "../router";
import { PHONE_QUERY } from "../useIsPhone";
import { setNavForTest } from "./cameraHop";
import { toolAddCardsAbandoned, toolAddCardsCommitted, toolKeypadToggled } from "./toolAnalytics";
import {
  getToolState,
  openTool,
  padKey,
  resetToolForTest,
  setPadCompact,
  setToolMode,
  toolRouteFor,
} from "./toolStore";

const spy = vi.mocked(capture);
const calls = (event: string) => spy.mock.calls.filter(([e]) => e === event).map(([, p]) => p);

describe("S3-01 tool layer route + mode memory", () => {
  beforeEach(() => {
    resetRouterForTest();
    resetToolForTest();
    setMediaMatches(PHONE_QUERY, true);
    spy.mockClear();
  });
  afterEach(() => resetMediaMatches());

  it("#/pad is a layer over the Vault, which stays mounted; the bar is inert", async () => {
    window.location.hash = "#/pad";
    const { container } = render(<App />);
    await act(async () => {});
    expect(container.querySelector(".m-tool .m-pad")).not.toBeNull();
    expect(container.querySelector(".m-vault")).not.toBeNull();
    expect(container.querySelector(".m-app__screen")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".m-app__nav")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".m-soon")).toBeNull();
    expect(container.querySelector('.m-tool__head [aria-label="Close keypad"]')).not.toBeNull();
  });

  // BL-253 S7-24 REPLACE (flag flipped in S7-09): was "with the camera flag
  // off the camera mode is never remembered" -- now it is, and the bar opens
  // it by the hop to the isolated /scan/ document.
  it("the camera mode is remembered and the bar opens it by the /scan/ hop", () => {
    const nav = { assign: vi.fn(), replace: vi.fn(), historyBack: vi.fn() };
    setNavForTest(nav);
    expect(getToolState().mode).toBe("keypad");
    setToolMode("camera");
    expect(getToolState().mode).toBe("camera");
    expect(toolRouteFor("camera")).toBe("#/camera");
    openTool();
    expect(nav.assign).toHaveBeenCalledWith("/scan/#/camera");
    setNavForTest(null);
  });

  // BL-253 S7-24 REPLACE: was "#/camera opens the keypad layer while the flag
  // is off" -- on the main document #/camera is the hop (no camera here).
  it("#/camera on the main document hops to /scan/ (no keypad, no camera here)", async () => {
    const nav = { assign: vi.fn(), replace: vi.fn(), historyBack: vi.fn() };
    setNavForTest(nav);
    window.location.hash = "#/camera";
    const { container } = render(<App />);
    await act(async () => {});
    expect(nav.replace).toHaveBeenCalledWith("/scan/#/camera");
    expect(container.querySelector(".m-tool .m-pad")).toBeNull();
    setNavForTest(null);
  });

  it("the keypad state survives the layer closing", async () => {
    window.location.hash = "#/pad";
    const { container, unmount } = render(<App />);
    await act(async () => {});
    act(() => {
      padKey("8");
      padKey("7");
    });
    expect(container.querySelector(".m-padnum__val")?.textContent).toBe("87");
    unmount();
    expect(getToolState().num).toBe("87");
    act(() => {
      padKey("0");
      padKey("1");
      padKey("2");
    });
    expect(getToolState().num).toBe("8701");
  });
});

describe("S3-07 tool analytics (additive, layout: phone)", () => {
  beforeEach(() => {
    resetRouterForTest();
    resetToolForTest();
    setMediaMatches(PHONE_QUERY, true);
    spy.mockClear();
  });
  afterEach(() => resetMediaMatches());

  it("screen_viewed {screen: tool} once per open", async () => {
    window.location.hash = "#/pad";
    render(<App />);
    await act(async () => {});
    expect(calls("screen_viewed").filter((p) => p?.screen === "tool")).toEqual([
      { screen: "tool", layout: "phone" },
    ]);
  });

  it("add_cards_committed / add_cards_abandoned carry desktop's shapes + layout", () => {
    toolAddCardsCommitted("keypad", 5, 3);
    toolAddCardsCommitted("precon", 50, 30);
    toolAddCardsAbandoned(4);
    expect(calls("add_cards_committed")).toEqual([
      { method: "keypad", cards_added: 5, distinct_cards: 3, layout: "phone" },
      { method: "precon", cards_added: 50, distinct_cards: 30, layout: "phone" },
    ]);
    expect(calls("add_cards_abandoned")).toEqual([{ pending_entries: 4, layout: "phone" }]);
  });
});

describe("S3-16 add_cards_abandoned from the close guard (desktop shape + layout phone)", () => {
  beforeEach(() => {
    resetRouterForTest();
    resetToolForTest();
    setMediaMatches(PHONE_QUERY, true);
    spy.mockClear();
  });
  afterEach(() => resetMediaMatches());

  it("X with copies waiting -> Discard & Close sends pending_entries = copies; Return sends nothing", async () => {
    const { addCopy, getBatch } = await import("./batch");
    const row = {
      via: "keypad" as const,
      force: false,
      setCode: "SOR",
      cardNumber: "87",
      picks: { cardKey: null, setKey: null, stamp: null, finish: null },
      variantId: 7221,
      baseCardId: 814,
    };
    addCopy(row);
    addCopy(row);
    addCopy(row);
    window.location.hash = "#/pad";
    const { container } = render(<App />);
    await act(async () => {});
    const x = container.querySelector<HTMLButtonElement>(
      '.m-tool__head [aria-label="Close keypad"]'
    )!;
    const btn = (t: string) =>
      [...container.querySelectorAll<HTMLButtonElement>(".m-d2-confirm .swu-btn")].find(
        (b) => b.textContent?.trim() === t
      )!;
    await act(async () => x.click());
    expect(container.querySelector(".m-d2-confirm-layer")).not.toBeNull();
    await act(async () => btn("Return to Batch").click());
    expect(container.querySelector(".m-d2-confirm-layer")).toBeNull();
    expect(calls("add_cards_abandoned")).toEqual([]);
    await act(async () => x.click());
    await act(async () => btn("Discard & Close").click());
    expect(calls("add_cards_abandoned")).toEqual([{ pending_entries: 3, layout: "phone" }]);
    expect(getBatch()).toHaveLength(0);
  });
});

describe("S3 F2 / F3 tool layer focus + Escape", () => {
  beforeEach(() => {
    resetRouterForTest();
    resetToolForTest();
    setMediaMatches(PHONE_QUERY, true);
    spy.mockClear();
  });
  afterEach(() => resetMediaMatches());

  it("F2: focus moves to the close control on open", async () => {
    window.location.hash = "#/pad";
    const { container } = render(<App />);
    await act(async () => {});
    expect(document.activeElement).toBe(container.querySelector(".m-tool__close"));
  });

  it("F3: Escape (no sheet open) asks the guard when a batch exists, like the X", async () => {
    const { addCopy } = await import("./batch");
    addCopy({
      via: "keypad",
      force: false,
      setCode: "SOR",
      cardNumber: "87",
      picks: { cardKey: null, setKey: null, stamp: null, finish: null },
      variantId: 7221,
      baseCardId: 814,
    });
    window.location.hash = "#/pad";
    const { container } = render(<App />);
    await act(async () => {});
    expect(container.querySelector(".m-d2-confirm-layer")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector(".m-d2-confirm-layer")).not.toBeNull();
  });
});

describe("BL-270 keypad fold tab (user-chosen deck size)", () => {
  beforeEach(() => {
    resetRouterForTest();
    resetToolForTest();
    setMediaMatches(PHONE_QUERY, true);
    spy.mockClear();
  });
  afterEach(() => resetMediaMatches());

  it("the compact choice sticks across keys and clears; it is never persisted", () => {
    expect(getToolState().padCompact).toBe(false);
    setPadCompact(true);
    padKey("8");
    padKey("7");
    padKey("clr");
    expect(getToolState().padCompact).toBe(true);
    // Not mirrored to storage: a fresh load starts at full size.
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toMatch(/padCompact/);
    resetToolForTest();
    expect(getToolState().padCompact).toBe(false);
  });

  it("pad_keypad_toggled carries the state after the tap + layout", () => {
    toolKeypadToggled("compact");
    toolKeypadToggled("full");
    expect(calls("pad_keypad_toggled")).toEqual([
      { state: "compact", layout: "phone" },
      { state: "full", layout: "phone" },
    ]);
  });

  it("no tab while the zone fits; while shrunk the tab shows and restores the deck", async () => {
    window.location.hash = "#/pad";
    render(<App />);
    await act(async () => {});
    // jsdom has no layout, so the zone always fits: no tab at full size.
    expect(screen.queryByRole("button", { name: "Shrink keypad" })).toBeNull();
    expect(document.querySelector(".m-pad--compact")).toBeNull();
    await act(async () => setPadCompact(true));
    expect(document.querySelector(".m-pad--compact")).not.toBeNull();
    const tab = screen.getByRole("button", { name: "Restore keypad" });
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    await act(async () => fireEvent.click(tab));
    expect(getToolState().padCompact).toBe(false);
    expect(document.querySelector(".m-pad--compact")).toBeNull();
    expect(calls("pad_keypad_toggled")).toEqual([{ state: "full", layout: "phone" }]);
    // Back at full size with content that fits, the tab is gone again.
    expect(screen.queryByRole("button", { name: "Shrink keypad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore keypad" })).toBeNull();
  });
});
