import type { SortColumn, SortState } from "../../utils/cardSort";
import { Sheet, useSheetClose } from "../Sheet";
import { phoneSortState } from "./phoneSort";
import type { PhoneSortColumn } from "./phoneSort";

// The sort sheet (App Spec §25.1 Sort). A pick follows desktop
// nextSortState: a new column lands ascending, the active column flips
// direction; a pick closes the sheet. One exception: Cards Owned lands on
// descending -- most owned first -- at its first tap (phoneSort.ts
// nextPhoneSort).
// The phone has its own list -- the sorts used most first, Cost / Power / HP last; "#" reads "Set | #" (the
// default order is by set, then number); the fifth row is "Cards Owned", the
// `owned` sort (copies owned -- cardSort.ts), in the place of desktop's
// Variants sort (number of printings), which the phone does not offer; there
// is no Set row (the "Set | #" sort covers it). phoneSort.ts phoneSortState
// maps a `set` or `variants` sort onto "Set | #" ascending. The active row
// carries its direction as a word in a blue-bordered badge, not a chevron;
// the word is in the primary text colour so it reads on the blue-washed row.
// Desktop's column headers and sorts are unchanged.

export const SORT_LABELS: Record<PhoneSortColumn, string> = {
  number: "Set | #",
  value: "Value",
  playset: "Playset",
  name: "Name",
  owned: "Cards Owned",
  rarity: "Rarity",
  cost: "Cost",
  power: "Power",
  hp: "HP",
};
export const SORT_ORDER: PhoneSortColumn[] = [
  "number",
  "value",
  "playset",
  "name",
  "owned",
  "rarity",
  "cost",
  "power",
  "hp",
];

export function sortLabel(sort: SortState): string {
  const s = phoneSortState(sort);
  return `Sort: ${SORT_LABELS[s.column]}, ${s.direction === "asc" ? "ascending" : "descending"}`;
}

function Rows({ sort, onPick }: { sort: SortState; onPick: (c: SortColumn) => void }) {
  const close = useSheetClose();
  const current = phoneSortState(sort);
  return (
    <div className="m-choice">
      {SORT_ORDER.map((c) => {
        const on = current.column === c;
        const word = current.direction === "asc" ? "Ascending" : "Descending";
        return (
          <button
            key={c}
            type="button"
            className={"m-choice__row" + (on ? " m-choice__row--on" : "")}
            aria-pressed={on}
            data-sort={c}
            aria-label={SORT_LABELS[c] + (on ? ", " + word.toLowerCase() : "")}
            onClick={() => {
              onPick(c);
              close();
            }}
          >
            <span>{SORT_LABELS[c]}</span>
            {on ? <span className="m-sortdir">{word}</span> : null}
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
