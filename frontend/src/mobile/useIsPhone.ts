import { useEffect, useState } from "react";

/** BL-247 S1-01: the phone/desktop gate. A viewport at or below 767 px renders
 * the mobile app; anything wider renders the desktop tree unchanged. */
export const PHONE_QUERY = "(max-width: 767px)";

function read(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(PHONE_QUERY).matches;
}

/** Live (follows the media query's `change` event) and SSR-safe (false when
 * there is no window / matchMedia). */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(read);

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
