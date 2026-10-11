import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

// BL-247 S1-06: the scroll-driven header collapse (port of rev4
// MVault.jsx:206-360, useCollapse + useHeaderSlot). Shared by the Vault header
// and, from S2, the card-detail image.
//
// Collapse after 28 px of downward travel; a tap mid-list re-anchors; short
// lists never collapse. Arriving back at the top NEVER expands (rev2 C1):
// expansion takes a deliberate second gesture -- a tap on the collapsed
// strip (expand()), or a pull of PULL_PX that STARTS with the content already
// at the top (the steel pull bar fills as `pull` goes 0..1), or on a desktop
// wheel a fresh gesture (after a 250 ms gap) of WHEEL_PX upward at the top.

export const PULL_PX = 72;
export const WHEEL_PX = 140;
export const COLLAPSE_MS = 240;

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
}

export interface Collapse {
  scrollEl: (el: HTMLElement | null) => void;
  collapsed: boolean;
  expand: () => void;
  pull: number;
  pullStyle: CSSProperties;
}

/** `parentCut`: the scroll container's parent carries the R3-13 box cut (a
 * margin-bottom of --vh-delta while expanded), i.e. scroll room that exists
 * only while expanded; the short-list rule subtracts it so it measures the
 * room left once collapsed. */
/** `extraRoom` (BL-248 S2-02, card detail): scroll room that exists only
 * while expanded for another reason -- the detail body's translateY(--d-delta)
 * extends the scrollable overflow -- subtracted the same way. */
export function useCollapse(
  forced: boolean,
  minRoom = 320,
  parentCut = false,
  extraRoom = 0
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
  });
  useEffect(() => {
    st.current.c = collapsed;
  }, [collapsed]);
  const extraRef = useRef(extraRoom);
  useEffect(() => {
    extraRef.current = extraRoom;
  }, [extraRoom]);

  useEffect(() => {
    if (!el) return undefined;
    const s = st.current;
    const open = () => {
      s.armed = false;
      s.wheelArmed = false;
      s.wheel = 0;
      s.anchor = 0;
      s.c = false;
      setPull(0);
      setCollapsed(false);
    };
    const onScroll = () => {
      if (s.c) return; // C1: reaching the top while collapsed does not expand
      const t = el.scrollTop;
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
      }
    };
    const ts = (e: TouchEvent) => {
      s.armed = !!(s.c && el.scrollTop <= 0 && e.touches.length === 1);
      if (s.armed) {
        s.y0 = e.touches[0].clientY;
        s.x0 = e.touches[0].clientX;
      }
    };
    const tm = (e: TouchEvent) => {
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
    const te = () => {
      s.armed = false;
      setPull(0);
    };
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      const fresh = now - s.wheelAt > 250;
      s.wheelAt = now;
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
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: true });
    el.addEventListener("touchend", te, { passive: true });
    el.addEventListener("touchcancel", te, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(s.wt);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", te);
      el.removeEventListener("wheel", onWheel);
    };
  }, [el, minRoom, parentCut]);

  const expand = useCallback(() => {
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

/** R3-6 + R3-13: the header is an overlay whose layout never changes between
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
