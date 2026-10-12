import { describe, it, expect } from "vitest";
import { orderSetCodes, setReleaseRank, sortBaseCards } from "./catalog";
import type { BaseCard } from "./catalog";

// BL-258 (owner 2026-10-12): the single literal expectation for the base
// block -- main sets newest first, then IBH, TS26. (A literal, not imported,
// so the tests pin the order rather than echo the constant.)
const NEW_BASE_ORDER = [
  "HMW",
  "ASH",
  "LAW",
  "SEC",
  "LOF",
  "JTL",
  "TWI",
  "SHD",
  "SOR",
  "IBH",
  "TS26",
];

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
// new standard sort: (1) set in display order (newest main set first; sets
// outside it by release_date, else last, tiebroken by set_code) —
// (2) tokens last within a set, (3) base_card_number ascending numeric.
//
// DISPOSITION (REPLACE): the original "null release_date" and "absent from
// setOrder" tests used SOR/SHD/PRM/PRZ/ZZZ and asserted set_code-tiebreak
// ordering among them. SOR and SHD are base sets (ranked by their place in
// BASE_SET_ORDER; the former CURATED_SET_ORDER array has since been removed,
// BL-258), so those fixtures no longer exercise the "unranked set" path.
// Replaced with sets outside the base block (e.g. PRM/PRZ/ZZZ) to keep
// covering the final tiebreak tier, and added new tests for the base-set tier
// itself plus the rule that a release_date never reorders a base set.

describe("sortBaseCards", () => {
  const setOrder = { SOR: "2024-03-08", SHD: "2024-08-02" };

  // PORT (BL-258): was "orders by release date across sets" (SOR, SHD). Same
  // intent -- order follows the release sequence, not alphabetical set_code --
  // now newest first, driven by the base-set order, not release_date.
  it("orders main sets newest first across sets, not alphabetically by set_code", () => {
    const shd = makeBaseCard({ base_card_id: 1, set_code: "SHD", base_card_number: "1" });
    const sor = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" });
    const result = sortBaseCards([sor, shd], setOrder);
    expect(result.map((c) => c.set_code)).toEqual(["SHD", "SOR"]);
  });

  // CREATE (BL-258): release_date still orders the sets that are not in the
  // base-set order (the old date tier, now below every base/Weekly Play set).
  it("still orders non-base sets by release date, after every base set", () => {
    const p26 = makeBaseCard({ base_card_id: 1, set_code: "P26", base_card_number: "1" });
    const p25 = makeBaseCard({ base_card_id: 2, set_code: "P25", base_card_number: "1" });
    const ts26 = makeBaseCard({ base_card_id: 3, set_code: "TS26", base_card_number: "1" });
    const result = sortBaseCards([p26, p25, ts26], { P25: "2025-01-01", P26: "2026-01-01" });
    expect(result.map((c) => c.set_code)).toEqual(["TS26", "P25", "P26"]);
  });

  it("falls back to curated set order when no release_date is present", () => {
    const ts26 = makeBaseCard({ base_card_id: 1, set_code: "TS26", base_card_number: "1" });
    const sor = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" });
    const lof = makeBaseCard({ base_card_id: 3, set_code: "LOF", base_card_number: "1" });
    const result = sortBaseCards([ts26, sor, lof]);
    expect(result.map((c) => c.set_code)).toEqual(["LOF", "SOR", "TS26"]); // PORT (BL-258)
  });

  // REPLACE (BL-258): was "lets a present release_date take precedence over
  // the curated index" (TS26 with an early date sorted before SOR). That
  // behaviour is designed away: a base set's place comes from the single
  // base-set order, so an explicit release_date never reorders base sets.
  it("does not let a release_date reorder base sets", () => {
    const ts26 = makeBaseCard({ base_card_id: 1, set_code: "TS26", base_card_number: "1" });
    const sor = makeBaseCard({ base_card_id: 2, set_code: "SOR", base_card_number: "1" });
    const result = sortBaseCards([ts26, sor], { TS26: "2020-01-01", SOR: "2024-03-08" });
    expect(result.map((c) => c.set_code)).toEqual(["SOR", "TS26"]);
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

  // PORT (BL-258): same all-base-sets walk, expectation is the new literal.
  it("orders all base sets newest first when none have a release_date", () => {
    const cards = NEW_BASE_ORDER.slice()
      .reverse()
      .map((setCode, i) =>
        makeBaseCard({ base_card_id: i, set_code: setCode, base_card_number: "1" })
      );
    const result = sortBaseCards(cards);
    expect(result.map((c) => c.set_code)).toEqual(NEW_BASE_ORDER);
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

// CREATE (BL-163): orderSetCodes shares sortBaseCards' display-order rule
// (setReleaseRank) at the set-code level rather than the card level -- the
// completion panel's "by set" breakdown rows need a plain ordered list of
// set codes, not full BaseCard objects. Same three-tier precedence
// (base-set position, then release_date, then set_code tiebreak) is exercised
// here directly rather than re-deriving it through a card fixture.
describe("orderSetCodes (BL-163)", () => {
  // PORT (BL-258): newest first; release_date no longer drives base sets.
  it("orders main sets newest first across codes, not alphabetically", () => {
    const result = orderSetCodes(["SOR", "SHD"], { SOR: "2024-03-08", SHD: "2024-08-02" });
    expect(result).toEqual(["SHD", "SOR"]);
  });

  it("falls back to curated set order when no release_date is present", () => {
    const result = orderSetCodes(["TS26", "SOR", "LOF"]);
    expect(result).toEqual(["LOF", "SOR", "TS26"]); // PORT (BL-258)
  });

  // REPLACE (BL-258): see the sortBaseCards twin -- release_date never
  // reorders base sets any more.
  it("does not let a release_date reorder base sets", () => {
    const result = orderSetCodes(["TS26", "SOR"], { TS26: "2020-01-01", SOR: "2024-03-08" });
    expect(result).toEqual(["SOR", "TS26"]);
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

  // PORT (BL-258): same walk, new literal expectation.
  it("orders all base sets newest first when none have a release_date", () => {
    const result = orderSetCodes([...NEW_BASE_ORDER].reverse());
    expect(result).toEqual(NEW_BASE_ORDER);
  });
});

describe("FR2-02 setReleaseRank comes from the base-set order (BL-258)", () => {
  it("fr2-02 ranks HMW < ASH < ... < SOR < IBH < TS26 and SORP sits directly after SOR", () => {
    const codes = [
      "SORP",
      "TS26",
      "IBH",
      "SOR",
      "SHD",
      "TWI",
      "JTL",
      "LOF",
      "SEC",
      "LAW",
      "ASH",
      "HMW",
    ];
    expect(orderSetCodes(codes)).toEqual([
      "HMW",
      "ASH",
      "LAW",
      "SEC",
      "LOF",
      "JTL",
      "TWI",
      "SHD",
      "SOR",
      "SORP",
      "IBH",
      "TS26",
    ]);
  });

  it("fr2-02 a Weekly Play code follows its base even when it carries a release_date", () => {
    const order = { SORP: "2024-03-08", SOR: "2024-03-08", SHDP: "2024-08-02" };
    expect(orderSetCodes(["SOR", "SHDP", "SORP", "SHD", "IBH"], order)).toEqual([
      "SHD",
      "SHDP",
      "SOR",
      "SORP",
      "IBH",
    ]);
    expect(setReleaseRank("SORP", order)[0]).toBe(0);
  });

  it("fr2-02 an explicit release_date no longer reorders main sets", () => {
    expect(orderSetCodes(["SOR", "HMW"], { SOR: "2099-01-01", HMW: "2000-01-01" })).toEqual([
      "HMW",
      "SOR",
    ]);
  });

  it("fr2-02 non-base dated sets and unknown codes keep their old relative order after TS26", () => {
    const order = { P25: "2025-01-01", P26: "2026-01-01" };
    expect(orderSetCodes(["ZZZ", "P26", "TS26", "AAA", "P25"], order)).toEqual([
      "TS26",
      "P25",
      "P26",
      "AAA",
      "ZZZ",
    ]);
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
