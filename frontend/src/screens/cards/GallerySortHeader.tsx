import { SortHeaderButton } from "./SortHeaderButton";
import {
  CardsScopeTrigger,
  CardsValueDisplayToggle,
  CardsValueKindToggle,
} from "./VariantScopeControls";
import { ariaSortValue } from "../../utils/cardSort";
import type { SortColumn, SortState } from "../../utils/cardSort";
import { scopeShortName } from "../../utils/variantScope";
import type { PriceMode, ValueDisplayMode } from "../../utils/variantScope";

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
  /** BL-225: full table-header parity -- the SAME Unit/Collection and
   * Market/Low state the table's Value header drives (CardsPage's
   * `valueDisplay`/`priceKind`), hosted inline right of the Value entry. */
  valueDisplay: ValueDisplayMode;
  onValueDisplayChange: (mode: ValueDisplayMode) => void;
  priceKind: PriceMode;
  onPriceKindChange: (kind: PriceMode) => void;
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
export function GallerySortHeader({
  sortState,
  onSortChange,
  scope,
  onScopeChange,
  valueDisplay,
  onValueDisplayChange,
  priceKind,
  onPriceKindChange,
}: Props) {
  /* BL-225: while a finish scope is active, the scope-driven entries (#,
   * Value + its switches) join the table header's amber vocabulary --
   * `.th-cardnum-scoped` / `.th-scoped` label rules, mirrored by the
   * `--scoped` modifier (cards.css). Text-only, matching the table's final
   * owner-dialed treatment (BL-194: color, no chip/wash). */
  const scopedClass = scope ? " gallery-sort-header__entry--scoped" : "";
  return (
    <div className={`gallery-sort-header${scope ? " gallery-sort-header--scoped" : ""}`}>
      {/* BL-225 round 2 (owner): the scope-driven span (# through Value,
          crossing Name/Variants on the way -- same as the table) lives in
          its own group so the amber bracket can overlay it while scoped,
          mirroring the table's .vs-bracket--inhead without any measurement:
          the group's own width IS the span. */}
      <div
        className={`gallery-sort-header__group${
          scope ? " gallery-sort-header__group--scoped" : ""
        }`}
      >
        {scope && (
          <span className="vs-bracket gallery-sort-header__bracket" aria-hidden="true">
            <span className="vs-bracket__label">
              {scopeShortName(scope)} - CARD # + PIPS + VALUE
            </span>
          </span>
        )}
        <div
          className={`gallery-sort-header__entry${scopedClass}`}
          aria-sort={ariaSortValue(sortState, "number")}
        >
          <SortHeaderButton column="number" sortState={sortState} onSortChange={onSortChange}>
            #
          </SortHeaderButton>
        </div>
        <Entry column="name" label="Name" sortState={sortState} onSortChange={onSortChange} />
        <Entry
          column="variants"
          label="Variants"
          sortState={sortState}
          onSortChange={onSortChange}
        />
        <div
          className={`gallery-sort-header__entry gallery-sort-header__entry--playset${scopedClass}`}
          aria-sort={ariaSortValue(sortState, "playset")}
        >
          <SortHeaderButton column="playset" sortState={sortState} onSortChange={onSortChange}>
            Playset
          </SortHeaderButton>
          <CardsScopeTrigger scope={scope} onScopeChange={onScopeChange} />
        </div>
        {/* BL-225 (owner: "emulate the table header completely"): the Value
            entry hosts the same two switches as the table's Value column --
            UNIT/COLLECTION then MKT/LOW (both large; owner round 2) --
            inline to the label's right, driving the SAME CardsPage state as
            the table. Owner round 6: the gallery has no price surface, so
            the switches' only in-gallery effect is a Value sort's ordering
            -- they render ONLY while Value is the active sort. */}
        <div
          className={`gallery-sort-header__entry gallery-sort-header__entry--value${scopedClass}`}
          aria-sort={ariaSortValue(sortState, "value")}
        >
          <SortHeaderButton column="value" sortState={sortState} onSortChange={onSortChange}>
            Value
          </SortHeaderButton>
          {sortState.column === "value" && (
            <>
              <CardsValueDisplayToggle mode={valueDisplay} onChange={onValueDisplayChange} />
              <CardsValueKindToggle kind={priceKind} onChange={onPriceKindChange} large />
            </>
          )}
        </div>
      </div>
      <Entry column="rarity" label="Rarity" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="cost" label="Cost" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="power" label="Power" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="hp" label="HP" sortState={sortState} onSortChange={onSortChange} />
      <Entry column="set" label="Set" sortState={sortState} onSortChange={onSortChange} />
    </div>
  );
}
