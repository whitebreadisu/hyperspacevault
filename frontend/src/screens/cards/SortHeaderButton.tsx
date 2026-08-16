import type { ReactNode } from "react";
import type { SortColumn, SortState } from "../../utils/cardSort";

interface Props {
  column: SortColumn;
  sortState: SortState;
  onSortChange: (column: SortColumn) => void;
  /** An extra class layered onto the base `.th-sort-btn` string -- the same
   * role CardsTable's own (retired) local `sortBtnClass` helper served for
   * the Playset/Value labels (`th-playset-label`/`th-value-label`). */
  className?: string;
  children: ReactNode;
}

/** BL-222 (Issue #134): the sortable header button CardsTable's `<th>`s use
 * (BL-213, Issue #122) -- extracted here so the new Gallery sort header
 * (GallerySortHeader.tsx) can share the EXACT same `.th-sort-btn` markup and
 * 2-state cycling instead of forking it. Pure presentation: the click
 * cycling rule itself (a different column always lands ascending, the
 * already-active column toggles asc<->desc) lives in `nextSortState`
 * (utils/cardSort.ts) and is CardsPage's job to apply on the way into
 * `onSortChange` -- this component only ever reports which column was
 * clicked. The direction indicator is CSS generated content off the
 * `th-sort-btn--asc`/`--desc` modifier class (cards.css's `.th-sort-btn`
 * rule), so it never changes the button's textContent/accessible name --
 * same rationale CardsTable's original inline version documented. */
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
