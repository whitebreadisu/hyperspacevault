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
import { TrashIcon } from "./stashIcons";

// Desktop 1b's printing-level table: Set | # · Name · Printing · In stash ·
// Value (Unit / Total, default Total) · Rarity. One row per printing; a row
// click opens the card detail on that printing. The In-stash control is
// − (returns one copy at once) · the count chip (green at a playset) · trash
// (returns every copy of the printing; the row leaves). There is no + here:
// the − sits beside the stash count, never the owned count.

export type ValueUnit = "unit" | "total";

const HEADERS: { col: StashSortColumn; label: string; cls: string }[] = [
  { col: "number", label: "Set | #", cls: "sp-th--num" },
  { col: "name", label: "Name", cls: "sp-th--name" },
  { col: "printing", label: "Printing", cls: "sp-th--printing" },
  { col: "qty", label: "In stash", cls: "sp-th--qty" },
  { col: "value", label: "Value", cls: "sp-th--value" },
  { col: "rarity", label: "Rarity", cls: "sp-th--rarity" },
];

export function StashTable({
  rows,
  sort,
  onSort,
  priceKind,
  valueUnit,
  onValueUnit,
  busy,
  onOpen,
  onReturn,
}: {
  rows: StashPrinting[];
  sort: StashSort;
  onSort: (col: StashSortColumn) => void;
  priceKind: PriceMode;
  valueUnit: ValueUnit;
  onValueUnit: (u: ValueUnit) => void;
  busy: boolean;
  onOpen: (row: StashPrinting) => void;
  onReturn: (row: StashPrinting, quantity: number) => void;
}) {
  const [pressed, setPressed] = useState<number | null>(null);
  return (
    <div className="sp-table" role="table" aria-label="Copies in this stash">
      <div className="sp-tr sp-tr--head" role="row">
        {HEADERS.map((h) => {
          const on = sort.column === h.col;
          const arrow = on ? (sort.direction === "asc" ? " ▴" : " ▾") : "";
          return (
            <span
              key={h.col}
              className={"sp-th " + h.cls}
              role="columnheader"
              aria-sort={on ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
            >
              {h.col === "value" ? (
                <span className="sp-unitseg" role="group" aria-label="Value per">
                  {(["unit", "total"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={
                        "sp-unitseg__btn" + (valueUnit === u ? " sp-unitseg__btn--on" : "")
                      }
                      aria-pressed={valueUnit === u}
                      onClick={() => onValueUnit(u)}
                    >
                      {u === "unit" ? "Unit" : "Total"}
                    </button>
                  ))}
                </span>
              ) : null}
              <button type="button" className="sp-th__btn" onClick={() => onSort(h.col)}>
                {h.label}
                {arrow}
              </button>
            </span>
          );
        })}
      </div>
      {rows.map((r) => {
        const { displayName, subtitle } = parseCardDisplay(r.card);
        const price = valueUnit === "unit" ? unitPrice(r, priceKind) : totalPrice(r, priceKind);
        const vid = r.variant.variant_id;
        const label = printingLabel(r);
        return (
          <div key={vid} className="sp-tr" role="row" data-variant={vid} onClick={() => onOpen(r)}>
            <span className="sp-td sp-td--num" role="cell">
              {printingNumber(r.variant)}
            </span>
            <span className="sp-td sp-td--name" role="cell">
              <button
                type="button"
                className="sp-namebtn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(r);
                }}
                aria-label={`${displayName}${subtitle ? ", " + subtitle : ""}, ${finishName(r.variant)}: open card`}
              >
                <span className="sp-name">{displayName}</span>
                {subtitle ? <span className="sp-sub">{subtitle}</span> : null}
              </button>
            </span>
            <span className="sp-td sp-td--printing" role="cell">
              {finishName(r.variant)}
            </span>
            <span className="sp-td sp-td--qty" role="cell" onClick={(e) => e.stopPropagation()}>
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
                <span className={stashChipClass(r.qty, r.card) + " sp-chip"}>{r.qty}</span>
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
            </span>
            <span
              className={"sp-td sp-td--value" + (price == null ? " sp-td--none" : "")}
              role="cell"
            >
              {formatCardValue(price)}
            </span>
            <span className="sp-td sp-td--rarity" role="cell">
              <RarityBadge rarity={r.card.rarity} size={20} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
