import React, { useState, useEffect, useRef, useCallback } from "react";
import { normOpt } from "../utils/filters";
import type { SelectOption } from "../utils/filters";
import { FilterMenuPortal, isInsideFilterMenuPortal } from "./FilterMenuPortal";
import { useModalDismiss } from "../hooks/useModalDismiss";
import "./FilterPanel.css";

// Generic multi-select dropdown used by FilterPanel (extracted with RR-22's
// logic/UI split). Styling lives in FilterPanel.css (`ifp-multi*` classes).

interface MultiSelectProps {
  label: string;
  values: Set<string>;
  onChange: (next: Set<string>) => void;
  options: (string | SelectOption)[];
  placeholder?: string;
  searchable?: boolean;
  /** Optional extra control rendered in the dropdown's menubar, alongside
   * All/Clear (e.g. the base/long-tail set toggle, §5.1). Purely additive —
   * existing callers that omit this prop are unaffected. */
  menubarExtra?: React.ReactNode;
  /** BL-173 review round 4 (owner): the Set field drops its "All" button —
   * selecting every value is behaviorally identical to Clear (both are the
   * unfiltered state), so one of the pair is enough and the owner kept
   * Clear. Default true: every other field keeps All untouched. */
  showAllButton?: boolean;
  /** BL-173 round 5 (owner): optional floor for the dropdown MENU's width
   * (passed through to FilterMenuPortal) — the control keeps its sidebar
   * width; only the opened results widen so long labels don't wrap. */
  menuMinWidth?: number;
}

export function MultiSelect({
  label,
  values,
  onChange,
  options,
  placeholder = "All",
  searchable = false,
  menubarExtra,
  showAllButton = true,
  menuMinWidth,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    // BL-147 fix 6: the menu now portals to document.body (FilterMenuPortal,
    // below), so it's no longer a DOM descendant of `ref` -- a click inside
    // the portaled menu must also count as "inside" here, or every item
    // click would close the dropdown out from under itself before the
    // click handler on that item ever fires.
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

  // BL-153: Escape-key dismissal only, extracted to the shared hook -- see
  // FinishFilter.tsx's identical comment for why the outside-mousedown
  // detection above stays local instead of also moving into the hook.
  const closeDropdown = useCallback(() => setOpen(false), []);
  useModalDismiss(closeDropdown, { enabled: open });

  useEffect(() => {
    if (open && searchable && searchRef.current) {
      const id = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    if (!open) setQuery("");
    return undefined;
  }, [open, searchable]);

  const norm = options.map(normOpt);
  const visible =
    !searchable || !query
      ? norm
      : norm.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  const toggle = (v: string) => {
    const next = new Set(values);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };
  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(new Set());
  };
  const selectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (searchable && query) {
      const next = new Set(values);
      visible.forEach((o) => next.add(o.value));
      onChange(next);
    } else {
      onChange(new Set(norm.map((o) => o.value)));
    }
  };

  // BL-111 dev-review wave 1 fix 3 (owner decision, ASCII preview approved):
  // the trigger text itself now carries the field's label ("Set — All sets",
  // "Set — SOR, JTL") -- the separate label row above the control is gone,
  // shortening the sidebar. Selection text is the raw *values* joined by
  // comma (not labelFor's looked-up label) -- for most fields value and
  // label are identical short strings (Rarity's "Common"/"Rare", etc.), but
  // Set's values are short codes ("SOR") while its labels are the long
  // "SOR — Spark of Rebellion" form; the compact code list is what the
  // approved preview shows, so raw values are used uniformly. "All selected"
  // reads the same as "none selected" (both are the unfiltered state),
  // matching the pre-existing summary logic this replaces.
  const isPlaceholder = values.size === 0 || values.size === norm.length;
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

        <FilterMenuPortal
          anchorRef={buttonRef}
          open={open}
          fieldLabel={label}
          minWidth={menuMinWidth}
        >
          <>
            {searchable && (
              <div className="ifp-multi__search">
                <svg width="14" height="14" viewBox="0 0 16 16" className="ifp-multi__search-icon">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" fill="none" strokeWidth="1.5" />
                  <path
                    d="M10.5 10.5l3 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder={`Search ${label.toLowerCase()}…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    className="ifp-multi__search-clear"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
            )}

            <div className="ifp-multi__menubar">
              {showAllButton && (
                <button type="button" className="ifp-multi__bar-btn" onClick={selectAll}>
                  {searchable && query ? `All matches (${visible.length})` : "All"}
                </button>
              )}
              <button
                type="button"
                className="ifp-multi__bar-btn"
                onClick={clear}
                disabled={values.size === 0}
              >
                Clear
              </button>
              {menubarExtra}
            </div>

            <div className="ifp-multi__items">
              {visible.length === 0 && <div className="ifp-multi__empty">No matches</div>}
              {visible.map(({ value, label: optLabel, inert, pinned }, i) => {
                const checked = values.has(value);
                // BL-129 R6b: divider renders between a pinned option and the
                // next one only when that next one isn't pinned -- i.e.
                // exactly at the pinned/alphabetized boundary, and only if
                // there's a "next" at all. That self-limits it to "both
                // sections non-empty": an options list that's all pinned (no
                // rest) or has no pinned entries (every field but Finish, or
                // Finish itself narrowed to just its alphabetized remainder
                // by search/facets) never satisfies this and renders none.
                const showDivider = pinned && i + 1 < visible.length && !visible[i + 1]?.pinned;
                return (
                  <React.Fragment key={value}>
                    <button
                      type="button"
                      className={`ifp-multi__item${checked ? " ifp-multi__item--on" : ""}${
                        inert ? " ifp-multi__item--inert" : ""
                      }`}
                      onClick={() => toggle(value)}
                      role="option"
                      aria-selected={checked}
                      // BL-70: an inert (0-facet) option can't be newly added
                      // -- but if it's already selected (a stale multi-select
                      // value), it stays clickable so it can still be removed.
                      disabled={inert && !checked}
                    >
                      <span className={`ifp-multi__check${checked ? " ifp-multi__check--on" : ""}`}>
                        {checked && (
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
                      <span className="ifp-multi__item-label">{optLabel}</span>
                    </button>
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
