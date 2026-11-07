import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

// The scroll-driven header collapse (App Spec §25.1 Collapse). Shared by the
// Vault header and the card-detail image.
//
// Collapse after 28 px of downward travel; a tap mid-list re-anchors; short
// lists never collapse. Arriving back at the top NEVER expands:
// expansion takes a deliberate second gesture -- a tap on the collapsed
// strip (expand()), or a pull of PULL_PX that STARTS with the content already
// at the top (the blue pull bar fills as `pull` goes 0..1), or on a desktop
// wheel a fresh gesture (after a 250 ms gap) of WHEEL_PX upward at the top.
//
// The mirror hitch: the gesture that collapses ends there. When a finger
// drag that actually scrolled, its momentum, or a wheel gesture carries the
// list past the 28 px, the list is HELD: the scroll element gets
// overflow-y: hidden (what stops iOS momentum -- it overrides scrollTop
// writes, and a passive listener cannot cancel it) with scrollbar-gutter:
// stable (no width change where scrollbars take room), and scrollTop snaps to
// the anchor the collapsing travel started from -- 0 from the top, so the
// first card sits under the collapsed header. A scroll event during the hold
// is put back. The hold lasts while the finger stays down, then releases
// RELEASE_MS after the finger lifts once no scroll event has come for that
// long; a wheel hold releases RELEASE_MS after the wheel stream (and its put-
// back scrolls) goes quiet, so the rest of that gesture is swallowed. The
// scroller is therefore live again BEFORE the next gesture starts: on iOS a
// passive touchstart cannot re-enable scrolling for its own touch, and
// Chromium latches a wheel gesture's scroll target at its first event. The
// last-resort cap releases HOLD_MS after the finger lifted or the last wheel
// event, whatever scroll events keep coming (programmatic adjustments can
// never prolong it), and a finger that has sent no touch event for STALE_MS
// counts as lifted (a touchend lost with a detached target). A touchstart, a
// fresh wheel gesture, expand(), `suspended` (search mode) and unmount
// release at once. A collapse no scrolling touch or wheel drove
// (programmatic, keyboard, a layout shift after a plain tap) does not hold, and while `suspended` nothing collapses, holds or
// pulls. Two style writes per gesture -- on at the collapse, off at the
// release -- none per frame.

export const PULL_PX = 72;
export const WHEEL_PX = 140;
export const COLLAPSE_MS = 240;
export const HOLD_MS = 800;
export const RELEASE_MS = 120;
export const STALE_MS = 3000;
/** Scroll events after touchend still belong to that touch (momentum) while
 * they keep coming at most this far apart. */
const FLOW_GAP_MS = 200;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface CollapseState {
  anchor: number;
  c: boolean;
  armed: boolean;
  y0: number;
  x0: number;
  wheel: number;
  wheelAt: number;
  wheelArmed: boolean;
  wt: ReturnType<typeof setTimeout> | undefined;
  /** A finger is down. */
  touching: boolean;
  /** The last touch event seen (STALE_MS). */
  touchAt: number;
  /** scrollTop when the finger went down: a touch only counts as a scrolling
   * gesture once the list has moved. */
  touchTop: number;
  /** The last touch's momentum may still be scrolling (see FLOW_GAP_MS). */
  flow: boolean;
  flowAt: number;
  held: boolean;
  holdAt: number;
  /** The quiet timer (RELEASE_MS) and the last-resort cap (HOLD_MS). */
  ht: ReturnType<typeof setTimeout> | undefined;
  hc: ReturnType<typeof setTimeout> | undefined;
  release: () => void;
}

export interface Collapse {
  scrollEl: (el: HTMLElement | null) => void;
  collapsed: boolean;
  expand: () => void;
  pull: number;
  pullStyle: CSSProperties;
}

/** `parentCut`: the scroll container's parent carries the box cut (a
 * margin-bottom of --vh-delta while expanded), i.e. scroll room that exists
 * only while expanded; the short-list rule subtracts it so it measures the
 * room left once collapsed. */
/** `extraRoom` (card detail): scroll room that exists only
 * while expanded for another reason -- the detail body's translateY(--d-delta)
 * extends the scrollable overflow -- subtracted the same way. */
/** `suspended` (the Vault's search mode, where CSS hides the header): no
 * collapse, hold or pull; entering it releases a hold, and the anchor follows
 * the list so leaving it does not count the search scroll as collapse travel. */
export function useCollapse(
  forced: boolean,
  minRoom = 320,
  parentCut = false,
  extraRoom = 0,
  suspended = false
): Collapse {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(forced);
  const [pull, setPull] = useState(0);
  const st = useRef<CollapseState>({
    anchor: 0,
    c: forced,
    armed: false,
    y0: 0,
    x0: 0,
    wheel: 0,
    wheelAt: 0,
    wheelArmed: false,
    wt: undefined,
    touching: false,
    touchAt: 0,
    touchTop: 0,
    flow: false,
    flowAt: 0,
    held: false,
    holdAt: 0,
    ht: undefined,
    hc: undefined,
    release: () => {},
  });
  useEffect(() => {
    st.current.c = collapsed;
  }, [collapsed]);
  const extraRef = useRef(extraRoom);
  useEffect(() => {
    extraRef.current = extraRoom;
  }, [extraRoom]);
  const suspRef = useRef(suspended);
  useEffect(() => {
    suspRef.current = suspended;
    if (!suspended) return;
    const s = st.current;
    s.release();
    s.armed = false;
    s.wheelArmed = false;
    if (el) s.anchor = el.scrollTop;
    setPull(0);
  }, [suspended, el]);

  useEffect(() => {
    if (!el) return undefined;
    const s = st.current;
    const release = () => {
      clearTimeout(s.ht);
      clearTimeout(s.hc);
      if (!s.held) return;
      s.held = false;
      el.style.overflowY = "";
      el.style.removeProperty("scrollbar-gutter");
    };
    // Release once input and scrolling have been quiet for RELEASE_MS; never
    // under a finger.
    const quiet = () => {
      clearTimeout(s.ht);
      if (s.touching) return;
      s.ht = setTimeout(release, RELEASE_MS);
    };
    // The last resort: HOLD_MS after the finger lifted or the last wheel
    // event; under a finger only once it has gone STALE_MS without a touch event.
    const cap = () => {
      clearTimeout(s.hc);
      s.hc = setTimeout(() => {
        if (s.touching && Date.now() - s.touchAt < STALE_MS) return cap();
        s.touching = false;
        release();
      }, HOLD_MS);
    };
    const hold = (at: number) => {
      s.held = true;
      s.holdAt = at;
      el.style.overflowY = "hidden";
      el.style.setProperty("scrollbar-gutter", "stable");
      el.scrollTop = at;
      cap();
      quiet();
    };
    s.release = release;
    const open = () => {
      release();
      s.armed = false;
      s.wheelArmed = false;
      s.wheel = 0;
      s.anchor = 0;
      s.c = false;
      setPull(0);
      setCollapsed(false);
    };
    const onScroll = () => {
      const now = Date.now();
      if (s.flow && !s.touching) {
        if (now - s.flowAt > FLOW_GAP_MS) s.flow = false;
        else s.flowAt = now;
      }
      if (s.held) {
        if (el.scrollTop !== s.holdAt) {
          el.scrollTop = s.holdAt;
          quiet();
        }
        return;
      }
      const t = el.scrollTop;
      if (suspRef.current) {
        s.anchor = t;
        return;
      }
      if (s.c) return; // reaching the top while collapsed does not expand
      if (t <= 6) {
        s.anchor = 0;
        return;
      }
      s.anchor = Math.min(s.anchor, t);
      const ex =
        parentCut && el.parentElement
          ? parseFloat(getComputedStyle(el.parentElement).marginBottom) || 0
          : 0;
      const ex2 = extraRef.current;
      if (el.scrollHeight - el.clientHeight - ex - ex2 < minRoom) return;
      if (t - s.anchor > 28) {
        s.c = true;
        setCollapsed(true);
        const dragged = s.touching && t !== s.touchTop;
        if (dragged || s.flow || now - s.wheelAt <= 250) hold(s.anchor);
      }
    };
    const ts = (e: TouchEvent) => {
      // Normally released already (RELEASE_MS after the last finger lifted);
      // a touch that lands sooner releases here.
      release();
      s.touching = true;
      s.touchAt = Date.now();
      s.touchTop = el.scrollTop;
      s.flow = false;
      s.armed = !!(!suspRef.current && s.c && el.scrollTop <= 0 && e.touches.length === 1);
      if (s.armed) {
        s.y0 = e.touches[0].clientY;
        s.x0 = e.touches[0].clientX;
      }
    };
    const tm = (e: TouchEvent) => {
      s.touchAt = Date.now();
      if (!s.armed) return;
      const dy = e.touches[0].clientY - s.y0;
      const dx = e.touches[0].clientX - s.x0;
      if (el.scrollTop > 0 || dy < -4 || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy))) {
        s.armed = false;
        setPull(0);
        return;
      }
      const p = Math.max(0, Math.min(1, dy / PULL_PX));
      setPull(p);
      if (p >= 1) open();
    };
    // On window, capture phase: a touchend that something stops on its way up
    // still ends the touch.
    const te = (e: TouchEvent) => {
      if (!s.touching) return;
      s.touchAt = Date.now();
      if (e.touches.length > 0) return;
      s.touching = false;
      // Momentum counts only if this touch actually moved the list.
      s.flow = s.held || el.scrollTop !== s.touchTop;
      s.flowAt = Date.now();
      s.armed = false;
      setPull(0);
      if (s.held) {
        cap();
        quiet();
      }
    };
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      const fresh = now - s.wheelAt > 250;
      s.wheelAt = now;
      if (suspRef.current) return;
      if (s.held) {
        if (!fresh) {
          // The collapsing wheel gesture is still going: stay held.
          cap();
          quiet();
          return;
        }
        release();
      }
      if (!s.c || el.scrollTop > 0 || e.deltaY >= 0) {
        s.wheelArmed = false;
        s.wheel = 0;
        return;
      }
      if (fresh) {
        s.wheelArmed = true;
        s.wheel = 0;
      }
      if (!s.wheelArmed) return;
      s.wheel += -e.deltaY;
      setPull(Math.min(1, s.wheel / WHEEL_PX));
      clearTimeout(s.wt);
      s.wt = setTimeout(() => setPull(0), 300);
      if (s.wheel >= WHEEL_PX) open();
    };
    const capture = { capture: true, passive: true } as const;
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: true });
    window.addEventListener("touchend", te, capture);
    window.addEventListener("touchcancel", te, capture);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(s.wt);
      release();
      s.release = () => {};
      s.touching = false;
      s.flow = false;
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      window.removeEventListener("touchend", te, capture);
      window.removeEventListener("touchcancel", te, capture);
      el.removeEventListener("wheel", onWheel);
    };
  }, [el, minRoom, parentCut]);

  const expand = useCallback(() => {
    st.current.release();
    st.current.anchor = el ? el.scrollTop : 0;
    st.current.c = false;
    setPull(0);
    setCollapsed(false);
  }, [el]);

  // The cue's style hook: --pull on the screen root; the content shift is off
  // under prefers-reduced-motion (the bar alone carries the cue).
  const pullStyle = {
    "--pull": pull,
    "--pull-shift": (prefersReducedMotion() ? 0 : Math.round((pull * PULL_PX) / 3)) + "px",
  } as CSSProperties;
  return { scrollEl: setEl, collapsed, expand, pull, pullStyle };
}

/** The header is an overlay whose layout never changes between
 * states. Its two heights are measured (ResizeObserver) into --vh-full /
 * --vh-min / --vh-delta on the screen root; the content below sits in layout
 * at --vh-min and is moved down by --vh-delta with a transform while
 * expanded. The list's box is cut by --vh-delta (--vh-cut) so it ends at the
 * bar in both states: the cut lands ONCE, on the expand's transitionend, and
 * is dropped in the same style pass as the collapse class flip. One layout
 * per gesture, none per frame. */
export function useHeaderSlot(
  rootRef: RefObject<HTMLElement | null>,
  hdrRef: RefObject<HTMLElement | null>,
  topRef: RefObject<HTMLElement | null>,
  collapsed: boolean
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const hdr = hdrRef.current;
    const top = topRef.current;
    if (!root || !hdr || !top) return undefined;
    let last = "";
    const measure = () => {
      const full = hdr.offsetHeight;
      const min = top.offsetTop + top.offsetHeight + 6;
      const key = full + "/" + min;
      if (key === last) return;
      last = key;
      root.style.setProperty("--vh-full", full + "px");
      root.style.setProperty("--vh-min", min + "px");
      root.style.setProperty("--vh-delta", Math.max(0, full - min) + "px");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hdr);
    ro.observe(top);
    return () => ro.disconnect();
  }, [rootRef, hdrRef, topRef]);

  const settled = useRef(false);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const below = root?.querySelector<HTMLElement>(".m-vault__below");
    if (!root || !below) return undefined;
    const cut = (on: boolean) => {
      root.style.setProperty("--vh-cut", on ? "var(--vh-delta, 0px)" : "0px");
    };
    // First paint, or reduced motion: no transition to wait for.
    if (!settled.current || prefersReducedMotion()) {
      cut(!collapsed);
      settled.current = true;
      return undefined;
    }
    let done = false;
    const onEnd = (e: TransitionEvent) => {
      if (e.target === below && e.propertyName === "transform") finish();
    };
    const finish = () => {
      if (done) return;
      done = true;
      below.removeEventListener("transitionend", onEnd);
      cut(!collapsed);
    };
    below.addEventListener("transitionend", onEnd);
    const t = setTimeout(finish, COLLAPSE_MS + 120); // safety net if no transitionend fires
    return () => {
      clearTimeout(t);
      below.removeEventListener("transitionend", onEnd);
    };
  }, [collapsed, rootRef]);
}
