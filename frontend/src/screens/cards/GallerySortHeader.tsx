import { SortHeaderButton } from "./SortHeaderButton";
import { CardsScopeTrigger } from "./VariantScopeControls";
import { ariaSortValue } from "../../utils/cardSort";
import type { SortColumn, SortState } from "../../utils/cardSort";

interface Props {
  /** BL-213's session-only sort state, owned by CardsPage and shared
   * verbatim with CardsTable -- there is no gallery-local copy, so switching
   * views preserves whatever sort is active (owner spec). */
  sortState: SortState;
  onSortChange: (column: SortColumn) => void;
  /** BL-173/BL-222: the SAME scope state CardsTable's Playset header hosts
   * (CardsPage's `scope`/`handleScopeChange`) -- reused here, not
   * duplicated, so engaging/clearing a scope from either view is one state
   * change both views see. */
  scope: string | null;
  onScopeChange: (raw: string | null) => void;
}

/** One entry's label + `SortHeaderButton`, `aria-sort` on the wrapping
 * element mirroring the table's own `<th aria-sort=...>` placement. */
function Entry({
  column,
  label,
  sortState,
  onSortChange,
}: {
  column: SortColumn;
  label: string;
  sortState: SortState;
  onSortChange: (column: SortColumn) => void;
}) {
  return (
    <div className="gallery-sort-header__entry" aria-sort={ariaSortValue(sortState, column)}>
      <SortHeaderButton column={column} sortState={sortState} onSortChange={onSortChange}>
        {label}
      </SortHeaderButton>
    </div>
  );
}

/** BL-222 (Issue #134): the Gallery view's own header bar -- rendered above
 * GalleryGrid whenever Gallery is the active view (CardsPage.tsx), reusing
 * CardsTable's exact `.th-sort-btn` idiom (SortHeaderButton, direction
 * triangles, `aria-sort`, the same `nextSortState` 2-state cycling CardsPage
 * already applies for the table) rather than forking it. Carries all ten of
 * CardsTable's sortable columns (# · Name · Variants · Playset · Value ·
 * Rarity · Cost · Power · HP · Set) with identical click/aria-sort
 * semantics; the five non-sortable table columns (Aspect, Type, Trait,
 * Keyword, Arena) have no gallery-visible counterpart at all, so there is
 * nothing to render for them here.
 *
 * The Playset entry additionally hosts CardsScopeTrigger (the SAME trigger/
 * menu/state the table's Playset header hosts, BL-173) -- its own
 * `vs-header-scope__trigger--on` amber treatment IS the "scoped" readout
 * this entry needs; there is no bracket to draw (owner spec: "nothing to
 * span in the gallery" -- the table's `.vs-bracket--inhead` overlay spans
 * five columns' worth of scope-driven content, which has no gallery
 * equivalent since the gallery has no columns at all). */
export function GallerySortHeader({ sortState, onSortChange, scope, onScopeChange }: Props) {
  return (
    <div className="gallery-sort-header">
      <Entry column="number" label="#" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="name" label="Name" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="variants" label="Variants" sortState={sortState} onSortChange={onSortChange} />
      <div
        className="gallery-sort-header__entry gallery-sort-header__entry--playset"
        aria-sort={ariaSortValue(sortState, "playset")}
      >
        <SortHeaderButton column="playset" sortState={sortState} onSortChange={onSortChange}>
          Playset
        </SortHeaderButton>
        <CardsScopeTrigger scope={scope} onScopeChange={onScopeChange} />
      </div>
      <Entry column="value" label="Value" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="rarity" label="Rarity" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="cost" label="Cost" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="power" label="Power" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="hp" label="HP" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="set" label="Set" sortState={sortState} onSortChange={onSortChange} />
    </div>
  );
}
