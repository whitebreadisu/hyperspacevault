import type { ReactNode } from "react";
import type { SortColumn, SortState } from "../../utils/cardSort";

interface Props {
  column: SortColumn;
  sortState: SortState;
  onSortChange: (column: SortColumn) => void;
  /** An extra class layered onto the base `.th-sort-btn` string, e.g. the
   * Playset/Value labels' `th-playset-label` / `th-value-label`. */
  className?: string;
  children: ReactNode;
}

/** The sortable header button shared by CardsTable's `<th>`s and the Gallery
 * sort header (GallerySortHeader.tsx), so both render the same `.th-sort-btn`
 * markup and 2-state cycling. Pure presentation: the click cycling rule (a
 * different column always lands ascending, the already-active column toggles
 * asc<->desc) lives in `nextSortState` (utils/cardSort.ts) and is CardsPage's
 * job to apply on the way into `onSortChange`; this component only reports
 * which column was clicked. The direction indicator is CSS generated content
 * off the `th-sort-btn--asc`/`--desc` modifier class (cards.css's
 * `.th-sort-btn` rule), so it never changes the button's textContent or
 * accessible name. */
export function SortHeaderButton({ column, sortState, onSortChange, className, children }: Props) {
  const active = sortState.column === column;
  const cls = `th-sort-btn${active ? ` th-sort-btn--${sortState.direction}` : ""}${
    className ? ` ${className}` : ""
  }`;
  return (
    <button type="button" className={cls} onClick={() => onSortChange(column)}>
      {children}
    </button>
  );
}
