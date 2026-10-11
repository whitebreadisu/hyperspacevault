import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { MIcon } from "./icons";
import "./sheet.css";

// BL-247 S1-13: the bottom sheet (rev4 MSheet.jsx:21-65; CSS m-layout.css:
// 225-312). Bottom-anchored full shell (18 px cuts, steel ring), scrim, X
// top-right 44 px, title + optional sub, height = content up to 86 %. Closes
// on the scrim, the X, Escape and a downward swipe on the head. Motion is
// transform + opacity only: the panel rises / sinks (translateY) and the
// scrim fades. Sheets render into the SheetHost layer at the .m-app root so
// they cover the bottom bar.

const HostContext = createContext<HTMLElement | null>(null);
const CloseContext = createContext<() => void>(() => {});

/** The .m-app-level layer every Sheet portals into. */
export function SheetHost({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <HostContext.Provider value={host}>
      {children}
      <div className="m-sheethost" ref={setHost} />
    </HostContext.Provider>
  );
}

/** Inside a sheet: close it with the leave motion (e.g. after a pick). */
export function useSheetClose(): () => void {
  return useContext(CloseContext);
}

/** Leave motion length + a margin (fallback when no animationend arrives). */
const LEAVE_MS = 180;
const SWIPE_CLOSE_PX = 90;

interface Props {
  title: string;
  sub?: ReactNode;
  /** Called once the leave motion has finished; the parent unmounts the sheet. */
  onClose: () => void;
  labelId: string;
  className?: string;
  /** BL-249 S3-05: an optional pinned foot under the scrolling body (rev4
   * MSheet footer, m-layout.css:248 .m-sheet__foot). */
  footer?: ReactNode;
  children: ReactNode;
}

export function Sheet({ title, sub, onClose, labelId, className, footer, children }: Props) {
  const host = useContext(HostContext);
  const [leaving, setLeaving] = useState(false);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; id: number } | null>(null);
  const dyRef = useRef(0);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onCloseRef.current();
  }, []);
  const close = useCallback(() => setLeaving(true), []);

  // Leave: wait for the panel's sink animation, with a timer as the net.
  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(finish, LEAVE_MS + 120);
    return () => clearTimeout(t);
  }, [leaving, finish]);

  // Escape closes; focus moves in on open and back to the opener on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected && opener.tagName !== "INPUT") opener.focus();
    };
  }, [close]);
  useEffect(() => {
    if (host) closeBtn.current?.focus({ preventScroll: true });
  }, [host]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    dyRef.current = Math.max(0, e.clientY - drag.current.y);
    setDy(dyRef.current);
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    const far = dyRef.current > SWIPE_CLOSE_PX;
    dyRef.current = 0;
    setDy(0);
    if (far) close();
  };

  if (!host) return null;
  return createPortal(
    <CloseContext.Provider value={close}>
      <div
        className={
          "m-sheet-layer" +
          (leaving ? " m-sheet-layer--leaving" : "") +
          (className ? " " + className : "")
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
      >
        <div className="m-sheet-scrim" onClick={close} />
        <div
          className="m-sheet"
          style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
          onAnimationEnd={(e) => {
            if (leaving && e.target === e.currentTarget) finish();
          }}
        >
          <div className="m-sheet__inner">
            <div
              className="m-sheet__head"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            >
              <span className="m-sheet__grip" aria-hidden="true" />
              <div className="m-sheet__titles">
                <h2 className="m-sheet__title" id={labelId}>
                  {title}
                </h2>
                {sub ? <div className="m-sheet__sub">{sub}</div> : null}
              </div>
              <button
                ref={closeBtn}
                type="button"
                className="m-iconbtn m-sheet__close"
                onClick={close}
                aria-label="Close"
              >
                <MIcon name="close" />
              </button>
            </div>
            <div className="m-sheet__body">{children}</div>
            {footer ? <div className="m-sheet__foot">{footer}</div> : null}
          </div>
        </div>
      </div>
    </CloseContext.Provider>,
    host
  );
}
