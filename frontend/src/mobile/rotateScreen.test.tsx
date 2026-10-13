import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import * as analytics from "../analytics/analytics";
import { RotateScreen } from "./RotateScreen";
import {
  PHONE_QUERY,
  PHONE_SHORT_TOUCH_QUERY,
  screenIsLandscape,
  useIsPhone,
  usePhoneSideways,
} from "./useIsPhone";

// BL-257 FR5-06 (owner decision 2026-10-12, F-18): the phone gate's five
// cases, the screen-orientation helper, and the rotate screen over a phone
// app that stays mounted.

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
vi.mock("./vault/Vault", () => ({ Vault: () => <p>vault-stub</p> }));

/** A device as the media engine sees it. `touch` = a touch-first screen
 * (hover: none, pointer: coarse); otherwise a mouse (hover, fine). */
interface Device {
  w: number;
  h: number;
  touch: boolean;
  /** screen.orientation.type; undefined = the API is missing. */
  type?: string;
}

/** The subset of media-query syntax the gate uses: a comma list (OR) of
 * `(feature: value)` terms joined by `and`. An unknown feature is false. */
function evalQuery(query: string, d: Device): boolean {
  return query.split(",").some((part) => {
    const terms = [...part.matchAll(/\(([a-z-]+):\s*([^()]+)\)/g)];
    return (
      terms.length > 0 &&
      terms.every(([, name, value]) => {
        if (name === "max-width") return d.w <= parseFloat(value);
        if (name === "max-height") return d.h <= parseFloat(value);
        if (name === "hover") return value === (d.touch ? "none" : "hover");
        if (name === "pointer") return value === (d.touch ? "coarse" : "fine");
        return false;
      })
    );
  });
}

let device: Device = { w: 1440, h: 900, touch: false };
const listeners = new Map<string, Set<(e: MediaQueryListEvent) => void>>();
const realMatchMedia = window.matchMedia;
const realOrientation = Object.getOwnPropertyDescriptor(window.screen, "orientation");

function installDevice(d: Device): void {
  device = d;
  window.matchMedia = ((query: string) => {
    const set = listeners.get(query) ?? new Set();
    listeners.set(query, set);
    return {
      get matches() {
        return evalQuery(query, device);
      },
      media: query,
      addEventListener: (_t: string, l: (e: MediaQueryListEvent) => void) => set.add(l),
      removeEventListener: (_t: string, l: (e: MediaQueryListEvent) => void) => set.delete(l),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  Object.defineProperty(window.screen, "orientation", {
    configurable: true,
    get: () => (device.type === undefined ? undefined : { type: device.type }),
  });
}

/** The user turns / resizes the device: every listener hears about it. */
function turn(d: Device): void {
  device = d;
  listeners.forEach((set, query) =>
    set.forEach((l) => l({ matches: evalQuery(query, d), media: query } as MediaQueryListEvent))
  );
  window.dispatchEvent(new Event("resize"));
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
  listeners.clear();
  if (realOrientation) Object.defineProperty(window.screen, "orientation", realOrientation);
  else delete (window.screen as unknown as { orientation?: unknown }).orientation;
  document.body.querySelectorAll(".m-rotate").forEach((e) => e.remove());
});

const PHONE_UP: Device = { w: 402, h: 874, touch: true, type: "portrait-primary" };
const PHONE_SIDE: Device = { w: 874, h: 402, touch: true, type: "landscape-primary" };

describe("FR5-06 phone gate: the five cases", () => {
  const cases: [string, Device, "phone" | "desktop"][] = [
    ["phone portrait 402 x 874, touch", PHONE_UP, "phone"],
    ["phone landscape 874 x 402, touch", PHONE_SIDE, "phone"],
    ["small phone landscape 667 x 375, touch", { ...PHONE_SIDE, w: 667, h: 375 }, "phone"],
    [
      "desktop window resized short 1280 x 480, mouse",
      { w: 1280, h: 480, touch: false, type: "landscape-primary" },
      "desktop",
    ],
    [
      "tablet landscape 1024 x 768, touch",
      { w: 1024, h: 768, touch: true, type: "landscape-primary" },
      "desktop",
    ],
    [
      "tablet portrait 768 x 1024, touch",
      { w: 768, h: 1024, touch: true, type: "portrait-primary" },
      "desktop",
    ],
    [
      "768 wide and tall, mouse (the old boundary)",
      { w: 768, h: 900, touch: false, type: "landscape-primary" },
      "desktop",
    ],
    [
      "767 wide, mouse (the old boundary)",
      { w: 767, h: 900, touch: false, type: "landscape-primary" },
      "phone",
    ],
  ];

  it.each(cases)("%s -> %s", (_label, d, want) => {
    installDevice(d);
    expect(renderHook(() => useIsPhone()).result.current).toBe(want === "phone");
    const r = render(<App />);
    expect(r.container.querySelector(".m-app") !== null).toBe(want === "phone");
    expect(r.container.querySelector(".app-layout") !== null).toBe(want === "desktop");
    r.unmount();
  });

  it("the gate follows the device: a phone turned on its side stays the phone app", () => {
    installDevice(PHONE_UP);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
    act(() => turn(PHONE_SIDE));
    expect(result.current).toBe(true);
    act(() => turn({ w: 1280, h: 480, touch: false, type: "landscape-primary" }));
    expect(result.current).toBe(false);
  });

  it("the short-touch arm is the second half of the one gate query", () => {
    expect(PHONE_QUERY).toBe(`(max-width: 767px), (${PHONE_SHORT_TOUCH_QUERY})`);
  });
});

describe("FR5-06 screenIsLandscape: the screen, never the viewport", () => {
  const table: [string, Parameters<typeof screenIsLandscape>[0], boolean][] = [
    ["portrait-primary", { screen: { orientation: { type: "portrait-primary" } } }, false],
    ["portrait-secondary", { screen: { orientation: { type: "portrait-secondary" } } }, false],
    ["landscape-primary", { screen: { orientation: { type: "landscape-primary" } } }, true],
    ["landscape-secondary", { screen: { orientation: { type: "landscape-secondary" } } }, true],
    [
      "portrait with a keyboard-shrunk viewport (412 x 300) stays portrait",
      {
        innerWidth: 412,
        innerHeight: 300,
        screen: { orientation: { type: "portrait-primary" }, width: 412, height: 915 },
      } as Parameters<typeof screenIsLandscape>[0],
      false,
    ],
    [
      "the type wins over a stale legacy angle",
      { screen: { orientation: { type: "portrait-primary" } }, orientation: 90 },
      false,
    ],
    [
      "fallback: window.orientation 90",
      { screen: { width: 390, height: 844 }, orientation: 90 },
      true,
    ],
    ["fallback: window.orientation -90", { screen: {}, orientation: -90 }, true],
    [
      "fallback: window.orientation 0 (iOS keeps portrait screen sizes)",
      { screen: { width: 390, height: 844 }, orientation: 0 },
      false,
    ],
    ["fallback: window.orientation 180", { orientation: 180 }, false],
    ["last fallback: screen wider than tall", { screen: { width: 915, height: 412 } }, true],
    ["last fallback: screen taller than wide", { screen: { width: 412, height: 915 } }, false],
    ["nothing to read", {}, false],
    ["no window", null, false],
  ];
  it.each(table)("%s", (_label, win, want) => {
    expect(screenIsLandscape(win)).toBe(want);
  });
});

describe("FR5-06 usePhoneSideways", () => {
  const rows: [string, Device, boolean][] = [
    ["phone upright", PHONE_UP, false],
    ["phone on its side", PHONE_SIDE, true],
    [
      "phone upright, keyboard up (412 x 300 viewport, portrait screen)",
      { w: 412, h: 300, touch: true, type: "portrait-primary" },
      false,
    ],
    [
      "narrow desktop window on a landscape monitor, mouse",
      { w: 500, h: 900, touch: false, type: "landscape-primary" },
      false,
    ],
    [
      "short narrow desktop window, mouse",
      { w: 500, h: 400, touch: false, type: "landscape-primary" },
      false,
    ],
    [
      "tablet in a narrow split view, landscape screen",
      { w: 507, h: 768, touch: true, type: "landscape-primary" },
      false,
    ],
  ];
  it.each(rows)("%s -> %s", (_label, d, want) => {
    installDevice(d);
    expect(renderHook(() => usePhoneSideways()).result.current).toBe(want);
  });
});

function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" data-testid="count" onClick={() => setN(n + 1)}>
      {n}
    </button>
  );
}

describe("FR5-06 rotate screen", () => {
  it("covers the mounted app, makes it inert, and gives focus back upright", () => {
    installDevice(PHONE_UP);
    const captured = vi.spyOn(analytics, "capture");
    const r = render(
      <>
        <Counter />
        <RotateScreen />
      </>
    );
    const root = r.container;
    const btn = r.getByTestId("count");
    act(() => btn.click());
    btn.focus();
    expect(document.querySelector(".m-rotate")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);

    act(() => turn(PHONE_SIDE));
    const panel = document.querySelector(".m-rotate")!;
    expect(panel).not.toBeNull();
    expect(panel.parentElement).toBe(document.body);
    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.querySelector(".m-rotate__title")!.textContent).toBe("Turn your phone upright");
    expect(panel.querySelector(".m-rotate__sub")!.textContent).toBe(
      "Hyperspace Vault is built for portrait on phones."
    );
    expect(panel.querySelector("button, a, input")).toBeNull();
    // The app root is inert; the panel is not inside it.
    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.contains(panel)).toBe(false);
    // Still mounted, same node, same state.
    expect(r.getByTestId("count")).toBe(btn);
    expect(btn.textContent).toBe("1");

    btn.blur(); // what a browser does to focus inside an inert subtree
    act(() => turn(PHONE_UP));
    expect(document.querySelector(".m-rotate")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);
    expect(r.getByTestId("count")).toBe(btn);
    expect(btn.textContent).toBe("1");
    expect(document.activeElement).toBe(btn);
    // No new analytics event.
    expect(captured).not.toHaveBeenCalled();
    captured.mockRestore();
    r.unmount();
  });

  it("leaves an element that was already inert as it found it", () => {
    installDevice(PHONE_UP);
    const other = document.createElement("div");
    other.setAttribute("inert", "");
    document.body.append(other);
    const r = render(<RotateScreen />);
    act(() => turn(PHONE_SIDE));
    expect(r.container.hasAttribute("inert")).toBe(true);
    act(() => turn(PHONE_UP));
    expect(r.container.hasAttribute("inert")).toBe(false);
    expect(other.hasAttribute("inert")).toBe(true);
    other.remove();
    r.unmount();
  });

  it("the phone app mounts it: a phone on its side shows the panel over .m-app", () => {
    installDevice(PHONE_SIDE);
    const r = render(<App />);
    expect(r.container.querySelector(".m-app")).not.toBeNull();
    expect(document.querySelector(".m-rotate")).not.toBeNull();
    expect(r.container.hasAttribute("inert")).toBe(true);
    r.unmount();
    expect(document.querySelector(".m-rotate")).toBeNull();
  });
});
