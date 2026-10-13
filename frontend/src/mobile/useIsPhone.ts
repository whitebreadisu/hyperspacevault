import { useEffect, useState } from "react";

/** BL-257 FR5-06 (owner decision 2026-10-12, F-18): a short, touch-first
 * screen -- a phone held on its side (874 x 402 on an iPhone 16 Pro). A
 * tablet is taller than 500 px and a short desktop window is driven by a
 * mouse, so neither matches. */
export const PHONE_SHORT_TOUCH_QUERY =
  "(max-height: 500px) and (hover: none) and (pointer: coarse)";

/** BL-247 S1-01 + BL-257 FR5-06: the phone/desktop gate, the ONE definition
 * (analytics.ts mirrors the string; a test pins them equal). The phone app
 * renders when the viewport is narrow (at or below 767 px) OR is a short,
 * touch-first screen; anything else renders the desktop tree unchanged. */
export const PHONE_QUERY = `(max-width: 767px), (${PHONE_SHORT_TOUCH_QUERY})`;

function matches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/** Live (follows the media query's `change` event) and SSR-safe (false when
 * there is no window / matchMedia). */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() => matches(PHONE_QUERY));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(PHONE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    setIsPhone(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isPhone;
}

/** What `screenIsLandscape` reads: the device's screen, never the viewport. */
export interface ScreenLike {
  screen?: {
    orientation?: { type?: string } | null;
    width?: number;
    height?: number;
  } | null;
  /** The legacy angle (0 / 180 upright, 90 / -90 on its side). */
  orientation?: number | string;
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

function sideways(): boolean {
  return (
    typeof window !== "undefined" &&
    matches(PHONE_SHORT_TOUCH_QUERY) &&
    screenIsLandscape(window as unknown as ScreenLike)
  );
}

/** FR5-06: a phone held on its side -- the screen is in landscape AND the
 * viewport is the short, touch-first one of a phone. The second half keeps a
 * narrow desktop window (a landscape monitor, a mouse) and a tablet in a
 * narrow split view out of it; the first half keeps an upright phone with
 * its keyboard up out of it. Re-evaluated on the screen-orientation `change`,
 * `orientationchange`, `resize` and the media query's `change`. */
export function usePhoneSideways(): boolean {
  const [on, setOn] = useState<boolean>(sideways);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setOn(sideways());
    update();
    const so = window.screen?.orientation;
    so?.addEventListener?.("change", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    const mql =
      typeof window.matchMedia === "function" ? window.matchMedia(PHONE_SHORT_TOUCH_QUERY) : null;
    mql?.addEventListener("change", update);
    return () => {
      so?.removeEventListener?.("change", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
      mql?.removeEventListener("change", update);
    };
  }, []);

  return on;
}
