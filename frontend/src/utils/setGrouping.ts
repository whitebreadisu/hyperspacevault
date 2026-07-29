import type { CardSet } from "../api/sets";

/** BL-164: set grouping/ordering model, locked app-wide 2026-07-26
 * (specification_documents/planning/Set_Grouping_Context_2026-07-26.md).
 * Every set is exactly one of: a base set (canonical or secondary), a
 * Weekly Play companion (nests under its base set -- only Weekly Play sets
 * nest), or an Exclusive (everything else). This module is the single
 * documented source for that fixed structure/membership/order -- do not
 * re-derive it ad hoc elsewhere; both Add Cards dropdowns (SetDropdown.tsx)
 * and FilterPanel's Set multi-select key off these same constants.
 *
 * "Fixed (do not change): group structure, membership, ordering, and
 * labels" -- per the doc's own closing section. New sets extend the lists
 * per the doc's "Rules for future sets (durable)" section; nothing here
 * should be derived from `is_base_set` alone (MV26 anchors only to ASH but
 * is still an Exclusive, so anchoring != base-set membership). */

/** Canonical base sets, release order. */
export const SET_CANONICAL: readonly string[] = [
  "SOR",
  "SHD",
  "TWI",
  "JTL",
  "LOF",
  "SEC",
  "LAW",
  "ASH",
];

/** Secondary base sets, release order -- UI-mechanically the same tier as
 * canonical (View 2's base-group list), but a separate block in View 1. */
export const SET_SECONDARY: readonly string[] = ["IBH", "TS26"];

/** Every base set, canonical then secondary -- the guaranteed base-only
 * ordering (View 1). */
export const BASE_SET_ORDER: readonly string[] = [...SET_CANONICAL, ...SET_SECONDARY];

export interface ExclusiveSubgroup {
  label: string;
  codes: readonly string[];
}

/** Exclusives, subgrouped (View 2's 4th+ groups) -- years first within a
 * subgroup, undated merch last (see "Other promos"). */
export const EXCLUSIVE_SUBGROUPS: readonly ExclusiveSubgroup[] = [
  { label: "Convention Exclusives", codes: ["C24", "C25", "C26"] },
  { label: "Judge Program", codes: ["J24", "J25"] },
  { label: "Promos", codes: ["P25", "P26"] },
  { label: "Other promos", codes: ["G25", "MV26", "GG"] },
];

/** A base set's Weekly Play companion code -- the base code plus a trailing
 * "P" (SOR -> SORP, ...). Categorical rule: only Weekly Play sets nest under
 * a base set, and they always follow this naming convention. */
export function weeklyPlayCodeFor(baseCode: string): string {
  return `${baseCode}P`;
}

export function isCanonicalSet(code: string): boolean {
  return SET_CANONICAL.includes(code);
}

export function isSecondaryBaseSet(code: string): boolean {
  return SET_SECONDARY.includes(code);
}

/** True for any of the ten base sets (canonical or secondary) -- the same
 * ten codes CLAUDE.md's Set Codes table and the backend's curated
 * BASE_SET_CODES enumerate. */
export function isBaseSetCode(code: string): boolean {
  return isCanonicalSet(code) || isSecondaryBaseSet(code);
}

/** Sort rank for the guaranteed ordering: canonical (release order), then
 * secondary (release order), then everything else (a stable high rank --
 * callers needing a deterministic order for the "rest" should add their own
 * tiebreak, e.g. `.sort((a, b) => setSortRank(a) - setSortRank(b) ||
 * a.localeCompare(b))`). */
export function setSortRank(code: string): number {
  const canonicalIndex = SET_CANONICAL.indexOf(code);
  if (canonicalIndex !== -1) return canonicalIndex;
  const secondaryIndex = SET_SECONDARY.indexOf(code);
  if (secondaryIndex !== -1) return SET_CANONICAL.length + secondaryIndex;
  return SET_CANONICAL.length + SET_SECONDARY.length + 1000;
}

/** Looks up a fetched CardSet by code, or null when the catalog hasn't
 * loaded it (e.g. not yet fetched, or a set genuinely absent from `/api/sets`
 * -- both render as "not present" rather than a crash). */
export function findSet(sets: readonly CardSet[], code: string): CardSet | null {
  return sets.find((s) => s.code === code) ?? null;
}

/** One rail group for the logo-rail dropdown layout: a rail cell (a base
 * set's logo, or an Exclusives subgroup's text label) beside one or more
 * member rows, in order. `logoCode` is set for a real-set rail cell;
 * `label` is set for an Exclusives subgroup rail cell -- exactly one of the
 * two is ever present. */
export interface SetRailGroup {
  key: string;
  logoCode: string | null;
  label: string | null;
  memberCodes: string[];
}

/** View 1 (base sets only, the default dropdown): one rail group per
 * present base set, canonical block then secondary block, in the doc's
 * guaranteed order. Absent sets (not yet loaded / not present in `/api/sets`)
 * are simply omitted -- never rendered as an empty/broken group. */
export function baseOnlyGroups(sets: readonly CardSet[]): {
  canonical: SetRailGroup[];
  secondary: SetRailGroup[];
} {
  const toGroup = (code: string): SetRailGroup | null =>
    findSet(sets, code) ? { key: code, logoCode: code, label: null, memberCodes: [code] } : null;
  return {
    canonical: SET_CANONICAL.map(toGroup).filter((g): g is SetRailGroup => g !== null),
    secondary: SET_SECONDARY.map(toGroup).filter((g): g is SetRailGroup => g !== null),
  };
}

/** View 2 ("Show all sets"): a rail group per present base set (canonical
 * then secondary, UI-mechanically the same tier), each holding [base row,
 * Weekly Play row] when the companion is present -- base set always first,
 * its Weekly Play companion second -- followed by the Exclusives subgroups
 * (only the subgroups that have at least one present member). */
export function allSetsGroups(sets: readonly CardSet[]): {
  baseGroups: SetRailGroup[];
  exclusiveGroups: SetRailGroup[];
} {
  const baseGroups = BASE_SET_ORDER.filter((code) => findSet(sets, code)).map((code) => {
    const wpCode = weeklyPlayCodeFor(code);
    const memberCodes = findSet(sets, wpCode) ? [code, wpCode] : [code];
    return { key: code, logoCode: code, label: null, memberCodes };
  });

  const exclusiveGroups = EXCLUSIVE_SUBGROUPS.map(({ label, codes }): SetRailGroup | null => {
    const memberCodes = codes.filter((code) => findSet(sets, code));
    if (memberCodes.length === 0) return null;
    return { key: label, logoCode: null, label, memberCodes };
  }).filter((g): g is SetRailGroup => g !== null);

  return { baseGroups, exclusiveGroups };
}
