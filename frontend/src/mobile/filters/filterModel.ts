import type { CardSet } from "../../api/sets";
import {
  ARENA_OPTIONS,
  ASPECT_LIST,
  COST_MAX,
  DEFAULT_FILTERS,
  distinctMulti,
  facetedOptions,
  facetValidValues,
  HP_MAX,
  NO_ASPECT,
  POWER_MAX,
  RARITY_OPTIONS,
  TYPE_OPTIONS,
} from "../../utils/filters";
import type { AspectMatchMode, FacetField, FilterState, SelectOption } from "../../utils/filters";
import { allSetsGroups, isBaseSetCode } from "../../utils/setGrouping";
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

// ── Picker options (S2-17 / S2-18 / S2-19) ──────────────────────────────────
// Every picker shows its whole universe with desktop facetedOptions
// (showAllValues = true): a value with 0 matches under the other filters is
// labelled "(0)", greyed and not addable; a selected one is never hidden.

/** Desktop FilterPanel's Set facet grouping (allSetsGroups + isBaseSetCode):
 * the base sets (logo chips), then the long tail -- each base set's Weekly
 * Play container in base order, a divider, the Exclusives in subgroup order
 * and any code the grouping does not know, alphabetically. */
export function setPickerGroups(sets: readonly CardSet[]): {
  base: string[];
  weekly: string[];
  exclusives: string[];
} {
  const { baseGroups, exclusiveGroups } = allSetsGroups(sets);
  const block = baseGroups.flatMap((g) => g.memberCodes);
  const ex = exclusiveGroups.flatMap((g) => g.memberCodes);
  const known = new Set([...block, ...ex]);
  const leftover = sets
    .map((s) => s.code)
    .filter((c) => !known.has(c))
    .sort((a, b) => a.localeCompare(b));
  return {
    base: block.filter(isBaseSetCode),
    weekly: block.filter((c) => !isBaseSetCode(c)),
    exclusives: [...ex, ...leftover],
  };
}

/** Faceted options for one field over a universe of raw values. */
export function fieldOptions(
  base: InventoryCard[],
  filters: FilterState,
  field: FacetField,
  universe: (string | SelectOption)[],
  selected: Set<string>
): SelectOption[] {
  return facetedOptions(universe, facetValid(base, filters, field), selected, true);
}

/** Desktop's aspect universe: the six aspects + "No Aspect" (BL-90). */
export const ASPECT_UNIVERSE: SelectOption[] = [
  ...ASPECT_LIST.map((a) => ({ value: a, label: a })),
  { value: NO_ASPECT, label: "No Aspect" },
];
export const TYPE_UNIVERSE = TYPE_OPTIONS;
export const ARENA_UNIVERSE = ARENA_OPTIONS;

/** Keyword / Trait universes (desktop distinctMulti), alphabetical. */
export function listUniverse(all: InventoryCard[], field: "keyword" | "trait"): string[] {
  return distinctMulti(all, field === "keyword" ? "keywords" : "traits");
}

/** rev4 MODE_MEANING: the one-line meaning under Any / Within / Exact. */
export const MODE_MEANING: Record<AspectMatchMode, string> = {
  any: "Cards with any of the selected aspects.",
  within: "Cards whose aspects all fit inside the selection.",
  exact: "Cards whose aspects match the selection exactly.",
};

// ── Live edits (S2-14) ──────────────────────────────────────────────────────

/** The slice of useVaultView the sheet writes through. */
export interface FilterWriter {
  state: VaultFilterState;
  setFilters: (next: FilterState) => void;
  setToggles: (next: CollectionToggles) => void;
  clearAll: () => void;
}

/** S2-20: desktop's filter_applied `field` values (FilterPanel
 * onFieldChanged + CardsPage's four Collection toggles). */
export type FilterField =
  | "set"
  | "rarity"
  | "finish"
  | "type"
  | "arena"
  | "keyword"
  | "trait"
  | "cost"
  | "power"
  | "hp"
  | "aspect"
  | "aspect_mode"
  | "completion"
  | "owned"
  | "no_inventory"
  | "over_cap";

export const TOGGLE_FIELD: Record<keyof CollectionToggles, FilterField> = {
  incomplete: "completion",
  owned: "owned",
  unowned: "no_inventory",
  overcap: "over_cap",
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

export type SetField = "type" | "arena" | "keyword" | "trait";
export type RangeField = "cost" | "power" | "hp";
const RANGE_KEY = { cost: "costRange", power: "powerRange", hp: "hpRange" } as const;
export const RANGE_MAX: Record<RangeField, number> = {
  cost: COST_MAX,
  power: POWER_MAX,
  hp: HP_MAX,
};

/** Every edit the sheet and its pickers make, applied live to the Vault's
 * state. Facet writes go through setFilters, so the scope rule holds by
 * construction (vaultModel.withFilters): a Finish edit that is not exactly
 * the scoped value disengages the scope; every other facet keeps it. Reset =
 * desktop Reset (FilterState incl. the search back to default, the four
 * toggles off; the scope goes with it). `onField` hears the desktop field
 * name of every user edit (S2-20 filter_applied; Reset is filters_cleared). */
export function filterActions(w: FilterWriter, onField: (field: FilterField) => void = () => {}) {
  const f = w.state.filters;
  const put = (field: FilterField, next: FilterState) => {
    onField(field);
    w.setFilters(next);
  };
  return {
    toggleRarity: (value: string) => put("rarity", { ...f, rarity: toggleValue(f.rarity, value) }),
    toggleSet: (code: string) => put("set", { ...f, set: toggleValue(f.set, code) }),
    removeSet: (code: string) => put("set", { ...f, set: toggleValue(f.set, code) }),
    clearSets: () => put("set", { ...f, set: new Set() }),
    toggleFinish: (raw: string) => put("finish", { ...f, finish: toggleValue(f.finish, raw) }),
    removeFinish: (raw: string) => put("finish", { ...f, finish: toggleValue(f.finish, raw) }),
    setFinishes: (next: Set<string>) => put("finish", { ...f, finish: next }),
    toggleIn: (field: SetField, value: string) =>
      put(field, { ...f, [field]: toggleValue(f[field], value) }),
    setValues: (field: SetField, next: Set<string>) => put(field, { ...f, [field]: next }),
    /** BL-90: empty = every chit lit; the first tap narrows to that value;
     * removing the last one lands back on empty (no snap-back). */
    tapAspect: (a: string) =>
      put("aspect", {
        ...f,
        aspects: f.aspects.size === 0 ? new Set([a]) : toggleValue(f.aspects, a),
      }),
    setAspectMode: (aspectMode: AspectMatchMode) => put("aspect_mode", { ...f, aspectMode }),
    setRange: (field: RangeField, r: [number, number]) =>
      put(field, { ...f, [RANGE_KEY[field]]: r }),
    toggleToggle: (key: keyof CollectionToggles) => {
      onField(TOGGLE_FIELD[key]);
      w.setToggles(withToggle(w.state.toggles, key));
    },
    removeToggle: (key: keyof CollectionToggles) => {
      onField(TOGGLE_FIELD[key]);
      w.setToggles({ ...w.state.toggles, [key]: false });
    },
    reset: () => w.clearAll(),
  };
}
