import { describe, expect, it } from "vitest";
import type { BaseCardCatalog } from "../../api/baseCards";
import type { CardSet } from "../../api/sets";
import cardsJson from "../../../e2e/mobile/fixtures/base-cards.json";
import qtyJson from "../../../e2e/mobile/fixtures/quantities.json";
import setsJson from "../../../e2e/mobile/fixtures/sets.json";
import { resolveRow } from "../../utils/addCardsResolver";
import { toInventoryCards } from "../../utils/inventory";
import {
  EXCLUSIVE_SUBGROUPS,
  SET_CANONICAL,
  SET_SECONDARY,
  weeklyPlayCodeFor,
} from "../../utils/setGrouping";
import { setPickerGroups } from "../filters/filterModel";
import { mergeQuantities } from "../vault/useVaultData";
import {
  PRECON_ENTRIES,
  padNumbers,
  padReadout,
  padSetBase,
  padView,
  preconShort,
  rowFor,
  setSheetGroups,
  toCatalog,
} from "./padModel";
import { NO_PICKS } from "./toolStore";
import type { BatchRow } from "./batch";

const sets = setsJson as CardSet[];
const qty: Record<number, number> = Object.fromEntries(
  qtyJson.map((q) => [q.variant_id, q.quantity])
);
const order = Object.fromEntries(sets.map((s) => [s.code, s.release_date]));
const cards = toInventoryCards(mergeQuantities(cardsJson as BaseCardCatalog[], qty), order);
const catalog = toCatalog(cards);

describe("S3-02 keypad resolver wiring (desktop resolveRow)", () => {
  it("a single printing resolves to its card, printing and art", () => {
    const v = padView("SOR", "87", NO_PICKS, catalog, cards);
    expect(v.kind).toBe("card");
    if (v.kind !== "card") return;
    expect(v.resolved.status).toBe("resolved");
    expect(v.card?.name).toBe("Darth Vader");
    expect(v.variant?.variant_type).toBe("Standard");
    // SOR 87 is shared by Standard / Standard Foil: BL-191 non-foil default.
    expect(v.choices.map((c) => c.axis)).toEqual(["finish"]);
    expect(v.choices[0].defaulted).toBe(true);
    expect(v.hint).toEqual({
      text: "Card number is shared across variants. Verify selection.",
      attn: true,
    });
  });

  it("a finish share keeps desktop's non-foil default; a pick overrides it", () => {
    const def = padView("SOR", "35", NO_PICKS, catalog, cards);
    expect(def.kind === "card" && def.variant?.finish).toBe("Standard");
    const foil = padView("SOR", "35", { ...NO_PICKS, finish: "Standard Foil" }, catalog, cards);
    expect(foil.kind === "card" && foil.variant?.finish).toBe("Standard Foil");
    expect(foil.kind === "card" && foil.choices[0].defaulted).toBe(false);
  });

  it("a multi-card number offers desktop's Which card? axis, defaulted to the base-set card", () => {
    const v = padView("SOR", "2", NO_PICKS, catalog, cards);
    expect(v.kind).toBe("card");
    if (v.kind !== "card") return;
    const which = v.choices.find((c) => c.axis === "cardKey")!;
    // Desktop groups by name + subtitle: SOR 2 is two Vaders (the SOR
    // Hyperspace leader and the C24 #2 unit, home set SOR) and Luke.
    expect(which.options.map((o) => o.l1).sort()).toEqual([
      "Darth Vader",
      "Darth Vader",
      "Luke Skywalker",
    ]);
    expect(which.value?.startsWith("Darth Vader")).toBe(true);
    // Same as desktop: the resolver is the single source of the variant.
    const desk = resolveRow(rowFor("x", "SOR", "2", NO_PICKS), catalog);
    expect(desk.status === "resolved" && desk.variantId).toBe(v.variant?.variant_id);
    const lukeKey = which.options.find((o) => o.l1 === "Luke Skywalker")!.value;
    const luke = padView("SOR", "2", { ...NO_PICKS, cardKey: lukeKey }, catalog, cards);
    expect(luke.kind === "card" && luke.resolved.name).toBe("Luke Skywalker");
  });

  it("a number the set does not carry is a miss; empty is empty", () => {
    expect(padView("SOR", "57", NO_PICKS, catalog, cards).kind).toBe("miss");
    expect(padView("SOR", "", NO_PICKS, catalog, cards).kind).toBe("empty");
  });

  it("a Weekly Play set resolves its own printing (LAWP 13 = C-3PO)", () => {
    const v = padView("LAWP", "13", NO_PICKS, catalog, cards);
    expect(v.kind === "card" && v.card?.name).toBe("C-3PO");
    expect(v.kind === "card" && v.variant?.source_set_code).toBe("LAWP");
  });

  it("padNumbers lists the set's own numbers ascending", () => {
    const nums = padNumbers("SOR", catalog);
    expect(nums).toContain("87");
    expect(nums.map(Number)).toEqual([...nums.map(Number)].sort((a, b) => a - b));
  });
});

describe("S3-03 readout (desktop inventoryStatus numbers, F-1 colours)", () => {
  const limitsNull = null;
  it("At the limit the In vault line is red; under it After add counts entries", () => {
    // Variant 6791 (SOR 35 Standard) is owned 3: a playset at the default 3.
    const at = padReadout("SOR", "35", NO_PICKS, [], catalog, limitsNull, "hard")!;
    expect(at).toMatchObject({ owned: 3, limit: 3, atLimit: true, overLimit: false });
    // Variant 7221 (SOR 87 Standard) is owned 1 in the fixture.
    const r0 = padReadout("SOR", "87", NO_PICKS, [], catalog, limitsNull, "hard")!;
    expect(r0).toMatchObject({ owned: 1, limit: 3, after: 2, atLimit: false, afterOver: false });
    const e = (i: number): BatchRow => ({
      id: "e" + i,
      via: "keypad",
      force: false,
      setCode: "SOR",
      cardNumber: "87",
      picks: NO_PICKS,
      variantId: 7221,
      baseCardId: 814,
    });
    const r3 = padReadout("SOR", "87", NO_PICKS, [e(1), e(2), e(3)], catalog, limitsNull, "hard")!;
    expect(r3).toMatchObject({ owned: 1, after: 5, atLimit: false, afterOver: true });
  });
});

describe("S3-05 set / precon choosers = desktop constants", () => {
  const present = new Set(sets.map((s) => s.code));
  // PORT (BL-258): same derivation from the shared constants; "release order"
  // is now the newest-first display order (literal pinned by FR2-05 below).
  it("Base sets only = canonical newest first, then secondary", () => {
    const g = setSheetGroups(sets);
    expect(g.base.canonical.map((x) => x.key)).toEqual(SET_CANONICAL.filter((c) => present.has(c)));
    expect(g.base.secondary.map((x) => x.key)).toEqual(SET_SECONDARY.filter((c) => present.has(c)));
  });
  it("Show all sets nests each Weekly Play set under its base, then the Exclusives", () => {
    const g = setSheetGroups(sets);
    for (const bg of g.all.baseGroups) {
      const wp = weeklyPlayCodeFor(bg.key);
      expect(bg.memberCodes).toEqual(present.has(wp) ? [bg.key, wp] : [bg.key]);
    }
    expect(g.all.exclusiveGroups.map((x) => x.label)).toEqual(
      EXCLUSIVE_SUBGROUPS.filter((s) => s.codes.some((c) => present.has(c))).map((s) => s.label)
    );
    // Every set the API returns is reachable in one of the two views.
    const shown = new Set([
      ...g.all.baseGroups.flatMap((x) => x.memberCodes),
      ...g.all.exclusiveGroups.flatMap((x) => x.memberCodes),
    ]);
    expect([...present].filter((c) => !shown.has(c))).toEqual([]);
  });
  it("the set button borrows a Weekly Play set's base logo; an exclusive has none", () => {
    expect(padSetBase("LAW")).toBe("LAW");
    expect(padSetBase("LAWP")).toBe("LAW");
    expect(padSetBase("C24")).toBeNull();
  });
  it("the precon list is desktop's 23 entries (22 decks + the Hoth box)", () => {
    expect(PRECON_ENTRIES).toHaveLength(23);
    expect(PRECON_ENTRIES.filter((e) => e.kind === "ibhBox")).toHaveLength(1);
    expect(preconShort(PRECON_ENTRIES.find((e) => e.key === "SOR-VADER")!)).toBe("Vader");
    expect(preconShort(PRECON_ENTRIES.find((e) => e.key === "IBH")!)).toBe("Box");
  });
});

// CREATE (BL-258): FR2-05 -- literal phone picker orders (the e2e fixture
// now carries HMW and HMWP, so HMW is observable first).
describe("FR2-05 phone set pickers newest first (BL-258)", () => {
  it("fr2-05 keypad chooser: HMW is the first row, IBH and TS26 last in the base block", () => {
    const g = setSheetGroups(sets);
    expect(g.base.canonical.map((x) => x.key)).toEqual([
      "HMW",
      "ASH",
      "LAW",
      "SEC",
      "LOF",
      "JTL",
      "TWI",
      "SHD",
      "SOR",
    ]);
    expect(g.base.secondary.map((x) => x.key)).toEqual(["IBH", "TS26"]);
    expect(g.all.baseGroups.map((x) => x.key)).toEqual([
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
    ]);
    expect(g.all.baseGroups[0].memberCodes).toEqual(["HMW", "HMWP"]);
  });

  it("fr2-05 Set picker (Filters): HMW is the first logo chip; Weekly Play tail mirrors it", () => {
    const g = setPickerGroups(sets);
    expect(g.base[0]).toBe("HMW");
    expect(g.base.slice(-3)).toEqual(["SOR", "IBH", "TS26"]);
    expect(g.weekly[0]).toBe("HMWP");
    expect(g.weekly.slice(-1)).toEqual(["SORP"]);
  });
});
