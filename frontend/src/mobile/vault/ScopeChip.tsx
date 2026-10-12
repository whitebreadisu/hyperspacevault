import { useState } from "react";
import { SCOPE_EXPANDED_ROWS, SCOPE_PINNED_ROWS, scopeShortName } from "../../utils/variantScope";
import type { ScopeChip as ScopeChipValue, ScopeMenuRow } from "../../utils/variantScope";
import { MIcon } from "../icons";
import { Sheet, useSheetClose } from "../Sheet";

// BL-247 S1-16: the finish scope (rev4 MScope.jsx; desktop
// VariantScopeControls + utils/variantScope.ts). The status-row chip reads
// "All finishes" unscoped and, scoped, the amber pips glyph + desktop's short
// name ("HS Foil"). It opens the scope menu as a sheet: "All finishes" (inert
// while unscoped), desktop's pinned rows (SCOPE_PINNED_ROWS), a divider, then
// "Show all finishes…" for SCOPE_EXPANDED_ROWS. A pick closes the menu
// (desktop). The scope itself writes the Finish facet (vaultModel.withScope).
// The last pinned row is Showcase (BL-259): a one-value row drawn with one
// chip (the menu's single-select idiom), not the tail's check-box row.

export const UNSCOPED_LABEL = "All finishes";

/** Three amber pips: "pips read through a scope". */
function PipsGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="m-pipsglyph"
      width={size + 6}
      height={size}
      viewBox="0 0 20 14"
      aria-hidden="true"
    >
      <circle cx="3.5" cy="7" r="2.6" fill="currentColor" />
      <circle cx="10" cy="7" r="2.6" fill="currentColor" />
      <circle cx="16.5" cy="7" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function ScopeChip({ scope, onOpen }: { scope: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={"m-scopechip" + (scope ? " m-scopechip--on" : "")}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={
        scope ? `Finish scope: ${scope}. Change` : "Finish scope: all finishes. Choose a finish"
      }
    >
      {scope ? <PipsGlyph /> : null}
      <span className="m-scopechip__t">{scope ? scopeShortName(scope) : UNSCOPED_LABEL}</span>
      <MIcon name="chevdown" size={14} className="m-scopechip__chev" />
    </button>
  );
}

/** One line of visible fine print (desktop's trigger title says "Scope pips
 * + Value to a single variant"). */
const SCOPE_MEANING = "Pips, number, price and art read through one finish.";

function rawOf(row: ScopeMenuRow): string[] {
  return row.kind === "plain" ? [row.rawValue] : row.chips.map((c) => c.rawValue);
}

function ScopeMenu({
  scope,
  onPick,
}: {
  scope: string | null;
  onPick: (raw: string | null) => void;
}) {
  const close = useSheetClose();
  // A selected value is never hidden: an expanded-only scope opens the tail.
  const [all, setAll] = useState(
    scope != null && SCOPE_EXPANDED_ROWS.some((r) => rawOf(r).includes(scope))
  );
  const pick = (raw: string | null) => {
    onPick(raw);
    close();
  };
  const chip = (c: ScopeChipValue) => (
    <button
      key={c.rawValue}
      type="button"
      className={"m-chip m-ffin__chip" + (scope === c.rawValue ? " m-chip--on" : "")}
      aria-pressed={scope === c.rawValue}
      aria-label={c.rawValue}
      data-scope={c.rawValue}
      onClick={() => pick(c.rawValue)}
    >
      {c.label}
    </button>
  );
  return (
    <div className="m-scopemenu" role="group" aria-label="Finish scope">
      <div className="m-scopemenu__bar">
        <button
          type="button"
          className="m-flink m-scopemenu__all"
          disabled={!scope}
          onClick={() => pick(null)}
        >
          {UNSCOPED_LABEL}
        </button>
      </div>
      <div className="m-ftree">
        {SCOPE_PINNED_ROWS.map((r) =>
          r.kind === "plain" ? null : (
            <div
              key={r.key}
              className={
                "m-ffin " +
                (r.kind === "group"
                  ? "m-ffin--prestige"
                  : r.kind === "single"
                    ? "m-ffin--pair m-ffin--single"
                    : "m-ffin--pair")
              }
              data-row={r.key}
            >
              <span className="m-ffin__label">{r.label}</span>
              <span className="m-ffin__chips">{r.chips.map(chip)}</span>
            </div>
          )
        )}
        <div className="m-fdivider" role="presentation" />
        <button
          type="button"
          className="m-ffin__head m-scopemenu__more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          <MIcon
            name="chevdown"
            size={18}
            className={"m-ffin__chev" + (all ? " m-ffin__chev--open" : "")}
          />
          <span className="m-ffin__label">
            {all ? "Hide extra finishes" : "Show all finishes…"}
          </span>
        </button>
        {all
          ? SCOPE_EXPANDED_ROWS.flatMap(rawOf).map((raw) => (
              <button
                key={raw}
                type="button"
                className={
                  "m-check m-fcheck m-ffin m-ffin--plain" + (scope === raw ? " m-check--on" : "")
                }
                aria-pressed={scope === raw}
                data-scope={raw}
                onClick={() => pick(raw)}
              >
                <span className="m-check__box">
                  {scope === raw ? <MIcon name="check" size={16} /> : null}
                </span>
                <span className="m-fcheck__text">{raw}</span>
              </button>
            ))
          : null}
      </div>
    </div>
  );
}

export function ScopeSheet({
  scope,
  onPick,
  onClose,
}: {
  scope: string | null;
  onPick: (raw: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Finish scope"
      sub={scope ? "Scoped · " + scope : null}
      labelId="sheet-scope"
      className="m-sheet-layer--scope"
      onClose={onClose}
    >
      <p className="m-fnote m-scopemenu__meaning">{SCOPE_MEANING}</p>
      <ScopeMenu scope={scope} onPick={onPick} />
    </Sheet>
  );
}
