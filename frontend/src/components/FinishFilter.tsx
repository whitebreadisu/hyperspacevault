import React, { useState, useEffect, useRef, useCallback } from "react";
import { shapeFinishTree } from "../utils/filters";
import type { FinishTreeRow, ShapedFinishRow } from "../utils/filters";
import { FilterMenuPortal, isInsideFilterMenuPortal } from "./FilterMenuPortal";
import { useModalDismiss } from "../hooks/useModalDismiss";
import "./FilterPanel.css";

// BL-133 (issue #318): the Finish field's dedicated dropdown -- a two-tier
// tree (fused foil/non-foil pair rows, expandable tournament/prestige
// groups, plain rows) replacing the flat MultiSelect Finish previously used.
// This is presentation-tier ONLY: FilterState.finish stays a flat
// Set<string> of raw values (see utils/filters.ts's FilterState doc), every
// control here just adds/removes a raw value string from that Set via
// `onChange` -- the state-model invariant BL-133's brief locks in. The
// grouping/pairing/ordering RULES live in utils/filters.ts
// (buildFinishTree/shapeFinishTree); this component only renders the
// already-shaped rows and owns the local expand/collapse + open/close UI
// state.
//
// Deliberately NOT a generalization of MultiSelect.tsx -- the pair-chip and
// expandable-group interactions are Finish-specific (per the locked design)
// and every other field's dropdown (Set/Rarity/Type/Arenas/Keywords/Traits)
// stays on the untouched flat MultiSelect, so this file reuses MultiSelect's
// shell classes (`ifp-multi*`, defined in FilterPanel.css) for visual
// consistency without touching that component or its other callers.

interface FinishFilterProps {
  label: string;
  values: Set<string>;
  onChange: (next: Set<string>) => void;
  tree: FinishTreeRow[];
  valid: Set<string> | null;
  showAllValues: boolean;
  placeholder?: string;
}

export function FinishFilter({
  label,
  values,
  onChange,
  tree,
  valid,
  showAllValues,
  placeholder = "All",
}: FinishFilterProps) {
  const [open, setOpen] = useState(false);
  // BL-133 open question (Jeremy's brief left this open, "record what you
  // do"): expand/collapse state is UI-local and resets to all-collapsed
  // every time the dropdown closes/reopens, rather than persisting across
  // opens. Simplest option, and it means a group can never appear
  // already-expanded from a stale previous interaction, which would read as
  // a bug ("why is this open, I didn't click it").
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    // BL-147 fix 6: the menu now portals to document.body (FilterMenuPortal,
    // below), so it's no longer a DOM descendant of `ref` -- a click inside
    // the portaled menu must also count as "inside" here, or every row/
    // group click would close the dropdown out from under itself first.
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) && !isInsideFilterMenuPortal(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
    };
  }, [open]);

  // BL-153: Escape-key dismissal only, extracted to the shared hook --
  // `enabled: open` reproduces the original effect's `if (!open) return`
  // early-out (listener only attached while the dropdown is open). The
  // outside-mousedown detection above stays local -- it's a different
  // mechanism (portal-aware ref check), not part of the hook's scope.
  const closeDropdown = useCallback(() => setOpen(false), []);
  useModalDismiss(closeDropdown, { enabled: open });

  useEffect(() => {
    if (!open) setExpanded(new Set());
  }, [open]);

  const toggleValue = (v: string) => {
    const next = new Set(values);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(new Set());
  };

  const selectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const out: string[] = [];
    tree.forEach((row) => {
      if (row.kind === "plain") out.push(row.value);
      else if (row.kind === "pair") out.push(row.baseValue, row.foilValue);
      else row.children.forEach((c) => out.push(c.value));
    });
    onChange(new Set(out));
  };

  const rows = shapeFinishTree(tree, valid, values, showAllValues);

  // Same trigger convention as MultiSelect (BL-111 wave 1 fix 3): the
  // field's label lives in the trigger button's own text, "Finish — <sel>".
  const isPlaceholder = values.size === 0;
  const selectionText = isPlaceholder ? placeholder : [...values].join(", ");
  const triggerText = `${label} — ${selectionText}`;

  return (
    <div className="ifp-field" ref={ref}>
      <div className={`ifp-multi${open ? " ifp-multi--open" : ""}`}>
        <button
          ref={buttonRef}
          type="button"
          className="ifp-multi__button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={triggerText}
        >
          <span
            className={`ifp-multi__trigger ${isPlaceholder ? "ifp-multi__placeholder" : "ifp-multi__value"}`}
          >
            {triggerText}
          </span>
          <svg className="ifp-chevron" width="10" height="6" viewBox="0 0 10 6">
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* BL-173 review round 4: minWidth so the Prestige chip row (label +
            Std/Foil/Serialized) fits on one line -- the sidebar control's own
            width is unchanged, only the portaled menu widens. */}
        <FilterMenuPortal
          anchorRef={buttonRef}
          open={open}
          fieldLabel={label}
          minWidth={320}
          onHoverDismiss={closeDropdown}
        >
          <>
            <div className="ifp-multi__menubar">
              <button type="button" className="ifp-multi__bar-btn" onClick={selectAll}>
                All
              </button>
              <button
                type="button"
                className="ifp-multi__bar-btn"
                onClick={clear}
                disabled={values.size === 0}
              >
                Clear
              </button>
            </div>

            <div className="ifp-multi__items">
              {rows.length === 0 && <div className="ifp-multi__empty">No matches</div>}
              {rows.map((row, i) => {
                // Same self-limiting divider rule MultiSelect used for the
                // old flat Finish list (BL-129 R6b): renders only between a
                // pinned row and a following non-pinned row, so an
                // all-pinned or all-unpinned rendered set never shows one.
                const showDivider = row.pinned && i + 1 < rows.length && !rows[i + 1]?.pinned;
                return (
                  <React.Fragment key={row.key}>
                    <FinishRowView
                      row={row}
                      expanded={expanded}
                      onToggleValue={toggleValue}
                      onToggleExpanded={toggleExpanded}
                    />
                    {showDivider && <div className="ifp-multi__pin-divider" role="presentation" />}
                  </React.Fragment>
                );
              })}
            </div>
          </>
        </FilterMenuPortal>
      </div>
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span className={`ifp-multi__check${on ? " ifp-multi__check--on" : ""}`}>
      {on && (
        <svg width="10" height="8" viewBox="0 0 10 8">
          <path
            d="M1 4l3 3 5-6"
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

function FinishRowView({
  row,
  expanded,
  onToggleValue,
  onToggleExpanded,
}: {
  row: ShapedFinishRow;
  expanded: Set<string>;
  onToggleValue: (v: string) => void;
  onToggleExpanded: (key: string) => void;
}) {
  if (row.kind === "plain") {
    return (
      <button
        type="button"
        className={`ifp-multi__item${row.checked ? " ifp-multi__item--on" : ""}${
          row.inert ? " ifp-multi__item--inert" : ""
        }`}
        onClick={() => onToggleValue(row.value)}
        role="option"
        aria-selected={row.checked}
        // BL-70 parity: an inert (0-facet), unselected row can't be newly
        // added -- but if it's already selected, it stays clickable so it
        // can still be removed.
        disabled={row.inert && !row.checked}
      >
        <Check on={row.checked} />
        <span className="ifp-multi__item-label">{row.inert ? `${row.label} (0)` : row.label}</span>
      </button>
    );
  }

  if (row.kind === "pair") {
    // Variant B (Jeremy's pick): one row, label + two independently
    // toggleable chips. Chip visible text is the generic "Non-foil"/"Foil"
    // -- the row's own label supplies the finish name (e.g. "Standard"), so
    // the pair reads as "Standard: [Non-foil] [Foil]" rather than repeating
    // the finish name on each chip.
    return (
      <div className="ifp-finish-pair">
        <span className="ifp-finish-pair__label">{row.label}</span>
        <div className="ifp-finish-pair__chips">
          {row.base && (
            <button
              type="button"
              className={`ifp-finish-pair__chip${
                row.base.checked ? " ifp-finish-pair__chip--on" : ""
              }${row.base.inert ? " ifp-finish-pair__chip--inert" : ""}`}
              aria-pressed={row.base.checked}
              aria-label={row.base.inert ? `${row.base.value} (0)` : row.base.value}
              disabled={row.base.inert && !row.base.checked}
              onClick={() => onToggleValue(row.base!.value)}
            >
              Non-foil
            </button>
          )}
          {row.foil && (
            <button
              type="button"
              className={`ifp-finish-pair__chip${
                row.foil.checked ? " ifp-finish-pair__chip--on" : ""
              }${row.foil.inert ? " ifp-finish-pair__chip--inert" : ""}`}
              aria-pressed={row.foil.checked}
              aria-label={row.foil.inert ? `${row.foil.value} (0)` : row.foil.value}
              disabled={row.foil.inert && !row.foil.checked}
              onClick={() => onToggleValue(row.foil!.value)}
            >
              Foil
            </button>
          )}
        </div>
      </div>
    );
  }

  // BL-173 review round 4 (owner, 2026-07-27): the Prestige family renders
  // as a CHIP row (like the foil pairs above), not an expandable group --
  // normalizing it with the Playset header's scope picker, which offers
  // Prestige as chips. Presentation-tier rule ONLY: the tree still models
  // Prestige as a "group" (buildFinishTree unchanged, FilterState.finish
  // untouched), and the tournament families keep the expandable-group
  // rendering below. "Standard" shortens to "Std" on the chip face (width;
  // matches the scope picker); the accessible name stays the full raw value.
  if (row.kind === "group" && row.key === "Prestige") {
    return (
      <div className={`ifp-finish-pair${row.allInert ? " ifp-finish-group--inert" : ""}`}>
        <span className="ifp-finish-pair__label">{row.label}</span>
        <div className="ifp-finish-pair__chips">
          {row.children.map((child) => (
            <button
              key={child.value}
              type="button"
              className={`ifp-finish-pair__chip${child.checked ? " ifp-finish-pair__chip--on" : ""}${
                child.inert ? " ifp-finish-pair__chip--inert" : ""
              }`}
              aria-pressed={child.checked}
              aria-label={child.inert ? `${child.value} (0)` : child.value}
              disabled={child.inert && !child.checked}
              onClick={() => onToggleValue(child.value)}
            >
              {child.displayLabel === "Standard" ? "Std" : child.displayLabel}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // group
  const isOpen = expanded.has(row.key);
  const showBadge = !isOpen && row.selectedCount > 0;
  return (
    <div className={`ifp-finish-group${row.allInert ? " ifp-finish-group--inert" : ""}`}>
      <button
        type="button"
        className={`ifp-finish-group__header${
          showBadge ? " ifp-finish-group__header--selected" : ""
        }`}
        aria-expanded={isOpen}
        // Parent click toggles expand/collapse ONLY -- it never selects
        // anything (Jeremy's brief). Works by click, no hover dependency.
        onClick={() => onToggleExpanded(row.key)}
      >
        <svg
          className={`ifp-finish-group__chevron${isOpen ? " ifp-finish-group__chevron--open" : ""}`}
          width="8"
          height="8"
          viewBox="0 0 10 6"
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="currentColor"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="ifp-finish-group__label">{row.label}</span>
        {showBadge && <span className="ifp-finish-group__badge">· {row.selectedCount}</span>}
      </button>
      {isOpen && (
        <div className="ifp-finish-group__children">
          {row.children.map((child) => (
            <button
              key={child.value}
              type="button"
              className={`ifp-multi__item ifp-multi__item--child${
                child.checked ? " ifp-multi__item--on" : ""
              }${child.inert ? " ifp-multi__item--inert" : ""}`}
              role="option"
              aria-selected={child.checked}
              // Accessibility (brief): display text is prefix/suffix-
              // stripped ("Top 8"), but the accessible name stays the full
              // raw value ("PQ Top 8") so screen-reader users get the
              // disambiguated name even though the visible label doesn't
              // repeat the group's prefix.
              aria-label={child.inert ? `${child.value} (0)` : child.value}
              disabled={child.inert && !child.checked}
              onClick={() => onToggleValue(child.value)}
            >
              <Check on={child.checked} />
              <span className="ifp-multi__item-label">
                {child.inert ? `${child.displayLabel} (0)` : child.displayLabel}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
