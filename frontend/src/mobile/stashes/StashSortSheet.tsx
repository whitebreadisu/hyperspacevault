import { STASH_SORT_LABELS } from "../../stashes/stashContents";
import type { StashSort, StashSortColumn } from "../../stashes/stashContents";
import { Sheet, useSheetClose } from "../Sheet";

// The stash screen's sort sheet (R1-15 / R1-16): the Vault's sort sheet
// pattern (SortSheet.tsx -- `m-choice` rows, the active row's direction as a
// word in the `m-sortdir` badge, a pick closes the sheet) with the stash's
// own sorts: Set | # by base card (default), Set | # by this printing's
// number, Name, Value, Copies in stash, Rarity, Recently stashed. A pick
// follows nextStashSort (stashContents.ts).

export const STASH_SORT_ORDER: StashSortColumn[] = [
  "base",
  "number",
  "name",
  "value",
  "qty",
  "rarity",
  "recent",
];

export function stashSortLabel(sort: StashSort): string {
  return `Sort: ${STASH_SORT_LABELS[sort.column]}, ${
    sort.direction === "asc" ? "ascending" : "descending"
  }`;
}

function Rows({ sort, onPick }: { sort: StashSort; onPick: (c: StashSortColumn) => void }) {
  const close = useSheetClose();
  return (
    <div className="m-choice">
      {STASH_SORT_ORDER.map((c) => {
        const on = sort.column === c;
        const word = sort.direction === "asc" ? "Ascending" : "Descending";
        return (
          <button
            key={c}
            type="button"
            className={"m-choice__row" + (on ? " m-choice__row--on" : "")}
            aria-pressed={on}
            data-sort={c}
            aria-label={STASH_SORT_LABELS[c] + (on ? ", " + word.toLowerCase() : "")}
            onClick={() => {
              onPick(c);
              close();
            }}
          >
            <span>{STASH_SORT_LABELS[c]}</span>
            {on ? <span className="m-sortdir">{word}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function StashSortSheet({
  sort,
  onPick,
  onClose,
}: {
  sort: StashSort;
  onPick: (c: StashSortColumn) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Sort"
      labelId="sheet-stash-sort"
      className="m-sheet-layer--sort"
      onClose={onClose}
    >
      <Rows sort={sort} onPick={onPick} />
    </Sheet>
  );
}
