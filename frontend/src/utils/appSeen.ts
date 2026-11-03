// The returning-visitor marker (App Spec §5.3 "?card= boot read"): the app
// writes it on every boot, desktop and phone; a public card page reads it
// before hydrating and, when set, opens the same card in the app instead
// (public/autoOpen.ts). It records only that this browser has opened the app
// -- no id, no time. Storage that throws (private mode, blocked site data)
// means no marker is written and none is read.

export const APP_SEEN_KEY = "hsv_app_seen";

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Sets the marker; a storage failure is silent. */
export function markAppSeen(storage: Storage | null = store()): void {
  try {
    storage?.setItem(APP_SEEN_KEY, "1");
  } catch {
    /* no marker; the card pages simply stay on the page */
  }
}

/** True only when the marker reads back as set. */
export function hasSeenApp(storage: Storage | null = store()): boolean {
  try {
    return storage?.getItem(APP_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
