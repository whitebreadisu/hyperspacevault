import { useState } from "react";
import { RarityBadge } from "../../components/RarityBadge";
import { parseCardDisplay } from "../../utils/catalog";
import { formatCardValue } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import {
  finishName,
  printingLabel,
  printingNumber,
  stashChipClass,
  totalPrice,
  unitPrice,
} from "../../stashes/stashContents";
import type { StashPrinting, StashSort, StashSortColumn } from "../../stashes/stashContents";
import { ValueSwitch } from "../cards/VariantScopeControls";
import { ariaSort, NumberSortChoice, StashSortButton } from "./StashSort";
import { TrashIcon } from "./stashIcons";

// Desktop 1b's printing-level table, on the Vault's table classes
// (`data-table-wrapper` > `data-table data-table--cards`, `th-sort-btn`,
// `td-cardnum`, `card-name-link` + `card-subtitle`, `td-value`, `row-alt`):
// Set | # · Name · Printing · In stash · Value (Unit / Total, default Total)
// · Rarity. One row per printing; a row click opens the card detail on that
// printing. The In-stash control is − (returns one copy at once) · the count
// chip (green at a playset) · trash (returns every copy of the printing; the
// row leaves). There is no + here: the − sits beside the stash count, never
// the owned count. Column widths are ratios (table-layout: fixed stretches
// them to the table's width, cards.css), balanced so Name does not take all
// the slack (R1-8). Without `onReturn` (a stash link's viewer, App Spec
// §19.1) the In-stash cell is the count chip alone: no −, no trash.

export type ValueUnit = "unit" | "total";

const COLS: { col: StashSortColumn; label: string; width: number; cls?: string }[] = [
  { col: "base", label: "Set | #", width: 92 },
  { col: "name", label: "Name", width: 212 },
  { col: "printing", label: "Printing", width: 130 },
  { col: "qty", label: "In stash", width: 150, cls: "sp-th--qty" },
  { col: "value", label: "Value", width: 140, cls: "th-value sp-th--value" },
  { col: "rarity", label: "Rarity", width: 148 },
];

export function StashTable({
  rows,
  sort,
  onSort,
  priceKind,
  valueUnit,
  onValueUnit,
  busy = false,
  onOpen,
  onReturn,
}: {
  rows: StashPrinting[];
  sort: StashSort;
  onSort: (col: StashSortColumn) => void;
  priceKind: PriceMode;
  valueUnit: ValueUnit;
  onValueUnit: (u: ValueUnit) => void;
  busy?: boolean;
  onOpen: (row: StashPrinting) => void;
  /** Absent = read-only: the count chip without − and trash. */
  onReturn?: (row: StashPrinting, quantity: number) => void;
}) {
  const [pressed, setPressed] = useState<number | null>(null);
  const isTotal = valueUnit === "total";
  return (
    <div className="data-table-wrapper sp-tablewrap">
      <table className="data-table data-table--cards sp-table" aria-label="Copies in this stash">
        <colgroup>
          {COLS.map((c) => (
            <col key={c.col} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((h) => {
              const cols: StashSortColumn[] = h.col === "base" ? ["base", "number"] : [h.col];
              return (
                <th key={h.col} className={h.cls} aria-sort={ariaSort(sort, cols)}>
                  {h.col === "base" ? (
                    <NumberSortChoice sort={sort} onSort={onSort} />
                  ) : h.col === "value" ? (
                    <span className="th-value-inner sp-th__value">
                      <ValueSwitch
                        checked={isTotal}
                        large
                        label={isTotal ? "TOTAL" : "UNIT"}
                        ariaLabel={
                          isTotal
                            ? "Showing total value — switch to unit"
                            : "Showing unit value — switch to total"
                        }
                        title={
                          isTotal
                            ? "Total value — this stash's copies of the printing. Click for unit price."
                            : "Unit value — price of one copy. Click for the stash's total."
                        }
                        onToggle={() => onValueUnit(isTotal ? "unit" : "total")}
                      />
                      <StashSortButton
                        active={sort.column === "value"}
                        sort={sort}
                        onClick={() => onSort("value")}
                      >
                        Value
                      </StashSortButton>
                    </span>
                  ) : (
                    <StashSortButton
                      active={sort.column === h.col}
                      sort={sort}
                      onClick={() => onSort(h.col)}
                    >
                      {h.label}
                    </StashSortButton>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const { displayName, subtitle } = parseCardDisplay(r.card);
            const price = valueUnit === "unit" ? unitPrice(r, priceKind) : totalPrice(r, priceKind);
            const vid = r.variant.variant_id;
            const label = printingLabel(r);
            return (
              <tr
                key={vid}
                className={i % 2 === 1 ? "row-alt sp-tr" : "sp-tr"}
                data-variant={vid}
                onClick={() => onOpen(r)}
              >
                <td className="cell-muted td-cardnum sp-td--num">{printingNumber(r.variant)}</td>
                <td className="td-name td-name--clickable sp-td--name">
                  <button
                    type="button"
                    className="card-name-link sp-namebtn"
                    title={displayName}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r);
                    }}
                    aria-label={`${displayName}${subtitle ? ", " + subtitle : ""}, ${finishName(r.variant)}: open card`}
                  >
                    {displayName}
                  </button>
                  {subtitle ? <span className="card-subtitle">{subtitle}</span> : null}
                </td>
                <td className="sp-td--printing">{finishName(r.variant)}</td>
                <td
                  className="sp-td--qty"
                  onClick={onReturn ? (e) => e.stopPropagation() : undefined}
                >
                  {onReturn ? (
                    <span className="sp-ctl">
                      <button
                        type="button"
                        className={"sp-minus" + (pressed === vid ? " sp-minus--pressed" : "")}
                        aria-label={`Return one ${label} to the Vault`}
                        aria-disabled={busy || undefined}
                        onPointerDown={() => setPressed(vid)}
                        onPointerUp={() => setPressed(null)}
                        onPointerLeave={() => setPressed(null)}
                        onClick={() => {
                          if (!busy) onReturn(r, 1);
                        }}
                      >
                        −
                      </button>
                      <span className={stashChipClass(r.qty, r.card)}>{r.qty}</span>
                      <button
                        type="button"
                        className="sp-trash"
                        aria-label={`Return all ${r.qty} ${label} to the Vault`}
                        aria-disabled={busy || undefined}
                        onClick={() => {
                          if (!busy) onReturn(r, r.qty);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  ) : (
                    <span className="sp-ctl">
                      <span className={stashChipClass(r.qty, r.card)}>{r.qty}</span>
                    </span>
                  )}
                </td>
                <td className={"td-value" + (price == null ? " cell-muted" : "")}>
                  {formatCardValue(price)}
                </td>
                <td className="sp-td--rarity">
                  <RarityBadge rarity={r.card.rarity} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
