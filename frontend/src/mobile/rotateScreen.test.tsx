import { readFileSync } from "node:fs";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import * as analytics from "../analytics/analytics";
import { RotateScreen } from "./RotateScreen";
import {
  isPhoneLayout,
  isPhoneSideways,
  PHONE_QUERY,
  PHONE_SHORT_SIDE_MAX,
  PHONE_TOUCH_QUERY,
  screenIsLandscape,
  useIsPhone,
  usePhoneSideways,
} from "./useIsPhone";

// BL-257 FR5-06 (owner decision 2026-10-12, F-18): the phone gate's cases, the
// screen-orientation helper, and the rotate screen over a phone app that
// stays mounted. Review FR5 fix run (S5 / N8): the gate's second arm is keyed
// to the DEVICE (touch-primary + screen short side <= 500 px), not to the
// viewport's height.

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

/** A device as the media engine sees it. `w` x `h` is the VIEWPORT; `touch` =
 * a touch-first screen (hover: none, pointer: coarse), otherwise a mouse
 * (hover, fine). */
interface Device {
  w: number;
  h: number;
  touch: boolean;
  /** screen.orientation.type; undefined = the API is missing. */
  type?: string;
  /** The SCREEN (screen.width x screen.height); the viewport's size when not
   * given. iOS keeps the portrait pair in either orientation. */
  sw?: number;
  sh?: number;
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
const realScreenW = Object.getOwnPropertyDescriptor(window.screen, "width");
const realScreenH = Object.getOwnPropertyDescriptor(window.screen, "height");

function installDevice(d: Device): void {
  Object.defineProperty(window.screen, "width", {
    configurable: true,
    get: () => device.sw ?? device.w,
  });
  Object.defineProperty(window.screen, "height", {
    configurable: true,
    get: () => device.sh ?? device.h,
  });
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
  for (const [k, real] of [
    ["width", realScreenW],
    ["height", realScreenH],
  ] as const) {
    if (real) Object.defineProperty(window.screen, k, real);
    else delete (window.screen as unknown as Record<string, unknown>)[k];
  }
  document.body.querySelectorAll(".m-rotate").forEach((e) => e.remove());
});

const PHONE_UP: Device = { w: 402, h: 874, touch: true, type: "portrait-primary" };
const PHONE_SIDE: Device = { w: 874, h: 402, touch: true, type: "landscape-primary" };
/** An iPhone on its side: the screen keeps its portrait pair (402 x 874). */
const IPHONE_SIDE: Device = { ...PHONE_SIDE, sw: 402, sh: 874 };
const TABLET_SIDE: Device = { w: 1024, h: 768, touch: true, type: "landscape-primary" };
/** Review FR5 S5: a landscape tablet whose on-screen keyboard has shrunk the
 * layout viewport to 1024 x 380. The screen is still 1024 x 768. */
const TABLET_KEYBOARD: Device = { ...TABLET_SIDE, h: 380, sw: 1024, sh: 768 };
const DESKTOP_SHORT: Device = { w: 1280, h: 480, touch: false, type: "landscape-primary" };

// PORT (review FR5 S5 / N8, fix run 2026-10-12): the five gate cases and the
// two boundary rows are unchanged in what they expect; each now also states a
// screen (the viewport's size unless given). The rows below "the old
// boundary" are new with the device-keyed arm.
describe("FR5-06 phone gate: the cases", () => {
  const cases: [string, Device, "phone" | "desktop", "panel" | "no panel"][] = [
    ["phone portrait 402 x 874, touch", PHONE_UP, "phone", "no panel"],
    ["phone landscape 874 x 402, touch", PHONE_SIDE, "phone", "panel"],
    ["iPhone landscape 874 x 402, screen 402 x 874, touch", IPHONE_SIDE, "phone", "panel"],
    ["small phone landscape 667 x 375, touch", { ...PHONE_SIDE, w: 667, h: 375 }, "phone", "panel"],
    ["desktop window resized short 1280 x 480, mouse", DESKTOP_SHORT, "desktop", "no panel"],
    ["tablet landscape 1024 x 768, touch", TABLET_SIDE, "desktop", "no panel"],
    [
      "tablet portrait 768 x 1024, touch",
      { w: 768, h: 1024, touch: true, type: "portrait-primary" },
      "desktop",
      "no panel",
    ],
    [
      "768 wide and tall, mouse (the old boundary)",
      { w: 768, h: 900, touch: false, type: "landscape-primary" },
      "desktop",
      "no panel",
    ],
    [
      "767 wide, mouse (the old boundary)",
      { w: 767, h: 900, touch: false, type: "landscape-primary" },
      "phone",
      "no panel",
    ],
    // ── the device-keyed arm ──
    [
      "tablet landscape, keyboard-shrunk viewport 1024 x 380, screen 1024 x 768, touch",
      TABLET_KEYBOARD,
      "desktop",
      "no panel",
    ],
    [
      "tablet portrait, keyboard-shrunk viewport 768 x 420, screen 768 x 1024, touch",
      { w: 768, h: 420, touch: true, type: "portrait-primary", sw: 768, sh: 1024 },
      "desktop",
      "no panel",
    ],
    ["large phone landscape 932 x 430, touch", { ...PHONE_SIDE, w: 932, h: 430 }, "phone", "panel"],
    ["large phone landscape 960 x 480, touch", { ...PHONE_SIDE, w: 960, h: 480 }, "phone", "panel"],
    [
      "phone upright, keyboard-shrunk viewport 390 x 300, screen 390 x 844, touch",
      { w: 390, h: 300, touch: true, type: "portrait-primary", sw: 390, sh: 844 },
      "phone",
      "no panel",
    ],
    [
      "short side exactly 500 (landscape 900 x 500, touch): a phone",
      { ...PHONE_SIDE, w: 900, h: 500 },
      "phone",
      "panel",
    ],
    [
      "short side 501 (landscape 900 x 501, touch): not a phone",
      { ...PHONE_SIDE, w: 900, h: 501 },
      "desktop",
      "no panel",
    ],
    [
      "small tablet / unfolded foldable landscape 960 x 600, touch",
      { ...PHONE_SIDE, w: 960, h: 600 },
      "desktop",
      "no panel",
    ],
    [
      "phone landscape with a mouse as its primary pointer 874 x 402",
      { ...PHONE_SIDE, touch: false },
      "desktop",
      "no panel",
    ],
    [
      "narrow phone landscape with a mouse as its primary pointer 667 x 375",
      { ...PHONE_SIDE, w: 667, h: 375, touch: false },
      "phone",
      "no panel",
    ],
  ];

  it.each(cases)("%s -> %s, %s", (_label, d, want, panel) => {
    installDevice(d);
    expect(isPhoneLayout()).toBe(want === "phone");
    expect(isPhoneSideways()).toBe(panel === "panel");
    expect(renderHook(() => useIsPhone()).result.current).toBe(want === "phone");
    expect(renderHook(() => usePhoneSideways()).result.current).toBe(panel === "panel");
    const r = render(<App />);
    expect(r.container.querySelector(".m-app") !== null).toBe(want === "phone");
    expect(r.container.querySelector(".app-layout") !== null).toBe(want === "desktop");
    expect(document.querySelector(".m-rotate") !== null).toBe(panel === "panel");
    r.unmount();
  });

  it("the gate follows the device: a phone turned on its side stays the phone app", () => {
    installDevice(PHONE_UP);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
    act(() => turn(PHONE_SIDE));
    expect(result.current).toBe(true);
    act(() => turn(DESKTOP_SHORT));
    expect(result.current).toBe(false);
  });

  // Review FR5 S5: the keyboard opening on a landscape tablet only resizes
  // the viewport -- the desktop tree must stay, with no rotate screen.
  it("a tablet's keyboard opening and closing never flips the layout", () => {
    installDevice(TABLET_SIDE);
    const gate = renderHook(() => useIsPhone());
    const side = renderHook(() => usePhoneSideways());
    expect([gate.result.current, side.result.current]).toEqual([false, false]);
    act(() => turn(TABLET_KEYBOARD));
    expect([gate.result.current, side.result.current]).toEqual([false, false]);
    act(() => turn(TABLET_SIDE));
    expect([gate.result.current, side.result.current]).toEqual([false, false]);
  });

  it("re-evaluates on resize, orientationchange and the screen-orientation change", () => {
    // No media-query `change` is dispatched here: only the named event.
    const so = new EventTarget();
    const fire: [string, () => void][] = [
      ["resize", () => window.dispatchEvent(new Event("resize"))],
      ["orientationchange", () => window.dispatchEvent(new Event("orientationchange"))],
      ["screen.orientation change", () => so.dispatchEvent(new Event("change"))],
    ];
    for (const [name, dispatch] of fire) {
      installDevice(TABLET_SIDE);
      Object.defineProperty(window.screen, "orientation", {
        configurable: true,
        get: () =>
          Object.assign(so, { type: device.type }) as unknown as typeof window.screen.orientation,
      });
      const gate = renderHook(() => useIsPhone());
      const side = renderHook(() => usePhoneSideways());
      expect([gate.result.current, side.result.current], name).toEqual([false, false]);
      device = PHONE_SIDE;
      act(dispatch);
      expect([gate.result.current, side.result.current], name).toEqual([true, true]);
      gate.unmount();
      side.unmount();
    }
  });

  it("the gate's parts: the width query, the touch query and the short side", () => {
    expect(PHONE_QUERY).toBe("(max-width: 767px)");
    expect(PHONE_TOUCH_QUERY).toBe("(hover: none) and (pointer: coarse)");
    expect(PHONE_SHORT_SIDE_MAX).toBe(500);
    // Nothing in the gate reads the viewport's height.
    const src = readFileSync("src/mobile/useIsPhone.ts", "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/.*/g,
      ""
    );
    expect(src).not.toMatch(/max-height|innerHeight|innerWidth|visualViewport/);
  });

  it("an unknown screen size is not a phone by the device arm (no window, no sizes, zero)", () => {
    const touch = { matchMedia: (q: string) => ({ matches: q === PHONE_TOUCH_QUERY }) };
    expect(isPhoneLayout(null)).toBe(false);
    expect(isPhoneLayout({ ...touch })).toBe(false);
    expect(isPhoneLayout({ ...touch, screen: { width: 0, height: 0 } })).toBe(false);
    expect(isPhoneLayout({ ...touch, screen: { width: 402, height: 874 } })).toBe(true);
    expect(isPhoneLayout({ ...touch, screen: { width: 874, height: 402 } })).toBe(true);
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
    // PORT (review FR5 S5): same case, with the tablet's screen stated -- the
    // arm now reads the screen's short side, not the viewport's height.
    [
      "tablet in a narrow split view, landscape screen",
      { w: 507, h: 768, touch: true, type: "landscape-primary", sw: 1024, sh: 768 },
      false,
    ],
    ["tablet landscape, keyboard-shrunk viewport (1024 x 380)", TABLET_KEYBOARD, false],
    ["iPhone on its side (screen sizes not swapped)", IPHONE_SIDE, true],
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

  // Review FR5 N1: a busy overlay is portalled to <body> after the panel is up.
  it("a <body> child added while on its side becomes inert; all inert is removed upright", async () => {
    installDevice(PHONE_UP);
    const r = render(<RotateScreen />);
    act(() => turn(PHONE_SIDE));
    const panel = document.querySelector(".m-rotate")!;
    const late = document.createElement("div");
    const lateInert = document.createElement("div");
    lateInert.setAttribute("inert", "");
    await act(async () => {
      document.body.append(late, lateInert);
      await Promise.resolve(); // the observer's callback is a microtask
    });
    expect(late.hasAttribute("inert")).toBe(true);
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(r.container.hasAttribute("inert")).toBe(true);
    act(() => turn(PHONE_UP));
    expect(document.querySelector(".m-rotate")).toBeNull();
    expect(late.hasAttribute("inert")).toBe(false);
    expect(r.container.hasAttribute("inert")).toBe(false);
    // One that arrived already inert is left as it came.
    expect(lateInert.hasAttribute("inert")).toBe(true);
    // The observer is gone: a child added upright is untouched.
    const after = document.createElement("div");
    await act(async () => {
      document.body.append(after);
      await Promise.resolve();
    });
    expect(after.hasAttribute("inert")).toBe(false);
    expect(document.querySelectorAll("body > [inert]")).toHaveLength(1);
    for (const el of [late, lateInert, after]) el.remove();
    r.unmount();
  });

  // Review FR5 N5 (+ N1): unmounted while on its side.
  it("unmounting while on its side removes every inert it set and stops watching", async () => {
    installDevice(PHONE_SIDE);
    const sibling = document.createElement("div");
    document.body.append(sibling);
    const r = render(<RotateScreen />);
    const late = document.createElement("div");
    await act(async () => {
      document.body.append(late);
      await Promise.resolve();
    });
    expect(document.querySelector(".m-rotate")).not.toBeNull();
    expect(sibling.hasAttribute("inert")).toBe(true);
    expect(late.hasAttribute("inert")).toBe(true);
    expect(r.container.hasAttribute("inert")).toBe(true);
    r.unmount();
    expect(document.querySelector(".m-rotate")).toBeNull();
    expect(sibling.hasAttribute("inert")).toBe(false);
    expect(late.hasAttribute("inert")).toBe(false);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    const after = document.createElement("div");
    await act(async () => {
      document.body.append(after);
      await Promise.resolve();
    });
    expect(after.hasAttribute("inert")).toBe(false);
    for (const el of [sibling, late, after]) el.remove();
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
