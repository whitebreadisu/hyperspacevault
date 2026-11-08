import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NUMBER_SORT_CHOICES, STASH_SORT_LABELS } from "../../stashes/stashContents";
import type { StashSort, StashSortColumn } from "../../stashes/stashContents";
import "../../components/FilterPanel.css";

// The Stashes page's sort controls (R1-15 / R1-16), desktop. Built from the
// Vault's own pieces: the `.th-sort-btn` header button (direction as a CSS
// triangle, cards.css), the gallery's `.gallery-sort-header` bar and the
// filter dropdown's `.ifp-multi__menu` list for the Set | # choice. Set | #
// is one entry with a secondary choice -- base card number (default: a
// card's printings sit together) or the printing's own card number; picking
// the active one flips its direction, as a header click does. Only one
// Set | # menu is open at a time (the table header's and the sort bar's).

/** "ascending" / "descending": the active sort's direction, spoken (the
 * th-sort-btn triangle shows it). */
function dirWord(sort: StashSort): string {
  return sort.direction === "asc" ? "ascending" : "descending";
}

/** Opening one Set | # menu tells the others to close. */
const MENU_OPEN = "sp-numsort-open";

export function ariaSort(sort: StashSort, cols: StashSortColumn[]) {
  if (!cols.includes(sort.column)) return undefined;
  return sort.direction === "asc" ? ("ascending" as const) : ("descending" as const);
}

/** The Vault's `.th-sort-btn` markup (SortHeaderButton) for a stash column. */
export function StashSortButton({
  active,
  sort,
  onClick,
  children,
  ...rest
}: {
  active: boolean;
  sort: StashSort;
  onClick: () => void;
  children: ReactNode;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
  "aria-pressed"?: boolean;
  "aria-current"?: "true";
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      className={"th-sort-btn" + (active ? ` th-sort-btn--${sort.direction}` : "")}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

/** "Set | #" with its base / card-number choice. */
export function NumberSortChoice({
  sort,
  onSort,
}: {
  sort: StashSort;
  onSort: (column: StashSortColumn) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    const other = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener(MENU_OPEN, other);
    return () => window.removeEventListener(MENU_OPEN, other);
  }, [id]);
  const toggle = () => {
    // Tell the other Set | # menu to close before this one opens (in the
    // handler, never inside a state updater).
    if (!open) window.dispatchEvent(new CustomEvent(MENU_OPEN, { detail: id }));
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const active = sort.column === "base" || sort.column === "number";
  return (
    <span className="sp-numsort" ref={ref}>
      <StashSortButton
        active={active}
        sort={sort}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={active ? "true" : undefined}
        aria-label={
          active
            ? `Set | #, sorted by ${sort.column === "base" ? "base card number" : "card number"}, ${dirWord(sort)}`
            : undefined
        }
      >
        Set | #
      </StashSortButton>
      {active ? (
        <span className="sp-numsort__by">{sort.column === "base" ? "Base" : "Card"}</span>
      ) : null}
      {open ? (
        <div className="ifp-multi__menu sp-numsort__menu" role="menu" aria-label="Sort Set | # by">
          <div className="ifp-multi__items">
            {NUMBER_SORT_CHOICES.map((c) => {
              const on = sort.column === c.column;
              return (
                <button
                  key={c.column}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  className={"ifp-multi__item" + (on ? " ifp-multi__item--on" : "")}
                  onClick={() => {
                    setOpen(false);
                    onSort(c.column);
                  }}
                >
                  <span className="ifp-multi__item-label">{c.label}</span>
                  {on ? (
                    <span className="sp-numsort__dir">
                      {sort.direction === "asc" ? "Ascending" : "Descending"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </span>
  );
}

const BAR: StashSortColumn[] = ["name", "value", "qty", "rarity", "recent"];

/** The sort bar over the stash list (the Vault gallery's sort header):
 * Set | # (base / card number), Name, Value, Copies in stash, Rarity,
 * Recently stashed. */
export function StashSortBar({
  sort,
  onSort,
}: {
  sort: StashSort;
  onSort: (column: StashSortColumn) => void;
}) {
  return (
    <div className="gallery-sort-header sp-sortbar" role="group" aria-label="Sort">
      {/* The active entry is marked on its button (aria-pressed / aria-current
          on the menu trigger) and its name says the direction, which the
          th-sort-btn triangle shows; aria-sort belongs to column headers
          only. */}
      <div className="gallery-sort-header__entry">
        <NumberSortChoice sort={sort} onSort={onSort} />
      </div>
      {BAR.map((col) => (
        <div key={col} className="gallery-sort-header__entry">
          <StashSortButton
            active={sort.column === col}
            sort={sort}
            onClick={() => onSort(col)}
            aria-pressed={sort.column === col}
            aria-label={
              sort.column === col
                ? `Sort by ${STASH_SORT_LABELS[col]}, ${dirWord(sort)}`
                : `Sort by ${STASH_SORT_LABELS[col]}`
            }
          >
            {STASH_SORT_LABELS[col]}
          </StashSortButton>
        </div>
      ))}
    </div>
  );
}
