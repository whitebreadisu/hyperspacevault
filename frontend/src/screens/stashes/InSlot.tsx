import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Renders `children` once, into a host element that lives in `slot` when
 * there is one and in place otherwise. CardsPage uses it to show the Vault's
 * FilterPanel in the Stashes page's card-list corner (StashesPane
 * `onFilterSlot`, R1-5). The portal target never changes -- only the host
 * element moves between the two places -- so the children never remount:
 * the panel keeps its open / collapsed state and its loaded data across
 * Collection <-> Stashes and every stash change. React events still bubble
 * through CardsPage. Both wrappers are `display: contents` (the host is `none`
 * while `hidden`), so the panel lays out as a direct child of wherever the host sits. */
export function InSlot({
  slot,
  hidden = false,
  children,
}: {
  slot: HTMLElement | null;
  /** Hides the host (`display: none`) without unmounting, so a page with
   * nothing to filter keeps the panel's state for when it returns. */
  hidden?: boolean;
  children: ReactNode;
}) {
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "filter-host";
    el.style.display = "contents";
    return el;
  });
  const home = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const target = slot ?? home.current;
    if (target && host.parentNode !== target) target.appendChild(host);
  }, [slot, host]);
  useLayoutEffect(() => {
    host.style.setProperty("display", hidden ? "none" : "contents");
  }, [hidden, host]);
  useLayoutEffect(() => () => host.remove(), [host]);
  return (
    <>
      <span ref={home} style={{ display: "contents" }} />
      {createPortal(children, host)}
    </>
  );
}
