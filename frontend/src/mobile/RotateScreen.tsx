import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MIcon } from "./icons";
import { usePhoneSideways } from "./useIsPhone";
import "./rotate.css";

// BL-257 FR5-06 (owner decision 2026-10-12, F-18): a browser tab cannot lock
// the orientation, so a phone held on its side keeps the phone app and gets
// this screen over it. The app stays MOUNTED and unchanged beneath (route,
// scroll, open sheet, keypad batch, typed search); it is only made inert.
//
// The panel is a child of <body>, beside the app root, for two reasons: the
// whole app root can then be `inert` without the panel being inside it, and
// it sits above the one phone layer that is not inside `.m-app` (the busy
// overlay, a <body> child at z-index 300). Every other <body> child is made
// inert while it shows and restored after.

/** The element focus was on before the app went inert (focus returns to it). */
function focused(): HTMLElement | null {
  const a = document.activeElement;
  return a instanceof HTMLElement && a !== document.body ? a : null;
}

export function RotateScreen() {
  const on = usePhoneSideways();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const restore = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!on || !panel) return undefined;
    // Before `inert` lands: the browser drops focus from an inert subtree.
    restore.current = focused();
    const made: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === panel || !(el instanceof HTMLElement) || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      made.push(el);
    }
    return () => {
      for (const el of made) el.removeAttribute("inert");
      const back = restore.current;
      restore.current = null;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [on, panel]);

  if (!on) return null;
  return createPortal(
    <div className="m-rotate" role="status" aria-live="polite" ref={setPanel}>
      <MIcon name="rotate" size={56} className="m-rotate__glyph" />
      <p className="m-rotate__title">Turn your phone upright</p>
      <p className="m-rotate__sub">Hyperspace Vault is built for portrait on phones.</p>
    </div>,
    document.body
  );
}
