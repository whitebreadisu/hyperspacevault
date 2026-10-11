import {
  COST_MAX,
  DEFAULT_FILTERS,
  facetedOptions,
  facetValidValues,
  HP_MAX,
  POWER_MAX,
  RARITY_OPTIONS,
} from "../../utils/filters";
import type { FacetField, FilterState, SelectOption } from "../../utils/filters";
import type { InventoryCard } from "../../utils/inventory";
import type { LimitsMatrix } from "../../utils/limits";
import { scopeShortName } from "../../utils/variantScope";
import { filterCards } from "../vault/vaultModel";
import type { CollectionToggles, VaultFilterState } from "../vault/vaultModel";

// BL-248 stage 2B-1 (S2-13 / S2-14 / S2-15): the Filters sheet's model, pure
// functions over desktop's own utilities (utils/filters.ts facetValidValues /
// facetedOptions; vaultModel's withFilters / filterCards). The sheet edits
// the Vault's live state through useVaultView (S2-14: live, as desktop and
// rev4 -- no draft).

/** Desktop CardsPage hands FilterPanel the toggle-narrowed cards (BL-70) and
 * facets with the search inside FilterState. The phone's search lives beside
 * FilterState and also matches card numbers, so the facet universe here is
 * the toggle-narrowed list with the search applied -- the same conjunction
 * desktop facets over. */
export function facetBase(
  all: InventoryCard[],
  s: VaultFilterState,
  limits: LimitsMatrix | null
): InventoryCard[] {
  return filterCards(all, { ...s, filters: DEFAULT_FILTERS }, limits);
}

/** Desktop facetValidValues over the phone's facet universe (S2-15). */
export function facetValid(
  base: InventoryCard[],
  filters: FilterState,
  field: FacetField
): Set<string> | null {
  return facetValidValues(base, { ...filters, search: "" }, field);
}

/** Rarity inline (R4-3): all five values always render (the row is a fixed
 * five-badge grid), so desktop facetedOptions runs with showAllValues = true
 * -- a 0-match value is labelled "(0)" and inert; a selected one is never
 * hidden (BL-70). */
export function rarityOptions(base: InventoryCard[], filters: FilterState): SelectOption[] {
  return facetedOptions(RARITY_OPTIONS, facetValid(base, filters, "rarity"), filters.rarity, true);
}

/** A faceted value: inert = 0 matches under the other filters; blocked =
 * inert and not selected (an inert selected value stays removable). */
export function optionState(
  opt: SelectOption,
  selected: Set<string>
): { on: boolean; inert: boolean; blocked: boolean } {
  const on = selected.has(opt.value);
  const inert = !!opt.inert;
  return { on, inert, blocked: inert && !on };
}

/** Toggle one value in a Set facet (a new Set, FilterState is immutable). */
export function toggleValue(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** rev4 gameplayCount = the badge rule (desktop countActiveFilters, one bump
 * per group) over the Gameplay group: Aspects (selection or a non-Exact
 * mode), Type, Arenas, Keywords, Traits, Cost, Power, HP. */
export function gameplayCount(f: FilterState): number {
  const range = (r: [number, number], max: number) => (r[0] !== 0 || r[1] !== max ? 1 : 0);
  return (
    (f.aspects.size > 0 || f.aspectMode !== DEFAULT_FILTERS.aspectMode ? 1 : 0) +
    (f.type.size ? 1 : 0) +
    (f.arena.size ? 1 : 0) +
    (f.keyword.size ? 1 : 0) +
    (f.trait.size ? 1 : 0) +
    range(f.costRange, COST_MAX) +
    range(f.powerRange, POWER_MAX) +
    range(f.hpRange, HP_MAX)
  );
}

// ── Row chips (R4-3 FacetRow) ───────────────────────────────────────────────

export interface RowChip {
  /** The raw value (set code, toggle key, raw finish). */
  v: string;
  /** Full name for "Remove <name>". */
  name: string;
  /** Base set: the logo path; otherwise null and `text` is drawn. */
  logo: string | null;
  text: string;
  /** Amber: the Finish value the scope wrote / the toggles while scoped. */
  scoped: boolean;
}

/** Set row: a base set shows its logo, a long-tail set its code. */
export function setChips(
  f: FilterState,
  baseCodes: Set<string>,
  nameByCode: Record<string, string>
): RowChip[] {
  return [...f.set].map((code) => ({
    v: code,
    name: nameByCode[code] ?? code,
    logo: baseCodes.has(code) ? `/images/set_${code}.png` : null,
    text: code,
    scoped: false,
  }));
}

/** rev4 COLLECTION_SHORT: desktop's four toggles in their short names. */
export const COLLECTION_SHORT: [keyof CollectionToggles, string][] = [
  ["incomplete", "Incomplete"],
  ["owned", "Own"],
  ["unowned", "Don't own"],
  ["overcap", "Over limit"],
];

/** Collection row: signed out shows nothing (the placeholder routes to sign
 * in); while scoped the toggles read the scoped finish, so they carry its
 * amber (desktop pl-toggle--scoped, BL-195 / BL-222). */
export function collectionChips(
  t: CollectionToggles,
  scope: string | null,
  isAuthenticated: boolean
): RowChip[] {
  if (!isAuthenticated) return [];
  return COLLECTION_SHORT.filter(([k]) => t[k]).map(([k, text]) => ({
    v: k,
    name: text,
    logo: null,
    text,
    scoped: !!scope,
  }));
}

/** Finish row: desktop's short names; the value the scope wrote is amber. */
export function finishChips(f: FilterState, scope: string | null): RowChip[] {
  return [...f.finish].map((raw) => ({
    v: raw,
    name: raw,
    logo: null,
    text: scopeShortName(raw),
    scoped: scope === raw,
  }));
}

// ── Live edits (S2-14) ──────────────────────────────────────────────────────

/** The slice of useVaultView the sheet writes through. */
export interface FilterWriter {
  state: VaultFilterState;
  setFilters: (next: FilterState) => void;
  setToggles: (next: CollectionToggles) => void;
  clearAll: () => void;
}

/** Every edit the sheet makes, applied live to the Vault's state. Facet
 * writes go through setFilters, so the scope rule holds by construction
 * (vaultModel.withFilters): a Finish edit that is not exactly the scoped
 * value disengages the scope; every other facet keeps it. Reset = desktop
 * Reset (FilterState incl. the search back to default, the four toggles off;
 * the scope goes with it). */
export function filterActions(w: FilterWriter) {
  const f = w.state.filters;
  return {
    toggleRarity: (value: string) => w.setFilters({ ...f, rarity: toggleValue(f.rarity, value) }),
    removeSet: (code: string) => w.setFilters({ ...f, set: toggleValue(f.set, code) }),
    removeFinish: (raw: string) => w.setFilters({ ...f, finish: toggleValue(f.finish, raw) }),
    removeToggle: (key: keyof CollectionToggles) =>
      w.setToggles({ ...w.state.toggles, [key]: false }),
    reset: () => w.clearAll(),
  };
}
