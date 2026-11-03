// Copy or share a card link (App Spec §5.3 desktop popup, §25.2 phone card
// detail). Copy prefers the async clipboard and falls back to a hidden
// textarea with execCommand("copy") where the clipboard is missing or
// refuses (an insecure origin, an older browser). Share uses the system
// share sheet where the browser has one and copies otherwise; a share the
// user cancels is not an error and is reported as such.

/** Copies `text`; true when it reached the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea */
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  // 16 px keeps iOS from zooming the page when the textarea takes focus.
  ta.style.fontSize = "16px";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.select();
    ok = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    ta.remove();
    active?.focus?.({ preventScroll: true });
  }
  return ok;
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** The system share sheet when there is one, else a copy. A cancelled sheet
 * is "cancelled"; a sheet that fails for another reason falls back to copy. */
export async function shareOrCopy(title: string, url: string): Promise<ShareOutcome> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      // A DOMException is not an Error in every engine; the name is what counts.
      if ((e as { name?: unknown } | null)?.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}
