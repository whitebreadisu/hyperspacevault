import { act, render } from "@testing-library/react";
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
import { toolAddCardsAbandoned, toolAddCardsCommitted } from "./toolAnalytics";
import {
  getToolState,
  openTool,
  padKey,
  resetToolForTest,
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

  it("with the camera flag off the camera mode is never remembered", () => {
    expect(getToolState().mode).toBe("keypad");
    setToolMode("camera");
    expect(getToolState().mode).toBe("keypad");
    expect(toolRouteFor("camera")).toBe("#/pad");
    openTool();
    expect(window.location.hash).toBe("#/pad");
  });

  it("#/camera opens the keypad layer while the flag is off", async () => {
    window.location.hash = "#/camera";
    const { container } = render(<App />);
    await act(async () => {});
    expect(container.querySelector(".m-tool .m-pad")).not.toBeNull();
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
