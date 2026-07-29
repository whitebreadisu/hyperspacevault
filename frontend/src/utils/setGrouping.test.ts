import { describe, it, expect } from "vitest";
import {
  SET_CANONICAL,
  SET_SECONDARY,
  BASE_SET_ORDER,
  EXCLUSIVE_SUBGROUPS,
  weeklyPlayCodeFor,
  isCanonicalSet,
  isSecondaryBaseSet,
  isBaseSetCode,
  setSortRank,
  findSet,
  baseOnlyGroups,
  allSetsGroups,
} from "./setGrouping";
import type { CardSet } from "../api/sets";

// BL-164 (Set_Grouping_Context_2026-07-26.md): the grouping/ordering model
// locked app-wide -- structure, membership, order, and labels are FIXED per
// the doc's own closing section, so these tests pin the module's constants
// and derivation functions against the doc's worked examples rather than
// re-deriving anything from live catalog data.

function makeSet(code: string, overrides: Partial<CardSet> = {}): CardSet {
  return {
    id: code.length,
    code,
    name: `${code} Name`,
    is_base_set: SET_CANONICAL.includes(code) || SET_SECONDARY.includes(code),
    release_date: null,
    ...overrides,
  };
}

describe("setGrouping constants", () => {
  it("SET_CANONICAL is the 8-set release order SOR..ASH", () => {
    expect(SET_CANONICAL).toEqual(["SOR", "SHD", "TWI", "JTL", "LOF", "SEC", "LAW", "ASH"]);
  });

  it("SET_SECONDARY is IBH then TS26", () => {
    expect(SET_SECONDARY).toEqual(["IBH", "TS26"]);
  });

  it("BASE_SET_ORDER concatenates canonical then secondary -- the ten base sets", () => {
    expect(BASE_SET_ORDER).toHaveLength(10);
    expect(BASE_SET_ORDER).toEqual([...SET_CANONICAL, ...SET_SECONDARY]);
  });

  it("EXCLUSIVE_SUBGROUPS matches the doc's four labeled subgroups in order", () => {
    expect(EXCLUSIVE_SUBGROUPS.map((g) => g.label)).toEqual([
      "Convention Exclusives",
      "Judge Program",
      "Promos",
      "Other promos",
    ]);
    expect(EXCLUSIVE_SUBGROUPS[0].codes).toEqual(["C24", "C25", "C26"]);
    expect(EXCLUSIVE_SUBGROUPS[3].codes).toEqual(["G25", "MV26", "GG"]);
  });

  it("weeklyPlayCodeFor appends P to the base code", () => {
    expect(weeklyPlayCodeFor("SOR")).toBe("SORP");
    expect(weeklyPlayCodeFor("ASH")).toBe("ASHP");
  });

  it("isCanonicalSet / isSecondaryBaseSet / isBaseSetCode classify correctly", () => {
    expect(isCanonicalSet("SOR")).toBe(true);
    expect(isCanonicalSet("TS26")).toBe(false);
    expect(isSecondaryBaseSet("TS26")).toBe(true);
    expect(isSecondaryBaseSet("SOR")).toBe(false);
    expect(isBaseSetCode("SOR")).toBe(true);
    expect(isBaseSetCode("TS26")).toBe(true);
    // MV26 anchors only to ASH but is still an Exclusive -- categorical
    // membership, not derived from anchoring (Set_Grouping_Context §"Rules").
    expect(isBaseSetCode("MV26")).toBe(false);
  });
});

describe("setSortRank", () => {
  it("orders canonical before secondary before everything else", () => {
    const ranks = ["ASH", "IBH", "TS26", "SOR", "C24"].map((c) => [c, setSortRank(c)] as const);
    const sorted = [...ranks].sort((a, b) => a[1] - b[1]).map(([c]) => c);
    expect(sorted).toEqual(["SOR", "ASH", "IBH", "TS26", "C24"]);
  });

  it("ranks within canonical/secondary follow release order", () => {
    expect(setSortRank("SOR")).toBeLessThan(setSortRank("SHD"));
    expect(setSortRank("ASH")).toBeLessThan(setSortRank("IBH"));
    expect(setSortRank("IBH")).toBeLessThan(setSortRank("TS26"));
  });
});

describe("findSet", () => {
  it("finds a present set and returns null for an absent one", () => {
    const sets = [makeSet("SOR")];
    expect(findSet(sets, "SOR")?.code).toBe("SOR");
    expect(findSet(sets, "TS26")).toBeNull();
  });
});

describe("baseOnlyGroups (View 1 -- base sets only)", () => {
  it("returns one rail group per present base set, canonical block then secondary block", () => {
    const sets = [...SET_CANONICAL, ...SET_SECONDARY].map((c) => makeSet(c));
    const { canonical, secondary } = baseOnlyGroups(sets);
    expect(canonical.map((g) => g.key)).toEqual(SET_CANONICAL);
    expect(secondary.map((g) => g.key)).toEqual(SET_SECONDARY);
    // Every group is a single-member rail cell keyed to its own logo -- no
    // Weekly Play row in the base-only view.
    for (const g of [...canonical, ...secondary]) {
      expect(g.logoCode).toBe(g.key);
      expect(g.label).toBeNull();
      expect(g.memberCodes).toEqual([g.key]);
    }
  });

  it("omits sets absent from the fetched list rather than rendering a broken group", () => {
    const sets = [makeSet("SOR"), makeSet("SHD")];
    const { canonical, secondary } = baseOnlyGroups(sets);
    expect(canonical.map((g) => g.key)).toEqual(["SOR", "SHD"]);
    expect(secondary).toEqual([]);
  });
});

describe("allSetsGroups (View 2 -- Show all sets)", () => {
  it("bundles a base set with its Weekly Play companion, base row first", () => {
    const sets = [makeSet("SOR"), makeSet("SORP", { is_base_set: false })];
    const { baseGroups } = allSetsGroups(sets);
    expect(baseGroups).toHaveLength(1);
    expect(baseGroups[0].memberCodes).toEqual(["SOR", "SORP"]);
  });

  it("a base set with no present Weekly Play companion is a single-row group", () => {
    const sets = [makeSet("TS26")];
    const { baseGroups } = allSetsGroups(sets);
    expect(baseGroups).toHaveLength(1);
    expect(baseGroups[0].memberCodes).toEqual(["TS26"]);
  });

  it("base groups appear canonical-then-secondary, in release order", () => {
    const sets = [makeSet("TS26"), makeSet("SHD"), makeSet("SOR"), makeSet("IBH")];
    const { baseGroups } = allSetsGroups(sets);
    expect(baseGroups.map((g) => g.key)).toEqual(["SOR", "SHD", "IBH", "TS26"]);
  });

  it("only renders Exclusives subgroups that have at least one present member", () => {
    const sets = [makeSet("C24", { is_base_set: false }), makeSet("C25", { is_base_set: false })];
    const { exclusiveGroups } = allSetsGroups(sets);
    expect(exclusiveGroups).toHaveLength(1);
    expect(exclusiveGroups[0].label).toBe("Convention Exclusives");
    expect(exclusiveGroups[0].logoCode).toBeNull();
    expect(exclusiveGroups[0].memberCodes).toEqual(["C24", "C25"]);
  });

  it("omits every Exclusives subgroup when no exclusive sets are present", () => {
    const sets = [makeSet("SOR")];
    const { exclusiveGroups } = allSetsGroups(sets);
    expect(exclusiveGroups).toEqual([]);
  });

  it("full roster: base groups then Exclusives subgroups, in the doc's fixed order", () => {
    const sets = [
      ...BASE_SET_ORDER.map((c) => makeSet(c)),
      makeSet("SORP", { is_base_set: false }),
      makeSet("J24", { is_base_set: false }),
      makeSet("J25", { is_base_set: false }),
      makeSet("P25", { is_base_set: false }),
      makeSet("MV26", { is_base_set: false }),
    ];
    const { baseGroups, exclusiveGroups } = allSetsGroups(sets);
    expect(baseGroups.map((g) => g.key)).toEqual(BASE_SET_ORDER);
    expect(baseGroups[0].memberCodes).toEqual(["SOR", "SORP"]);
    expect(exclusiveGroups.map((g) => g.label)).toEqual([
      "Judge Program",
      "Promos",
      "Other promos",
    ]);
    expect(exclusiveGroups[0].memberCodes).toEqual(["J24", "J25"]);
    expect(exclusiveGroups[1].memberCodes).toEqual(["P25"]);
    expect(exclusiveGroups[2].memberCodes).toEqual(["MV26"]);
  });
});
