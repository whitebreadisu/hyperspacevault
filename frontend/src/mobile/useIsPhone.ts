import { useEffect, useState } from "react";

// BL-247 S1-01 + BL-257 FR5-06 (owner decisions 2026-10-12, F-18 and the
// review fix run): the phone/desktop gate. ONE definition -- `isPhoneLayout()`
// -- read by the hook below and by the analytics `layout` super-property
// (analytics.ts calls the same function).
//
// The phone app renders when
//   - the viewport is narrow: `(max-width: 767px)` matches, OR
//   - the DEVICE is a phone: its primary input is touch
//     (`(hover: none) and (pointer: coarse)`) and its screen's SHORT side is
//     at most 500 CSS px.
// The second arm is keyed to the device, never to the viewport's height: a
// landscape tablet whose on-screen keyboard shrinks the layout viewport must
// not flip to the phone app mid-typing. Phones are about 320 to 480 px on the
// short side; tablets and unfolded foldables are 600 px or more. The short
// side is used because iOS does not swap `screen.width` / `screen.height`
// when the phone turns (Android does).

/** The width arm of the gate. NOT the whole gate -- that is `isPhoneLayout()`. */
export const PHONE_QUERY = "(max-width: 767px)";
/** Touch is the primary input (a mouse-driven window never matches). */
export const PHONE_TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
/** The largest screen short side, in CSS px, that is a phone. */
export const PHONE_SHORT_SIDE_MAX = 500;

/** What the gate reads: media queries and the device's screen. */
export interface ScreenLike {
  screen?: {
    orientation?: { type?: string } | null;
    width?: number;
    height?: number;
  } | null;
  /** The legacy angle (0 / 180 upright, 90 / -90 on its side). */
  orientation?: number | string;
  matchMedia?: (query: string) => { matches: boolean };
}

function gateWindow(): ScreenLike | null {
  return typeof window === "undefined" ? null : (window as unknown as ScreenLike);
}

function matches(win: ScreenLike | null | undefined, query: string): boolean {
  return !!win && typeof win.matchMedia === "function" && win.matchMedia(query).matches;
}

/** The device arm: touch is the primary input AND the screen's short side is
 * at most 500 CSS px. Nothing here reads the viewport. An unknown or zero
 * screen size is not a phone. */
export function isTouchPhoneDevice(win: ScreenLike | null | undefined = gateWindow()): boolean {
  if (!matches(win, PHONE_TOUCH_QUERY)) return false;
  const w = win?.screen?.width;
  const h = win?.screen?.height;
  if (typeof w !== "number" || typeof h !== "number") return false;
  const short = Math.min(w, h);
  return short > 0 && short <= PHONE_SHORT_SIDE_MAX;
}

/** THE gate: does the phone app render? SSR-safe (false with no window). */
export function isPhoneLayout(win: ScreenLike | null | undefined = gateWindow()): boolean {
  return matches(win, PHONE_QUERY) || isTouchPhoneDevice(win);
}

/** Calls `update` whenever an input of the gate or of the rotate screen may
 * have changed: the width query's `change`, the touch query's `change`,
 * `resize`, `orientationchange` and the screen-orientation `change`. Returns
 * the unsubscribe. */
function watchDevice(update: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mqls =
    typeof window.matchMedia === "function"
      ? [window.matchMedia(PHONE_QUERY), window.matchMedia(PHONE_TOUCH_QUERY)]
      : [];
  for (const m of mqls) m.addEventListener("change", update);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  const so = window.screen?.orientation;
  so?.addEventListener?.("change", update);
  return () => {
    for (const m of mqls) m.removeEventListener("change", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    so?.removeEventListener?.("change", update);
  };
}

/** Follows the gate: `onChange(phone)` each time `isPhoneLayout()` flips.
 * Returns the unsubscribe. (analytics.ts keeps `layout` current with it.) */
export function watchPhoneLayout(onChange: (phone: boolean) => void): () => void {
  let last = isPhoneLayout();
  return watchDevice(() => {
    const now = isPhoneLayout();
    if (now === last) return;
    last = now;
    onChange(now);
  });
}

/** Live and SSR-safe. */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() => isPhoneLayout());

  useEffect(() => {
    const update = () => setIsPhone(isPhoneLayout());
    update();
    return watchDevice(update);
  }, []);

  return isPhone;
}

/** FR5-06: is the DEVICE on its side? From the screen orientation --
 * `screen.orientation.type`, else the legacy `window.orientation` angle
 * (+-90), else the screen's own width > height. Never from the viewport's
 * shape (`innerWidth > innerHeight`, `(orientation: landscape)`): an Android
 * keyboard shrinks the layout viewport of an upright phone until it is wider
 * than tall. Pure: the caller supplies the window. */
export function screenIsLandscape(win: ScreenLike | null | undefined): boolean {
  if (!win) return false;
  const type = win.screen?.orientation?.type;
  if (typeof type === "string" && type !== "") return type.startsWith("landscape");
  if (typeof win.orientation === "number") return Math.abs(win.orientation) === 90;
  const w = win.screen?.width;
  const h = win.screen?.height;
  return typeof w === "number" && typeof h === "number" && w > h;
}

/** FR5-06: a phone held on its side -- the screen is in landscape AND the
 * device is a phone (touch-primary, short side at most 500 px). The second
 * half keeps a narrow desktop window (a landscape monitor, a mouse) and every
 * tablet out of it; the first half keeps an upright phone with its keyboard
 * up out of it. Pure: the caller supplies the window. */
export function isPhoneSideways(win: ScreenLike | null | undefined = gateWindow()): boolean {
  return isTouchPhoneDevice(win) && screenIsLandscape(win);
}

/** Live `isPhoneSideways()`: re-evaluated on the same events as the gate. */
export function usePhoneSideways(): boolean {
  const [on, setOn] = useState<boolean>(() => isPhoneSideways());

  useEffect(() => {
    const update = () => setOn(isPhoneSideways());
    update();
    return watchDevice(update);
  }, []);

  return on;
}
