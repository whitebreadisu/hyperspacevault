import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardSet } from "../../api/sets";
import { baseOnlyGroups, allSetsGroups, findSet } from "../../utils/setGrouping";
import type { SetRailGroup } from "../../utils/setGrouping";

interface Props {
  sets: CardSet[];
  onChoose: (code: string) => void;
}

interface PopPos {
  top: number;
  left: number;
  maxH: number;
}

const DEFAULT_MAX_H = 396;
const MIN_MAX_H = 180;
const VIEWPORT_MARGIN = 26;

/** BL-164 §5: the custom logo-rail listbox that replaces AddCardsSetBar's
 * unlocked-state native `<select>`. Portaled to `document.body` (the modal
 * shell's corner-cut clip-path would truncate an absolutely-positioned
 * child, same rationale as FilterMenuPortal's existing precedent) with
 * `position: fixed` coordinates derived from the trigger's own rect.
 * `aria-label="Set"` on both the trigger button and the listbox panel is the
 * stable test-facing accessible-name contract (Set_Grouping_Context's
 * "Fixed" list) -- unchanged by this restyle. */
export function SetDropdown({ sets, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const [showAllSets, setShowAllSets] = useState(false);
  const [pos, setPos] = useState<PopPos>({ top: 0, left: 0, maxH: DEFAULT_MAX_H });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 6,
        left: r.left,
        maxH: Math.max(
          MIN_MAX_H,
          Math.min(DEFAULT_MAX_H, window.innerHeight - r.bottom - VIEWPORT_MARGIN)
        ),
      });
    }
    setOpen((v) => !v);
  }

  function pick(code: string) {
    setOpen(false);
    onChoose(code);
  }

  function row(code: string, sub = false) {
    const s = findSet(sets, code);
    if (!s) return null;
    return (
      <button
        key={code}
        type="button"
        role="option"
        aria-label={`${code} — ${s.name}`}
        className={`acx-pdd__row acx-pdd__row--glow${sub ? " acx-sdd__row--sub" : ""}`}
        onClick={() => pick(code)}
      >
        <span className="acx-pdd__row-text">
          <span className="acx-pdd__row-product">{code}</span>
          <span className="acx-pdd__row-name">{s.name}</span>
        </span>
      </button>
    );
  }

  function railGroup(group: SetRailGroup) {
    return (
      <div className="acx-pdd__rgroup" key={group.key}>
        <div className="acx-pdd__rlogo">
          {group.logoCode ? (
            <img src={`/images/set_${group.logoCode}.png`} alt={`${group.logoCode} logo`} />
          ) : (
            <span className="acx-sdd__rlabel">{group.label}</span>
          )}
        </div>
        <div className="acx-pdd__rdecks">
          {group.memberCodes.map((code, i) => row(code, i > 0))}
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  if (!showAllSets) {
    const { canonical, secondary } = baseOnlyGroups(sets);
    body = (
      <>
        {canonical.map(railGroup)}
        <div className="acx-sdd__divider" aria-hidden="true" />
        {secondary.map(railGroup)}
      </>
    );
  } else {
    const { baseGroups, exclusiveGroups } = allSetsGroups(sets);
    body = (
      <>
        {baseGroups.map(railGroup)}
        <div className="acx-sdd__divider" aria-hidden="true" />
        {exclusiveGroups.map(railGroup)}
      </>
    );
  }

  return (
    <div className={`acx-pdd${open ? " acx-pdd--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="acx-pdd__trigger"
        aria-label="Set"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        autoFocus
      >
        Select a set to begin…
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="acx-pdd__pop"
            style={{ position: "fixed", top: pos.top, left: pos.left }}
          >
            <div
              className="acx-pdd__panel"
              role="listbox"
              aria-label="Set"
              style={{ maxHeight: pos.maxH }}
            >
              {body}
              <div className="acx-sdd__foot">
                <button
                  type="button"
                  className="ac-setbar__change"
                  onClick={() => setShowAllSets((v) => !v)}
                >
                  {showAllSets ? "Base sets only" : "Show all sets"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
