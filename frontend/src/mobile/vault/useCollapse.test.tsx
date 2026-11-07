import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, RELEASE_MS, STALE_MS, useCollapse } from "./useCollapse";

// The collapse-side hitch (App Spec §25.1 Collapse). The gesture that collapses ends there: the
// list is held at the collapsing travel's anchor (its top) while the finger is
// down, then released RELEASE_MS after the finger lifts (or the wheel stream
// goes quiet), so the next gesture finds the list live; a touchstart, a fresh
// wheel gesture, expand(), search mode and unmount release at once, and the
// HOLD_MS cap bounds it.
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
  const h = renderHook(({ searching }) => useCollapse(forced, 320, false, 0, searching), {
    initialProps: { searching: false },
  });
  act(() => h.result.current.scrollEl(el));
  return h;
}
const held = (el: HTMLElement) => el.style.overflowY === "hidden";

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

  // REPLACE (the touchstart release came too late on iOS, where a passive
  // touchstart cannot make its own touch scroll): the hold ends RELEASE_MS
  // after the finger lifts, before the next touch.
  it("releases RELEASE_MS after the finger lifts; the next touch scrolls and does not re-hold", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    up(el);
    advance(RELEASE_MS - 1);
    expect(held(el)).toBe(true);
    advance(1);
    expect(held(el)).toBe(false);
    down(el);
    scrollTo(el, 300);
    expect(el.scrollTop).toBe(300);
    expect(h.result.current.collapsed).toBe(true);
  });

  it("a touch that lands inside RELEASE_MS releases at its touchstart", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    up(el);
    advance(40);
    expect(held(el)).toBe(true);
    down(el);
    expect(held(el)).toBe(false);
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

  // REPLACE (Chromium latches a wheel gesture's scroll target at its first
  // event, so releasing on the next gesture's first event was too late): the
  // wheel hold ends RELEASE_MS after the stream goes quiet, before a fresh
  // gesture (> 250 ms) can start.
  it("a wheel hold releases once the wheel stream goes quiet; the next wheel scrolls", () => {
    const el = stubScroller();
    mount(el);
    wheel(el, 40);
    scrollTo(el, 40);
    expect(held(el)).toBe(true);
    advance(RELEASE_MS - 1);
    expect(held(el)).toBe(true);
    advance(1);
    expect(held(el)).toBe(false);
    advance(300);
    wheel(el, 40);
    scrollTo(el, 40);
    expect(el.scrollTop).toBe(40);
  });

  // REPLACE (the fallback was the only release after a lift; it is now the
  // last resort behind RELEASE_MS).
  it("never releases under a finger; releases RELEASE_MS after it lifts", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    for (let i = 0; i < 4; i++) {
      advance(HOLD_MS / 2);
      move(el, 300 - i * 10); // the finger is still down and moving
    }
    expect(held(el)).toBe(true);
    up(el);
    advance(RELEASE_MS);
    expect(held(el)).toBe(false);
    expect(el.style.getPropertyValue("scrollbar-gutter")).toBe("");
    scrollTo(el, 500); // e.g. a keyboard scroll
    expect(el.scrollTop).toBe(500);
  });

  it("scroll events after the lift cannot prolong the hold past HOLD_MS", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    up(el);
    // A put-back scroll every 50 ms (momentum, or a programmatic adjustment).
    for (let t = 50; t < HOLD_MS; t += 50) {
      advance(50);
      scrollTo(el, 30);
      expect(held(el)).toBe(true);
    }
    advance(50);
    expect(held(el)).toBe(false);
  });

  it("a finger that sends nothing for STALE_MS counts as lifted (lost touchend)", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    advance(STALE_MS - HOLD_MS);
    expect(held(el)).toBe(true);
    advance(HOLD_MS * 2);
    expect(held(el)).toBe(false);
  });

  it("touchcancel ends the touch: the hold releases RELEASE_MS later", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    act(() => void fireEvent.touchCancel(el, { touches: [] }));
    advance(RELEASE_MS);
    expect(held(el)).toBe(false);
  });

  it("a touchend that never reaches the list (window, capture) still ends the touch", () => {
    const el = stubScroller();
    mount(el);
    dragCollapse(el);
    // Something above the list stops the touchend before it gets there.
    const stop = (e: Event) => e.stopPropagation();
    document.addEventListener("touchend", stop, { capture: true });
    act(() => void fireEvent.touchEnd(el, { touches: [] }));
    document.removeEventListener("touchend", stop, { capture: true });
    advance(RELEASE_MS);
    expect(held(el)).toBe(false);
  });

  it("a plain tap, then a layout scroll within the momentum window, does not hold", () => {
    const el = stubScroller();
    const h = mount(el);
    down(el);
    up(el);
    advance(50); // < FLOW_GAP_MS (200)
    scrollTo(el, 60);
    expect(h.result.current.collapsed).toBe(true);
    expect(el.scrollTop).toBe(60);
    expect(held(el)).toBe(false);
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

  it("search mode never collapses or holds; the first swipe in the results scrolls", () => {
    const el = stubScroller();
    const h = mount(el);
    h.rerender({ searching: true });
    dragCollapse(el);
    scrollTo(el, 400);
    up(el);
    expect(h.result.current.collapsed).toBe(false);
    expect(el.scrollTop).toBe(400);
    expect(held(el)).toBe(false);
    // Leaving search mid-list: the search scroll is not collapse travel.
    h.rerender({ searching: false });
    scrollTo(el, 410);
    expect(h.result.current.collapsed).toBe(false);
  });

  it("entering search releases a hold at once", () => {
    const el = stubScroller();
    const h = mount(el);
    dragCollapse(el);
    expect(held(el)).toBe(true);
    h.rerender({ searching: true });
    expect(held(el)).toBe(false);
  });
});
