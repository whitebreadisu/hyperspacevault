import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardSet } from "../../api/sets";
import type { PreconEntry } from "../../data/preconDecks";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import { entrySetCode, entryProduct, entryName, sortedEntries } from "./AddCardsPreconBar";
import { buildPreconPreview } from "../../utils/preconPreview";
import { PreconPreviewComposition } from "./PreconPreviewComposition";

interface Props {
  entries: PreconEntry[];
  sets: CardSet[];
  catalog: AddCardsCatalogEntry[];
  onChoose: (key: string) => void;
}

interface PopPos {
  top: number;
  /** The list panel's leading edge -- its LEFT edge when not flipped, or its
   * RIGHT edge (measured from the viewport's right, i.e. a CSS `right`
   * value) when flipped, so the panel stays anchored to the trigger and the
   * preview panel grows further left/right from there. Exactly one of
   * `left`/`right` is set. */
  left: number | null;
  right: number | null;
  maxH: number;
  flip: boolean;
}

const DEFAULT_MAX_H = 396;
const MIN_MAX_H = 180;
const VIEWPORT_MARGIN = 26;

interface RailGroup {
  code: string;
  items: PreconEntry[];
}

function groupBySet(entries: PreconEntry[]): RailGroup[] {
  const groups: RailGroup[] = [];
  for (const entry of entries) {
    const code = entrySetCode(entry);
    const last = groups[groups.length - 1];
    if (!last || last.code !== code) groups.push({ code, items: [entry] });
    else last.items.push(entry);
  }
  return groups;
}

/** BL-164 §5: the custom logo-rail listbox that replaces AddCardsPreconBar's
 * unlocked-state native `<select>`, railed by set (same layout idiom as
 * SetDropdown) plus the owner-locked hover preview panel to the LEFT of the
 * list ("beside-left" -- the saved default). `catalog` threads through to
 * resolve each hovered entry's leader/base composition
 * (utils/preconPreview.ts) -- the same catalog AddCardsModal already holds,
 * no new fetch. */
export function PreconDropdown({ entries, sets, catalog, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [pos, setPos] = useState<PopPos>({
    top: 0,
    left: 0,
    right: null,
    maxH: DEFAULT_MAX_H,
    flip: false,
  });
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

  const ordered = sortedEntries(entries);
  const groups = groupBySet(ordered);
  const hovered = hoverKey ? (ordered.find((e) => e.key === hoverKey) ?? null) : null;
  const hoveredPreview = hovered ? buildPreconPreview(hovered, catalog) : null;

  function toggleOpen() {
    if (!open && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      const maxH = Math.max(
        MIN_MAX_H,
        Math.min(DEFAULT_MAX_H, window.innerHeight - r.bottom - VIEWPORT_MARGIN)
      );
      // Saved default previewMode "beside-left": the preview panel sits to
      // the LEFT of the list unconditionally -- the pop container flips to
      // flex-direction: row-reverse (CSS `.acx-pdd__pop--flip`) and anchors
      // by its RIGHT edge (== the trigger's own right edge, `window.
      // innerWidth - r.right`) instead of its left, so the list panel stays
      // under the trigger and the preview grows further left from there
      // (mirrors the design prototype's identical `right: innerWidth -
      // pos.left - triggerWidth` calc).
      setPos({
        top: r.bottom + 6,
        left: null,
        right: window.innerWidth - r.right,
        maxH,
        flip: true,
      });
    }
    setHoverKey(null);
    setOpen((v) => !v);
  }

  function pick(key: string) {
    setOpen(false);
    setHoverKey(null);
    onChoose(key);
  }

  function row(entry: PreconEntry) {
    return (
      <button
        key={entry.key}
        type="button"
        role="option"
        aria-label={`${entryProduct(entry)} — ${entryName(entry, sets)}`}
        className="acx-pdd__row acx-pdd__row--glow"
        onClick={() => pick(entry.key)}
        onMouseEnter={() => setHoverKey(entry.key)}
      >
        <span className="acx-pdd__row-text">
          <span className="acx-pdd__row-product">{entryProduct(entry)}</span>
          <span className="acx-pdd__row-name">{entryName(entry, sets)}</span>
        </span>
      </button>
    );
  }

  return (
    <div className={`acx-pdd${open ? " acx-pdd--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="acx-pdd__trigger"
        aria-label="Precon Deck"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        Select a precon deck…
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className={`acx-pdd__pop${pos.flip ? " acx-pdd__pop--flip" : ""}`}
            style={{
              position: "fixed",
              top: pos.top,
              ...(pos.flip ? { right: pos.right ?? 0 } : { left: pos.left ?? 0 }),
            }}
          >
            <div
              className="acx-pdd__panel"
              role="listbox"
              aria-label="Precon Deck"
              style={{ maxHeight: pos.maxH }}
              onMouseLeave={() => setHoverKey(null)}
            >
              {groups.map((g) => (
                <div className="acx-pdd__rgroup" key={g.code}>
                  <div className="acx-pdd__rlogo">
                    <img src={`/images/set_${g.code}.png`} alt={`${g.code} logo`} />
                  </div>
                  <div className="acx-pdd__rdecks">{g.items.map(row)}</div>
                </div>
              ))}
            </div>
            {hovered && hoveredPreview && (
              // Owner dev review 2026-07-26: multi-leader kinds (Twin Suns
              // dual, IBH box) WIDEN the panel so every leader renders at the
              // same card size as a single-leader deck's -- single-leader
              // previews keep the compact width.
              <div
                className={`acx-pdd__preview${
                  hoveredPreview.kind === "dual" || hoveredPreview.kind === "ibh"
                    ? " acx-pdd__preview--wide"
                    : ""
                }`}
              >
                <PreconPreviewComposition preview={hoveredPreview} />
                <img
                  className="acx-pdd__preview-logo"
                  src={`/images/set_${hovered.setCode}.png`}
                  alt=""
                />
                <span className="acx-pdd__preview-product">{entryProduct(hovered)}</span>
                <span className="acx-pdd__preview-name">{entryName(hovered, sets)}</span>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
