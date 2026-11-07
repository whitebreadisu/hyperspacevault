import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, useCollapse } from "./useCollapse";

// The collapse-side hitch (App Spec §25.1 Collapse). The gesture that collapses ends there: the
// list is held at the collapsing travel's anchor (its top) until the next
// touchstart, a fresh wheel gesture, expand(), unmount or the HOLD_MS fallback.
// jsdom does not scroll, so the stub element carries its own scrollTop /
// scrollHeight / clientHeight and each test fires the scroll events a browser
// would.

function stubScroller(height = 4000, client = 600) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: height });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: client });
  return el;
}

/** The browser's scroll: move, then the scroll event. */
function scrollTo(el: HTMLElement, y: number) {
  act(() => {
    el.scrollTop = y;
    fireEvent.scroll(el);
  });
}

const touch = (y: number) => ({ touches: [{ clientX: 100, clientY: y }] });
const down = (el: HTMLElement, y = 400) => act(() => void fireEvent.touchStart(el, touch(y)));
const move = (el: HTMLElement, y: number) => act(() => void fireEvent.touchMove(el, touch(y)));
const up = (el: HTMLElement) => act(() => void fireEvent.touchEnd(el, { touches: [] }));
const wheel = (el: HTMLElement, deltaY: number) => act(() => void fireEvent.wheel(el, { deltaY }));
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function mount(el: HTMLElement, forced = false) {
  const h = renderHook(() => useCollapse(forced));
  act(() => h.result.current.scrollEl(el));
  return h;
}

/** A finger drag (still down) that travels past the 28 px. */
function dragCollapse(el: HTMLElement) {
  down(el);
  for (const y of [10, 20, 40]) scrollTo(el, y);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useCollapse hold", () => {
  it("a finger drag that collapses holds the list and snaps it to its top", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    expect(h.result.current.collapsed).toBe(true);
    expect(el.scrollTop).toBe(0);
    expect(el.style.overflowY).toBe("hidden");
  });

  it("scroll events during the hold (the drag, its momentum) are put back to 0", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    scrollTo(el, 90);
    expect(el.scrollTop).toBe(0);
    up(el);
    for (const y of [140, 260, 380]) {
      advance(16);
      scrollTo(el, y);
      expect(el.scrollTop).toBe(0);
    }
    expect(el.style.overflowY).toBe("hidden");
  });

  it("the next touchstart releases; that touch scrolls and does not re-hold", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    up(el);
    advance(100);
    down(el);
    expect(el.style.overflowY).toBe("");
    scrollTo(el, 300);
    expect(el.scrollTop).toBe(300);
    expect(h.result.current.collapsed).toBe(true);
  });

  it("the release touch starts at the top while collapsed, so a pull from there still expands", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    up(el);
    advance(100);
    down(el, 300);
    move(el, 300 + 40);
    expect(h.result.current.pull).toBeGreaterThan(0);
    move(el, 300 + 80);
    expect(h.result.current.collapsed).toBe(false);
  });

  it("a wheel gesture that collapses holds; its continuing events stay held", () => {
    const el = stubScroller();
    const h = mount(el);
    for (const y of [20, 40]) {
      wheel(el, 20);
      scrollTo(el, y);
      advance(16);
    }
    expect(h.result.current.collapsed).toBe(true);
    expect(el.scrollTop).toBe(0);
    for (let i = 0; i < 10; i++) {
      advance(100); // < 250 ms apart: the same gesture
      wheel(el, 40);
      scrollTo(el, 40);
      expect(el.scrollTop).toBe(0);
    }
    expect(el.style.overflowY).toBe("hidden");
  });

  it("a fresh wheel gesture (after 250 ms) releases and scrolls", () => {
    const el = stubScroller();
    mount(el);
    wheel(el, 40);
    scrollTo(el, 40);
    expect(el.style.overflowY).toBe("hidden");
    advance(300);
    wheel(el, 40);
    expect(el.style.overflowY).toBe("");
    scrollTo(el, 40);
    expect(el.scrollTop).toBe(40);
  });

  it("the fallback releases after HOLD_MS of quiet, but never under a finger", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    advance(HOLD_MS * 3);
    expect(el.style.overflowY).toBe("hidden"); // finger still down
    up(el);
    advance(HOLD_MS - 1);
    expect(el.style.overflowY).toBe("hidden");
    advance(1);
    expect(el.style.overflowY).toBe("");
    expect(el.style.getPropertyValue("scrollbar-gutter")).toBe("");
    scrollTo(el, 500); // e.g. a keyboard scroll
    expect(el.scrollTop).toBe(500);
  });

  it("expand() releases", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    act(() => h.result.current.expand());
    expect(h.result.current.collapsed).toBe(false);
    expect(el.style.overflowY).toBe("");
  });

  it("unmount releases", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    h.unmount();
    expect(el.style.overflowY).toBe("");
  });

  it("a collapse no touch or wheel drove (programmatic, keyboard) does not hold", () => {
    const el = stubScroller();
    const h = mount(el);
    scrollTo(el, 60);
    expect(h.result.current.collapsed).toBe(true);
    expect(el.scrollTop).toBe(60);
    expect(el.style.overflowY).toBe("");
  });

  it("a tap long before a programmatic scroll does not make it a touch gesture", () => {
    const el = stubScroller();
    const h = mount(el);
    down(el);
    up(el);
    advance(1000);
    scrollTo(el, 60);
    expect(h.result.current.collapsed).toBe(true);
    expect(el.scrollTop).toBe(60);
  });

  it("momentum after the finger lifts still holds (scroll events keep flowing)", () => {
    const el = stubScroller();
    const h = mount(el);
    down(el);
    scrollTo(el, 12);
    up(el);
    for (const y of [20, 30, 45]) {
      advance(16);
      scrollTo(el, y);
    }
    expect(h.result.current.collapsed).toBe(true);
    expect(el.scrollTop).toBe(0);
    expect(el.style.overflowY).toBe("hidden");
  });

  it("re-collapsing mid-list (after a tap-expand there) holds at the re-anchor, not 0", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    up(el);
    advance(100);
    down(el);
    scrollTo(el, 1200);
    up(el);
    advance(1000);
    act(() => h.result.current.expand());
    down(el);
    for (const y of [1210, 1220, 1240]) scrollTo(el, y);
    expect(h.result.current.collapsed).toBe(true);
    expect(el.scrollTop).toBe(1200);
  });

  it("short lists never collapse, so never hold", () => {
    const el = stubScroller(800, 600);
    const h = mount(el);
    dragCollapse(el);
    expect(h.result.current.collapsed).toBe(false);
    expect(el.scrollTop).toBe(40);
    expect(el.style.overflowY).toBe("");
  });

  it("a collapsed=1 start does not hold; reaching the top still never expands", () => {
    const el = stubScroller();
    const h = mount(el, true);
    down(el);
    scrollTo(el, 300);
    expect(el.scrollTop).toBe(300);
    expect(el.style.overflowY).toBe("");
    scrollTo(el, 0);
    up(el);
    expect(h.result.current.collapsed).toBe(true);
  });
});
