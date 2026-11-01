import { countActiveFilters } from "../../components/FilterPanel";
import type { BaseCard, SetOrderMap } from "../../utils/catalog";
import { nextSortState, sortCards } from "../../utils/cardSort";
import type { SortColumn, SortState } from "../../utils/cardSort";
import { applyFilters, DEFAULT_FILTERS, matchesQuery } from "../../utils/filters";
import type { FilterState } from "../../utils/filters";
import type { InventoryCard } from "../../utils/inventory";
import type { LimitsMatrix } from "../../utils/limits";
import {
  applyCollectionToggles,
  isFinishSetScopedTo,
  SCOPE_EXPANDED_ROWS,
  SCOPE_PINNED_ROWS,
  sortCardsByScope,
} from "../../utils/variantScope";
import type { CollectionToggles, PriceMode, ValueDisplayMode } from "../../utils/variantScope";

// BL-247 S1-22 / S1-16 / S1-17: the Vault's view model as pure functions over
// desktop's own types and utilities (filters.ts, variantScope.ts,
// cardSort.ts, limits.ts). useVaultView.ts holds the state; everything that
// decides what the list shows lives here so it is unit-testable.

/** BL-257 FR5-05 (F-17): the sorts the phone offers -- the shared model's
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

/** The Collection toggles the Filters sheet edits. */
export type { CollectionToggles };

export const NO_TOGGLES: CollectionToggles = {
  incomplete: false,
  owned: false,
  unowned: false,
  overcap: false,
};

export interface VaultFilterState {
  filters: FilterState;
  /** The search box. Kept beside FilterState (filters.search stays empty):
   * the phone applies it after the facets. */
  query: string;
  /** Active finish scope (one raw finish value) or null -- never persisted. */
  scope: string | null;
  toggles: CollectionToggles;
}

export function freshFilterState(): VaultFilterState {
  return { filters: DEFAULT_FILTERS, query: "", scope: null, toggles: NO_TOGGLES };
}

// ── Scope (S1-16; desktop CardsPage handleScopeChange / handleFilterPanelChange)

/** The 14 owner-locked scope values (variantScope.ts option set C). */
export const SCOPE_VALUES: string[] = [...SCOPE_PINNED_ROWS, ...SCOPE_EXPANDED_ROWS].flatMap(
  (row) => row.chips.map((c) => c.rawValue)
);

/** Picking a scope writes the Finish facet to exactly that value; clearing
 * ("All finishes") clears the facet value it wrote. */
export function withScope(s: VaultFilterState, scope: string | null): VaultFilterState {
  return {
    ...s,
    scope,
    filters: { ...s.filters, finish: scope ? new Set([scope]) : new Set() },
  };
}

/** A Filters-sheet edit: a Finish-facet change that is not exactly the scoped
 * value disengages the scope ("scope drives filter, never vice versa"). */
export function withFilters(s: VaultFilterState, next: FilterState): VaultFilterState {
  const scope = s.scope && isFinishSetScopedTo(next.finish, s.scope) ? s.scope : null;
  return { ...s, filters: next, scope };
}

// ── Narrowing (S1-22) ──────────────────────────────────────────────────────

/** Desktop's badge count (FilterPanel countActiveFilters, search included,
 * one bump per group) + the Collection toggles (CardsPage
 * externalActiveCount). The Filters button shows it; > 0 = narrowed. */
export function activeFilterCount(s: VaultFilterState): number {
  const t = s.toggles;
  return (
    countActiveFilters({ ...s.filters, search: s.query.trim() }) +
    (t.incomplete ? 1 : 0) +
    (t.owned ? 1 : 0) +
    (t.unowned ? 1 : 0) +
    (t.overcap ? 1 : 0)
  );
}

/** rev4 vaultView: narrowed = any facet, toggle or a search. A scope writes
 * the Finish facet, so every scoped view is narrowed. */
export function isNarrowed(s: VaultFilterState): boolean {
  return activeFilterCount(s) > 0;
}

/** The narrowed list in default (scope-aware) order: the Collection toggles,
 * then applyFilters (every facet), then the search. `ordered` =
 * sortCardsByScope(cards). */
export function filterCards(
  ordered: InventoryCard[],
  s: VaultFilterState,
  limits: LimitsMatrix | null
): InventoryCard[] {
  return facetAndSearch(applyCollectionToggles(ordered, s.toggles, s.scope, limits), s);
}

/** Every facet, then the search, over an already-toggled list. */
function facetAndSearch(toggled: InventoryCard[], s: VaultFilterState): InventoryCard[] {
  const faceted = applyFilters(toggled as BaseCard[], {
    ...s.filters,
    search: "",
  }) as InventoryCard[];
  return s.query.trim() ? faceted.filter((c) => matchesQuery(c, s.query)) : faceted;
}

/** A stable empty Set facet (desktop EMPTY_SET_CODES). */
const NO_SETS: Set<string> = new Set();

export interface VaultList {
  /** Every card in default order (the unnarrowed list; "All" totals, S1-23). */
  all: InventoryCard[];
  /** The Collection toggles only, in default order: no facet, no search.
   * Desktop's filter panel draws its option universes from it. */
  toggled: InventoryCard[];
  /** The narrowed list, sorted -- what the rows / gallery render. */
  list: InventoryCard[];
  /** S1-24: every narrowing EXCEPT the Set facet (desktop CardsPage
   * breakdownCards, BL-224) -- the by-set rows' universe. */
  breakdown: InventoryCard[];
  narrowed: boolean;
  activeCount: number;
}

/** Desktop applies the sort it is handed: its headers offer Set and Variants. */
export const desktopSortPolicy = (s: SortState): SortState => s;

export interface VaultListContext {
  setOrder: SetOrderMap;
  priceKind: PriceMode;
  limits: LimitsMatrix | null;
  /** How the handed sort is applied. Default: phoneSortState, so the list is
   * ordered by the sort the phone shows; desktop passes desktopSortPolicy. */
  sortPolicy?: (s: SortState) => SortState;
  /** What the Value sort reads. Default "unit" (the phone has no switch);
   * desktop passes its Unit/Collection switch. */
  unitMode?: ValueDisplayMode;
}

/** The whole pipeline: scope-aware default order -> narrowing -> the sort
 * (with the default-order tiebreak). */
export function buildVaultList(
  cards: InventoryCard[],
  s: VaultFilterState,
  sort: SortState,
  ctx: VaultListContext
): VaultList {
  const all = sortCardsByScope(cards, ctx.setOrder, s.scope);
  const defaultIndex = new Map(all.map((c, i) => [c.base_card_id, i]));
  const toggled = applyCollectionToggles(all, s.toggles, s.scope, ctx.limits);
  const filtered = facetAndSearch(toggled, s);
  const list = sortCards(filtered, (ctx.sortPolicy ?? phoneSortState)(sort), {
    scope: s.scope,
    valueMode: ctx.priceKind,
    unitMode: ctx.unitMode ?? "unit",
    setOrder: ctx.setOrder,
    defaultIndex,
  });
  const breakdown = facetAndSearch(toggled, { ...s, filters: { ...s.filters, set: NO_SETS } });
  const activeCount = activeFilterCount(s);
  return { all, toggled, list, breakdown, narrowed: activeCount > 0, activeCount };
}
