import type { BaseCard, SetOrderMap } from "../utils/catalog";
import { sortCards } from "../utils/cardSort";
import type { SortState } from "../utils/cardSort";
import { applyFilters, countActiveFilters, DEFAULT_FILTERS, matchesQuery } from "../utils/filters";
import type { FilterState } from "../utils/filters";
import type { InventoryCard } from "../utils/inventory";
import type { LimitsMatrix } from "../utils/limits";
import {
  applyCollectionToggles,
  isFinishSetScopedTo,
  SCOPE_EXPANDED_ROWS,
  SCOPE_PINNED_ROWS,
  sortCardsByScope,
} from "../utils/variantScope";
import type { CollectionToggles, PriceMode, ValueDisplayMode } from "../utils/variantScope";
import { phoneSortState } from "../mobile/vault/phoneSort";

// BL-247 S1-22 / S1-16 / S1-17: the Vault's view model as pure functions over
// desktop's own types and utilities (filters.ts, variantScope.ts,
// cardSort.ts, limits.ts). useVaultView.ts holds the state; everything that
// decides what the list shows lives here so it is unit-testable.

/** The Collection toggles the Filters sheet edits. */
export type { CollectionToggles };

export const NO_TOGGLES: CollectionToggles = {
  incomplete: false,
  owned: false,
  unowned: false,
  overcap: false,
};

/** Desktop CardsPage's mutual exclusions, applied on the way in: Own clears
 * Don't own; Don't own clears Own and Over limit; Over limit clears Don't
 * own. Turning a toggle off clears nothing. */
export function withToggle(t: CollectionToggles, key: keyof CollectionToggles): CollectionToggles {
  const on = !t[key];
  const next = { ...t, [key]: on };
  if (on && key === "owned") next.unowned = false;
  if (on && key === "unowned") {
    next.owned = false;
    next.overcap = false;
  }
  if (on && key === "overcap") next.unowned = false;
  return next;
}

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

/** A stable empty Set facet, so the breakdown never narrows by set. */
const NO_SETS: Set<string> = new Set();

export interface VaultList {
  /** Every card in default order (the unnarrowed list; "All" totals, S1-23). */
  all: InventoryCard[];
  /** The Collection toggles only, in default order: no facet, no search.
   * Desktop's filter panel draws its option universes from it. */
  toggled: InventoryCard[];
  /** The narrowed list, sorted -- what the rows / gallery render. */
  list: InventoryCard[];
  /** Every narrowing EXCEPT the Set facet: the by-set rows' universe, so a
   * row stays visible while another set is selected. */
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
