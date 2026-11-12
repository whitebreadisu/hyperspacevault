import { useCallback, useEffect, useRef } from "react";

// Re-reads live data when the viewer comes back to the tab: the document
// becomes visible again, or the window regains focus. At most once per
// `minIntervalMs` since the last read (the caller's own reads included, via
// `markRead`), matching the server's cache lifetime for the data, so
// switching windows back and forth does not hammer the endpoint. A stash
// link's viewer uses it (App Spec §19.1), desktop and phone.

/** Default throttle: the shared stash read's `max-age=30`. */
export const REFRESH_MIN_INTERVAL_MS = 30_000;

export function useRefreshOnReturn(
  refresh: () => void,
  {
    enabled,
    minIntervalMs = REFRESH_MIN_INTERVAL_MS,
    now = () => Date.now(),
  }: { enabled: boolean; minIntervalMs?: number; now?: () => number }
): { markRead: () => void } {
  // The last read's time; the caller stamps its own reads with markRead.
  const last = useRef(0);
  const refreshRef = useRef(refresh);
  const nowRef = useRef(now);
  useEffect(() => {
    refreshRef.current = refresh;
    nowRef.current = now;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onReturn = () => {
      if (document.visibilityState === "hidden") return;
      const t = nowRef.current();
      if (t - last.current < minIntervalMs) return;
      last.current = t;
      refreshRef.current();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [enabled, minIntervalMs]);

  const markRead = useCallback(() => {
    last.current = nowRef.current();
  }, []);
  return { markRead };
}
