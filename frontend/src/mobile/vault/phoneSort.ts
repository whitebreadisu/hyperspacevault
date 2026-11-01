import { nextSortState } from "../../utils/cardSort";
import type { SortColumn, SortState } from "../../utils/cardSort";

// The phone's sort rules, kept apart from the shared vault model: the shared
// model and the desktop Cards page never offer these.

/** The sorts the phone offers -- the shared model's
 * columns without `set` (the phone's "Set | #" sort, `number`, already orders
 * by set and then number) and without `variants` (desktop's sort by number of
 * printings; the phone's fifth row is `owned`, copies owned). */
export type PhoneSortColumn = Exclude<SortColumn, "set" | "variants">;
export interface PhoneSortState {
  column: PhoneSortColumn;
  direction: SortState["direction"];
}

/** The sort the phone shows and applies for `s`. A `set` or `variants` sort
 * (not offered on the phone; the shared sort model keeps both for desktop)
 * becomes the default order, `number` ascending -- which is what "Set
 * ascending" was. Every other state is returned as it is (same object). */
export function phoneSortState(s: SortState): PhoneSortState {
  return s.column === "set" || s.column === "variants"
    ? { column: "number", direction: "asc" }
    : (s as PhoneSortState);
}

/** The direction a phone sort lands on at its FIRST tap, where that is not
 * ascending (owner decision 2026-10-12 after review): Cards Owned starts at
 * the most owned. Every other sort starts ascending, as on desktop. */
export const PHONE_FIRST_DIRECTION: Partial<Record<PhoneSortColumn, SortState["direction"]>> = {
  owned: "desc",
};

/** A pick in the phone's Sort sheet. As desktop's `nextSortState` -- the
 * active column flips, a `set` / `variants` pick becomes "Set | #" ascending
 * (phoneSortState) -- except that a newly picked column lands on its own
 * first direction (PHONE_FIRST_DIRECTION, else ascending). Phone only:
 * desktop's headers keep calling `nextSortState`, which is unchanged. */
export function nextPhoneSort(current: SortState, picked: SortColumn): PhoneSortState {
  const next = phoneSortState(nextSortState(current, picked));
  const fresh = picked !== current.column && next.column === picked;
  return fresh
    ? { column: next.column, direction: PHONE_FIRST_DIRECTION[next.column] ?? "asc" }
    : next;
}
