import { countActiveFilters } from "../../components/FilterPanel";
import { parseCardDisplay } from "../../utils/catalog";
import type { BaseCard, SetOrderMap } from "../../utils/catalog";
import { sortCards } from "../../utils/cardSort";
import type { SortState } from "../../utils/cardSort";
import { applyFilters, DEFAULT_FILTERS } from "../../utils/filters";
import type { FilterState } from "../../utils/filters";
import { cardOwnedTotal, isOwned, isPlaysetComplete } from "../../utils/inventory";
import type { InventoryCard } from "../../utils/inventory";
import { cardOverCap } from "../../utils/limits";
import type { LimitsMatrix } from "../../utils/limits";
import {
  isFinishSetScopedTo,
  SCOPE_EXPANDED_ROWS,
  SCOPE_PINNED_ROWS,
  scopedOwnedCount,
  scopedPlaysetComplete,
  sortCardsByScope,
} from "../../utils/variantScope";
import type { PriceMode, ScopeMenuRow } from "../../utils/variantScope";

// BL-247 S1-22 / S1-16 / S1-17: the Vault's view model as pure functions over
// desktop's own types and utilities (filters.ts, variantScope.ts,
// cardSort.ts, limits.ts). useVaultView.ts holds the state; everything that
// decides what the list shows lives here so it is unit-testable.

/** Desktop's four Collection toggles (CardsPage.tsx incompleteOnly /
 * ownedOnly / noInventoryOnly / overCapOnly): applied filters that live
 * outside FilterState. The Filters sheet (S2) edits them. */
export interface CollectionToggles {
  incomplete: boolean;
  owned: boolean;
  unowned: boolean;
  overcap: boolean;
}

export const NO_TOGGLES: CollectionToggles = {
  incomplete: false,
  owned: false,
  unowned: false,
  overcap: false,
};

export interface VaultFilterState {
  filters: FilterState;
  /** The search box. Kept beside FilterState (filters.search stays empty)
   * because the phone search also matches card numbers. */
  query: string;
  /** Active finish scope (one raw finish value) or null -- never persisted. */
  scope: string | null;
  toggles: CollectionToggles;
}

export function freshFilterState(): VaultFilterState {
  return { filters: DEFAULT_FILTERS, query: "", scope: null, toggles: NO_TOGGLES };
}

// ── Scope (S1-16; desktop CardsPage handleScopeChange / handleFilterPanelChange)

function scopeRaw(row: ScopeMenuRow): string[] {
  return row.kind === "plain" ? [row.rawValue] : row.chips.map((c) => c.rawValue);
}

/** The 13 owner-locked scope values (variantScope.ts option set C). */
export const SCOPE_VALUES: string[] = [...SCOPE_PINNED_ROWS, ...SCOPE_EXPANDED_ROWS].flatMap(
  scopeRaw
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

/** The search: desktop matches name + subtitle (applyFilters, via
 * parseCardDisplay); the phone also matches the card number -- the base
 * number, any printing's own number, or "SET number" ("SOR 87"). */
export function matchesQuery(card: BaseCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { displayName, subtitle } = parseCardDisplay(card);
  if (`${displayName} ${subtitle ?? ""}`.toLowerCase().includes(q)) return true;
  const nums = new Set<string>([card.base_card_number.toLowerCase()]);
  for (const v of card.variants) nums.add(v.card_number.toLowerCase());
  if (nums.has(q)) return true;
  const m = /^([a-z0-9]+)\s+0*(\d+[a-z]?)$/.exec(q);
  if (m) {
    const [, set, num] = m;
    if (card.set_code.toLowerCase() === set && card.base_card_number.replace(/^0+/, "") === num)
      return true;
    return card.variants.some(
      (v) => v.source_set_code.toLowerCase() === set && v.card_number.replace(/^0+/, "") === num
    );
  }
  return false;
}

/** The narrowed list in default (scope-aware) order: desktop's toggles
 * (CardsPage toggleNarrowed), then applyFilters (every facet), then the
 * search. `ordered` = sortCardsByScope(cards). */
export function filterCards(
  ordered: InventoryCard[],
  s: VaultFilterState,
  limits: LimitsMatrix | null
): InventoryCard[] {
  const { scope, toggles: t } = s;
  let out = ordered;
  if (t.incomplete)
    out = out.filter((c) =>
      scope
        ? !scopedPlaysetComplete(c.variants, scope, c.type)
        : !isPlaysetComplete(c.inventory, c.type)
    );
  if (t.owned)
    out = out.filter((c) =>
      scope ? scopedOwnedCount(c.variants, scope) > 0 : isOwned(c.inventory)
    );
  if (t.unowned)
    out = out.filter((c) =>
      scope ? scopedOwnedCount(c.variants, scope) === 0 : cardOwnedTotal(c.inventory) === 0
    );
  if (t.overcap) out = out.filter((c) => cardOverCap(c.variants, c.type, limits, scope));
  const faceted = applyFilters(out as BaseCard[], { ...s.filters, search: "" }) as InventoryCard[];
  return s.query.trim() ? faceted.filter((c) => matchesQuery(c, s.query)) : faceted;
}

export interface VaultList {
  /** Every card in default order (the unnarrowed list; "All" totals, S1-23). */
  all: InventoryCard[];
  /** The narrowed list, sorted -- what the rows / gallery render. */
  list: InventoryCard[];
  narrowed: boolean;
  activeCount: number;
}

/** The whole pipeline, as CardsPage.tsx:432-640: scope-aware default order
 * -> narrowing -> the user's sort (with desktop's defaultIndex tiebreak). */
export function buildVaultList(
  cards: InventoryCard[],
  s: VaultFilterState,
  sort: SortState,
  ctx: { setOrder: SetOrderMap; priceKind: PriceMode; limits: LimitsMatrix | null }
): VaultList {
  const all = sortCardsByScope(cards, ctx.setOrder, s.scope);
  const defaultIndex = new Map(all.map((c, i) => [c.base_card_id, i]));
  const filtered = filterCards(all, s, ctx.limits);
  const list = sortCards(filtered, sort, {
    scope: s.scope,
    valueMode: ctx.priceKind,
    unitMode: "unit",
    setOrder: ctx.setOrder,
    defaultIndex,
  });
  const activeCount = activeFilterCount(s);
  return { all, list, narrowed: activeCount > 0, activeCount };
}
