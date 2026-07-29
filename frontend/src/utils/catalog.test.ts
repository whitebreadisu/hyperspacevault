import { describe, it, expect } from "vitest";
import { CURATED_SET_ORDER, orderSetCodes, sortBaseCards } from "./catalog";
import type { BaseCard } from "./catalog";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeBaseCard(overrides: Partial<BaseCard> = {}): BaseCard {
  return {
    base_card_id: 1,
    set_code: "SOR",
    base_card_number: "1",
    name: "Card",
    subtitle: null,
    type: "Unit",
    rarity: "C",
    aspects: [],
    keywords: [],
    traits: [],
    cost: null,
    power: null,
    hp: null,
    arena: null,
    is_token: false,
    variants: [],
    ...overrides,
  };
}

// ── sortBaseCards (Change B / redesign spec §5.2-§5.3) ─────────────────────
//
// DISPOSITION: no dedicated grouping-sort test existed before this change
// (the old set_code-alphabetical-then-number behavior was only exercised
// incidentally via the now-default sort path in groupByBaseCard /
// groupWithInventory). This is a NEW test suite, not a port, covering the
// new standard sort: (1) set in release order — release_date when present,
// else curated fallback order, else last (tiebroken by set_code) —
// (2) tokens last within a set, (3) base_card_number ascending numeric.
//
// DISPOSITION (REPLACE): the original "null release_date" and "absent from
// setOrder" tests used SOR/SHD/PRM/PRZ/ZZZ and asserted set_code-tiebreak
// ordering among them. SOR and SHD are now in CURATED_SET_ORDER, so those
// fixtures no longer exercise the "no curated entry" path. Replaced with
// sets outside CURATED_SET_ORDER (e.g. PRM/PRZ/ZZZ) to keep covering the
// final tiebreak tier, and added new tests for the curated-order tier
// itself plus the precedence of release_date over the curated index.

describe("sortBaseCards", () => {
  const setOrder = { SOR: "2024-03-08", SHD: "2024-08-02" };

  it("orders by release date across sets, not alphabetically by set_code", () => {
    const shd = makeBaseCard({ base_card_id: 1, set_code: "SHD", base_card_number: "1" });
    const sor = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" });
    const result = sortBaseCards([shd, sor], setOrder);
    expect(result.map((c) => c.set_code)).toEqual(["SOR", "SHD"]);
  });

  it("falls back to curated set order when no release_date is present", () => {
    const ts26 = makeBaseCard({ base_card_id: 1, set_code: "TS26", base_card_number: "1" });
    const sor = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" });
    const lof = makeBaseCard({ base_card_id: 3, set_code: "LOF", base_card_number: "1" });
    const result = sortBaseCards([ts26, sor, lof]);
    expect(result.map((c) => c.set_code)).toEqual(["SOR", "LOF", "TS26"]);
  });

  it("lets a present release_date take precedence over the curated index", () => {
    // TS26 is last in CURATED_SET_ORDER, but an explicit early release_date
    // should still win over SOR's curated (earlier) index.
    const ts26 = makeBaseCard({ base_card_id: 1, set_code: "TS26", base_card_number: "1" });
    const sor = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" });
    const result = sortBaseCards([sor, ts26], { TS26: "2020-01-01", SOR: "2024-03-08" });
    expect(result.map((c) => c.set_code)).toEqual(["TS26", "SOR"]);
  });

  it("sorts sets with no release_date and no curated entry last, tiebroken by set_code", () => {
    const noDateB = makeBaseCard({ base_card_id: 1, set_code: "PRZ", base_card_number: "1" });
    const noDateA = makeBaseCard({ base_card_id: 2, set_code: "PRM", base_card_number: "1" });
    const dated = makeBaseCard({ base_card_id: 3, set_code: "SOR", base_card_number: "1" });
    const result = sortBaseCards([noDateB, dated, noDateA], setOrder);
    expect(result.map((c) => c.set_code)).toEqual(["SOR", "PRM", "PRZ"]);
  });

  it("treats a set absent from setOrder and curated order the same as a null release_date", () => {
    const unknown = makeBaseCard({ base_card_id: 1, set_code: "ZZZ", base_card_number: "1" });
    const dated = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" });
    const result = sortBaseCards([unknown, dated], setOrder);
    expect(result.map((c) => c.set_code)).toEqual(["SOR", "ZZZ"]);
  });

  it("ranks a curated-but-undated set ahead of a non-curated, non-dated set", () => {
    const unknown = makeBaseCard({ base_card_id: 1, set_code: "ZZZ", base_card_number: "1" });
    const curated = makeBaseCard({ base_card_id: 2, set_code: "LAW", base_card_number: "1" });
    const result = sortBaseCards([unknown, curated]);
    expect(result.map((c) => c.set_code)).toEqual(["LAW", "ZZZ"]);
  });

  it("orders all ten base sets per CURATED_SET_ORDER when none have a release_date", () => {
    const cards = CURATED_SET_ORDER.slice()
      .reverse()
      .map((setCode, i) =>
        makeBaseCard({ base_card_id: i, set_code: setCode, base_card_number: "1" })
      );
    const result = sortBaseCards(cards);
    expect(result.map((c) => c.set_code)).toEqual(CURATED_SET_ORDER);
  });

  it("sorts tokens after non-tokens within the same set", () => {
    const token = makeBaseCard({
      base_card_id: 1,
      set_code: "SOR",
      base_card_number: "1",
      is_token: true,
    });
    const nonToken = makeBaseCard({
      base_card_id: 2,
      set_code: "SOR",
      base_card_number: "2",
      is_token: false,
    });
    const result = sortBaseCards([token, nonToken], setOrder);
    expect(result.map((c) => c.base_card_id)).toEqual([2, 1]);
  });

  it("sorts by base_card_number numerically ascending within a set, after the token split", () => {
    const ten = makeBaseCard({ base_card_id: 1, set_code: "SOR", base_card_number: "10" });
    const two = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "2" });
    const result = sortBaseCards([ten, two], setOrder);
    expect(result.map((c) => c.base_card_number)).toEqual(["2", "10"]);
  });

  it("does not mutate the input array", () => {
    const cards = [
      makeBaseCard({ base_card_id: 1, set_code: "SHD", base_card_number: "1" }),
      makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" }),
    ];
    const original = [...cards];
    sortBaseCards(cards, setOrder);
    expect(cards).toEqual(original);
  });
});

// CREATE (BL-163): orderSetCodes shares sortBaseCards' release-order rule
// (setReleaseRank) at the set-code level rather than the card level -- the
// completion panel's "by set" breakdown rows need a plain ordered list of
// set codes, not full BaseCard objects. Same three-tier precedence
// (release_date, then curated fallback, then set_code tiebreak) is exercised
// here directly rather than re-deriving it through a card fixture.
describe("orderSetCodes (BL-163)", () => {
  it("orders by release date across codes, not alphabetically", () => {
    const result = orderSetCodes(["SHD", "SOR"], { SOR: "2024-03-08", SHD: "2024-08-02" });
    expect(result).toEqual(["SOR", "SHD"]);
  });

  it("falls back to curated set order when no release_date is present", () => {
    const result = orderSetCodes(["TS26", "SOR", "LOF"]);
    expect(result).toEqual(["SOR", "LOF", "TS26"]);
  });

  it("lets a present release_date take precedence over the curated index", () => {
    const result = orderSetCodes(["SOR", "TS26"], { TS26: "2020-01-01", SOR: "2024-03-08" });
    expect(result).toEqual(["TS26", "SOR"]);
  });

  it("sorts codes with no release_date and no curated entry last, tiebroken by code", () => {
    const result = orderSetCodes(["PRZ", "SOR", "PRM"], { SOR: "2024-03-08" });
    expect(result).toEqual(["SOR", "PRM", "PRZ"]);
  });

  it("does not mutate the input array", () => {
    const codes = ["SHD", "SOR"];
    const original = [...codes];
    orderSetCodes(codes, { SOR: "2024-03-08", SHD: "2024-08-02" });
    expect(codes).toEqual(original);
  });

  it("orders all ten base sets per CURATED_SET_ORDER when none have a release_date", () => {
    const result = orderSetCodes([...CURATED_SET_ORDER].reverse());
    expect(result).toEqual(CURATED_SET_ORDER);
  });
});

// DISPOSITION (BL-44 Slice B, RETIRE): groupByBaseCard's dedicated
// "sort wiring" suite is retired along with the function. Its only caller
// (CardsPage's anonymous branch: groupByBaseCard(getCards()) then
// withoutInventory) was removed -- GET /api/base-cards now returns base
// cards already grouped with nested variants for both auth states, so there
// is no flat Card[] left in the app to group client-side. The sort-wiring
// behavior itself isn't lost: toInventoryCards (utils/inventory.ts) is the
// new caller of sortBaseCards and carries the equivalent coverage in
// utils/inventory.test.ts.
