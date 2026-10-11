import type { SortColumn, SortState } from "../../utils/cardSort";
import { MIcon } from "../icons";
import { Sheet, useSheetClose } from "../Sheet";

// BL-247 S1-17: the sort sheet (rev4 MSheet.jsx:170-188). One row per desktop
// sortable column (cardSort.ts SORTABLE_COLUMNS) named as desktop's table
// headers (CardsTable.tsx:446-616). A pick follows desktop nextSortState: a
// new column lands ascending, the active column flips direction. The active
// row shows its direction; a pick closes the sheet.

export const SORT_LABELS: Record<SortColumn, string> = {
  number: "#",
  name: "Name",
  variants: "Variants",
  playset: "Playset",
  value: "Value",
  rarity: "Rarity",
  cost: "Cost",
  power: "Power",
  hp: "HP",
  set: "Set",
};
const ORDER: SortColumn[] = [
  "number",
  "name",
  "variants",
  "playset",
  "value",
  "rarity",
  "cost",
  "power",
  "hp",
  "set",
];

export function sortLabel(sort: SortState): string {
  return `Sort: ${SORT_LABELS[sort.column]}, ${sort.direction === "asc" ? "ascending" : "descending"}`;
}

function Rows({ sort, onPick }: { sort: SortState; onPick: (c: SortColumn) => void }) {
  const close = useSheetClose();
  return (
    <div className="m-choice">
      {ORDER.map((c) => {
        const on = sort.column === c;
        return (
          <button
            key={c}
            type="button"
            className={"m-choice__row" + (on ? " m-choice__row--on" : "")}
            aria-pressed={on}
            data-sort={c}
            aria-label={
              SORT_LABELS[c] +
              (on ? (sort.direction === "asc" ? ", ascending" : ", descending") : "")
            }
            onClick={() => {
              onPick(c);
              close();
            }}
          >
            <span>{SORT_LABELS[c]}</span>
            {on ? (
              <MIcon name={sort.direction === "asc" ? "chevup" : "chevdown"} size={20} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SortSheet({
  sort,
  onPick,
  onClose,
}: {
  sort: SortState;
  onPick: (c: SortColumn) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Sort" labelId="sheet-sort" className="m-sheet-layer--sort" onClose={onClose}>
      <Rows sort={sort} onPick={onPick} />
    </Sheet>
  );
}
