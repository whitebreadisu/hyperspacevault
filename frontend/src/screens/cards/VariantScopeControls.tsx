import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import {
  FILTER_MENU_PORTAL_ATTR,
  isInsideFilterMenuPortal,
} from "../../components/FilterMenuPortal";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { SCOPE_EXPANDED_ROWS, SCOPE_PINNED_ROWS, scopeShortName } from "../../utils/variantScope";
import type { PriceMode, ScopeMenuRow, ValueDisplayMode } from "../../utils/variantScope";

/** BL-173 (Definition_VariantScope_2026-07-26.md §2, VariantScopeMock.jsx):
 * the Playset header's scope trigger + portaled dropdown menu, and the Value
 * header's mini Market/Low toggle. Split out of CardsTable.tsx because both
 * controls carry their own local open/position state -- keeping that out of
 * the table component keeps CardsTable's own render loop (one row per card)
 * uncluttered.
 *
 * The menu reuses the `ifp-multi__menu`/`ifp-multi__menu--portal`/
 * `ifp-multi__items`/`ifp-multi__pin-divider` shell classes for chrome
 * (FilterPanel.css) but is NOT rendered through FilterMenuPortal --that
 * component pins the menu's width to its trigger button's own measured
 * width (built for MultiSelect/FinishFilter's full-width sidebar fields);
 * this header trigger is a small compact chip, and the mock's own locked
 * menu width is a fixed 300px anchored under (and, near the viewport edge,
 * clamped leftward of) the trigger -- see ScopeMenuPortal below, a
 * purpose-built sibling using the exact same createPortal/getBoundingClientRect
 * technique. It still stamps FILTER_MENU_PORTAL_ATTR so FilterPanel's own
 * outside-click collapse (and any other consumer of isInsideFilterMenuPortal)
 * correctly treats a click inside this menu as "still interacting with a
 * filter-shaped control," exactly like the sidebar's own dropdowns. */

function ScopeMenuPortal({
  anchorRef,
  open,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: React.ReactNode;
}) {
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Mirrors the mock's HeaderScope: clamp the fixed-width menu so it
      // never hangs off the right edge of the viewport near a right-docked
      // trigger. 316 = 300px menu + a small breathing margin.
      setRect({ left: Math.min(r.left, window.innerWidth - 316), top: r.bottom + 5 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  if (!open || !rect) return null;

  return createPortal(
    <div
      className="ifp-multi__menu ifp-multi__menu--portal vs-scope-menu"
      role="listbox"
      {...{ [FILTER_MENU_PORTAL_ATTR]: "true" }}
      style={{ position: "fixed", left: rect.left, top: rect.top, width: 300 }}
    >
      {children}
    </div>,
    document.body
  );
}

/* Round 4 (owner): the menu adopts the FinishFilter's OWN control anatomy --
 * square ifp-finish-pair chips, ifp-multi__item rows with the checkbox
 * glyph, ifp-finish-group expander -- so the scope picker and the sidebar's
 * Finish filter read as the same family of control (FilterPanel.css owns
 * all of that styling; the vs-scope-menu__* names retained below are
 * structural hooks for tests/width only, no longer look-and-feel). */

/** Same check glyph FinishFilter renders (its Check is module-private). */
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

function ScopeChips({
  chips,
  scope,
  onPick,
}: {
  chips: { rawValue: string; label: string }[];
  scope: string | null;
  onPick: (raw: string) => void;
}) {
  return (
    <span className="ifp-finish-pair__chips">
      {chips.map((chip) => (
        <button
          key={chip.rawValue}
          type="button"
          className={`ifp-finish-pair__chip${
            scope === chip.rawValue ? " ifp-finish-pair__chip--on" : ""
          }`}
          aria-pressed={scope === chip.rawValue}
          onClick={() => onPick(chip.rawValue)}
        >
          {chip.label}
        </button>
      ))}
    </span>
  );
}

function ScopeRow({
  row,
  scope,
  onPick,
}: {
  row: ScopeMenuRow;
  scope: string | null;
  onPick: (raw: string) => void;
}) {
  if (row.kind === "plain") {
    const active = scope === row.rawValue;
    return (
      <button
        type="button"
        className={`ifp-multi__item${active ? " ifp-multi__item--on" : ""}`}
        role="option"
        aria-selected={active}
        onClick={() => onPick(row.rawValue)}
      >
        <Check on={active} />
        <span className="ifp-multi__item-label vs-scope-menu__row-label">{row.label}</span>
        {row.note && <span className="vs-scope-menu__row-note">{row.note}</span>}
      </button>
    );
  }
  return (
    <div className="ifp-finish-pair vs-scope-menu__row--chips">
      <span className="ifp-finish-pair__label vs-scope-menu__row-label">{row.label}</span>
      <ScopeChips chips={row.chips} scope={scope} onPick={onPick} />
    </div>
  );
}

function ScopeMenuContent({
  scope,
  onPick,
}: {
  scope: string | null;
  onPick: (raw: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  return (
    <>
      {/* Round 4 (owner): "All finishes" is a MENUBAR BUTTON, exactly like
          the sidebar filter's own All/Clear bar -- not a checkbox row.
          Disabled when already unscoped (it acts as this menu's Clear). */}
      <div className="ifp-multi__menubar">
        <button
          type="button"
          className="ifp-multi__bar-btn"
          onClick={() => onPick(null)}
          disabled={scope === null}
        >
          All finishes
        </button>
      </div>
      <div className="ifp-multi__items vs-scope-menu__items">
        {SCOPE_PINNED_ROWS.map((row) => (
          <ScopeRow key={row.key} row={row} scope={scope} onPick={onPick} />
        ))}
        <div className="ifp-multi__pin-divider" role="presentation" />
        <button
          type="button"
          className="ifp-finish-group__header vs-scope-menu__expander"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
        >
          <svg
            className={`ifp-finish-group__chevron${showAll ? " ifp-finish-group__chevron--open" : ""}`}
            width="8"
            height="8"
            viewBox="0 0 10 6"
            aria-hidden="true"
          >
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="ifp-finish-group__label">
            {showAll ? "Hide extra finishes" : "Show all finishes…"}
          </span>
        </button>
        {showAll &&
          SCOPE_EXPANDED_ROWS.map((row) => (
            <ScopeRow key={row.key} row={row} scope={scope} onPick={onPick} />
          ))}
      </div>
    </>
  );
}

interface CardsScopeTriggerProps {
  scope: string | null;
  onScopeChange: (raw: string | null) => void;
}

/** The Playset header's own trigger -- "ALL VARIANTS" / "PIPS · <finish>",
 * amber-bordered when scoped (Definition §2). IS the dropdown trigger
 * (matches the mock's HeaderScope, not the toolbar-oriented ScopeControl
 * variant, which isn't built -- Definition §2's owner-locked placement is
 * "column headers" only). */
export function CardsScopeTrigger({ scope, onScopeChange }: CardsScopeTriggerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => setOpen(false), []);
  useModalDismiss(closeMenu, { enabled: open });

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        !isInsideFilterMenuPortal(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const pick = (raw: string | null) => {
    onScopeChange(raw);
    setOpen(false);
  };

  // Round 4 (owner): "ALL FINISHES" -- normalized with the sidebar Finish
  // filter's vocabulary and the menu's own "All finishes" row.
  const label = scope ? `PIPS · ${scopeShortName(scope)}` : "ALL FINISHES";

  return (
    <span className="vs-header-scope">
      <button
        ref={buttonRef}
        type="button"
        className={`vs-header-scope__trigger${scope ? " vs-header-scope__trigger--on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Scope pips + Value to a single variant"
      >
        <span>{label}</span>
        <svg width="8" height="5" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
      <ScopeMenuPortal anchorRef={buttonRef} open={open}>
        <ScopeMenuContent scope={scope} onPick={pick} />
      </ScopeMenuPortal>
    </span>
  );
}

interface CardsValueDisplayToggleProps {
  mode: ValueDisplayMode;
  onChange: (mode: ValueDisplayMode) => void;
}

/** Shared track-and-thumb switch (owner-dialed across the 2026-07-31 local
 * round): shows only the ACTIVE state's label INSIDE the track; each click
 * flips to the other state. `large` is the UNIT/COLLECTION size (label
 * matches the th's own 11px type); the default small size fits the MKT/LOW
 * uses. EXPORTED for every Market/Low site (Value header, completion
 * panel's value block, CardPopup rail) so the control reads identically
 * app-wide. */
export function ValueSwitch({
  checked,
  label,
  ariaLabel,
  title,
  large,
  onToggle,
}: {
  checked: boolean;
  label: string;
  ariaLabel: string;
  title: string;
  large?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      className={`vs-value-switch${checked ? " vs-value-switch--on" : ""}${
        large ? " vs-value-switch--lg" : ""
      }`}
      onClick={onToggle}
    >
      <span className="vs-value-switch__track">
        <span className="vs-value-switch__thumb" aria-hidden="true" />
        <span className="vs-value-switch__label">{label}</span>
      </span>
    </button>
  );
}

/** The Value header's Unit/Total switch. UNIT = one copy's price (original
 * semantics); TOTAL = the viewer's owned copies' value (cardCollectionValue
 * -- the internal mode value stays "collection", only the visible
 * vocabulary is TOTAL). Sits ABOVE the "Value" label at the large size. */
export function CardsValueDisplayToggle({ mode, onChange }: CardsValueDisplayToggleProps) {
  const isTotal = mode === "collection";
  return (
    <ValueSwitch
      checked={isTotal}
      large
      label={isTotal ? "COLLECTION" : "UNIT"}
      ariaLabel={
        isTotal ? "Showing total value — switch to unit" : "Showing unit value — switch to total"
      }
      title={
        isTotal
          ? "Total value — what your owned copies are worth. Click for unit price."
          : "Unit value — price of one copy. Click for your owned copies' total."
      }
      onToggle={() => onChange(isTotal ? "unit" : "collection")}
    />
  );
}

interface CardsValueKindToggleProps {
  kind: PriceMode;
  onChange: (kind: PriceMode) => void;
}

/** The Value header's Market/Low control (Definition §1/§2; owner-dialed
 * 2026-07-31: same single-label SWITCH idiom as UNIT/TOTAL, at the small
 * size, sitting RIGHT of the "Value" label). MKT is the unchecked side. */
export function CardsValueKindToggle({ kind, onChange }: CardsValueKindToggleProps) {
  const isLow = kind === "low";
  return (
    <ValueSwitch
      checked={isLow}
      label={isLow ? "LOW" : "MARKET"}
      ariaLabel={
        isLow ? "Showing low price — switch to market" : "Showing market price — switch to low"
      }
      title={
        isLow
          ? "Low price — cheapest listing. Click for market price."
          : "Market price — TCGplayer market average. Click for low price."
      }
      onToggle={() => onChange(isLow ? "market" : "low")}
    />
  );
}
