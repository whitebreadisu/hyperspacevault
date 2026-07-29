import { describe, it, expect } from "vitest";
import {
  applyFilters,
  DEFAULT_FILTERS,
  NO_ASPECT,
  ASPECT_LIST,
  ASPECT_MATCH_MODES,
  facetValidValues,
  facetedOptions,
  isDefaultFilterState,
  buildFinishTree,
  shapeFinishTree,
  COST_MAX,
  POWER_MAX,
  HP_MAX,
} from "./filters";
import type { FilterState, AspectMatchMode, FinishTreeRow } from "./filters";
import type { BaseCard, Variant } from "./catalog";

// ── Helpers ───────────────────────────────────────────────────────────────
// Same factories as FilterPanel.test.tsx -- duplicated (they're small) so
// each test file stays self-contained after the RR-22 logic/UI split.

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "001",
    front_image_url: null,
    back_image_url: null,
    ...overrides,
  };
}

function makeCard(overrides: Partial<BaseCard> = {}): BaseCard {
  return {
    base_card_id: 1,
    set_code: "SOR",
    base_card_number: "001",
    name: "Test Unit",
    subtitle: null,
    // swuapi rarity is a full word (Common/Uncommon/Rare/Legendary/Special),
    // matching what the API returns — not a single-letter code.
    rarity: "Common",
    type: "Unit",
    aspects: [],
    keywords: [],
    traits: [],
    cost: null,
    power: null,
    hp: null,
    arena: null,
    is_token: false,
    variants: [makeVariant()],
    ...overrides,
  };
}

function withSearch(search: string): FilterState {
  return { ...DEFAULT_FILTERS, aspects: new Set(DEFAULT_FILTERS.aspects), search };
}

// ── applyFilters tests ────────────────────────────────────────────────────
// DISPOSITION (PORT, RR-22): moved verbatim from components/FilterPanel.test.tsx
// alongside the extracted logic -- assertion content unchanged.

describe("applyFilters", () => {
  it("matches card by name when search term is in the name", () => {
    const cards = [
      makeCard({ name: "Luke Skywalker" }),
      makeCard({ base_card_number: "002", name: "Darth Vader" }),
    ];
    const result = applyFilters(cards, withSearch("luke"));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Luke Skywalker");
  });

  it("matches card by subtitle when search term is in the subtitle portion", () => {
    const cards = [
      makeCard({ name: "Director Krennic - Aspiring to Authority", type: "Leader" }),
      makeCard({ base_card_number: "002", name: "Luke Skywalker" }),
    ];
    const result = applyFilters(cards, withSearch("aspiring"));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Director Krennic - Aspiring to Authority");
  });

  it("excludes cards that do not match the search term", () => {
    const cards = [makeCard({ name: "Han Solo" })];
    const result = applyFilters(cards, withSearch("vader"));
    expect(result).toHaveLength(0);
  });

  it("returns only cards that have the selected finish", () => {
    const standard = makeCard({
      base_card_number: "001",
      variants: [makeVariant({ finish: "Standard" })],
    });
    const foil = makeCard({
      base_card_number: "002",
      variants: [makeVariant({ variant_id: 2, finish: "Standard Foil" })],
    });
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(DEFAULT_FILTERS.aspects),
      finish: new Set(["Standard Foil"]),
    };
    const result = applyFilters([standard, foil], filters);
    expect(result).toHaveLength(1);
    expect(result[0].base_card_number).toBe("002");
  });

  it("excludes cards outside the cost range", () => {
    const low = makeCard({ base_card_number: "001", cost: 2 });
    const mid = makeCard({ base_card_number: "002", cost: 5 });
    const high = makeCard({ base_card_number: "003", cost: 10 });
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(DEFAULT_FILTERS.aspects),
      costRange: [3, 7],
    };
    const result = applyFilters([low, mid, high], filters);
    expect(result).toHaveLength(1);
    expect(result[0].base_card_number).toBe("002");
  });

  it("excludes cards with null cost when cost range is narrowed", () => {
    const nullCost = makeCard({ cost: null });
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(DEFAULT_FILTERS.aspects),
      costRange: [1, 5],
    };
    const result = applyFilters([nullCost], filters);
    expect(result).toHaveLength(0);
  });

  // Change A (redesign spec §5.2): the Set filter is provenance-layered —
  // a base card matches if its own set_code is selected, OR any of its
  // variants' source_set_code is selected. This makes long-tail/container
  // set selections (e.g. a Weekly Play set) return the base cards that have
  // a promo variant sourced from that set, even though the base card's own
  // set_code is a root set like SOR.
  it("matches a base card on a long-tail container set via variant source_set_code", () => {
    const rootOnly = makeCard({
      base_card_number: "001",
      set_code: "SOR",
      variants: [makeVariant({ source_set_code: "SOR" })],
    });
    const withLongTailVariant = makeCard({
      base_card_number: "002",
      set_code: "SOR",
      variants: [
        makeVariant({ variant_id: 1, source_set_code: "SOR" }),
        makeVariant({ variant_id: 2, source_set_code: "LOFP", card_number: "P1" }),
      ],
    });
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(DEFAULT_FILTERS.aspects),
      set: new Set(["LOFP"]),
    };
    const result = applyFilters([rootOnly, withLongTailVariant], filters);
    expect(result).toHaveLength(1);
    expect(result[0].base_card_number).toBe("002");
  });

  it("still matches a base card by its own set_code when no variant carries that source", () => {
    const card = makeCard({ set_code: "SOR", variants: [makeVariant({ source_set_code: "SOR" })] });
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(DEFAULT_FILTERS.aspects),
      set: new Set(["SOR"]),
    };
    const result = applyFilters([card], filters);
    expect(result).toHaveLength(1);
  });
});

// ── Aspect filter (BL-90) ────────────────────────────────────────────────
//
// DISPOSITION (existing tests above, no change needed): every `...
// aspects: new Set(DEFAULT_FILTERS.aspects)` spread above copies whatever
// the *current* default is -- it never hard-coded "all 6 selected." Now
// that DEFAULT_FILTERS.aspects is empty, those cards (all aspectless via
// makeCard's `aspects: []` default) pass through the new "empty aspects =
// unfiltered" path instead of the old "all-selected" path. Same outcome,
// different mechanism -- nothing to port or replace, behavior is preserved.

describe("applyFilters — aspects (BL-90)", () => {
  it("empty aspect selection is unfiltered: aspected and aspectless cards both pass", () => {
    const aspected = makeCard({ base_card_number: "001", aspects: ["Command"] });
    const aspectless = makeCard({ base_card_number: "002", aspects: [] });
    const result = applyFilters([aspected, aspectless], { ...DEFAULT_FILTERS, aspects: new Set() });
    expect(result).toHaveLength(2);
  });

  it("NO_ASPECT selected returns exactly the aspectless cards (previously unreachable query)", () => {
    const aspected = makeCard({ base_card_number: "001", aspects: ["Command"] });
    const aspectless = makeCard({ base_card_number: "002", aspects: [] });
    const filters: FilterState = { ...DEFAULT_FILTERS, aspects: new Set([NO_ASPECT]) };
    const result = applyFilters([aspected, aspectless], filters);
    expect(result).toHaveLength(1);
    expect(result[0].base_card_number).toBe("002");
  });

  it("a real-aspect-only selection still excludes aspectless cards (no accidental broadening)", () => {
    const command = makeCard({ base_card_number: "001", aspects: ["Command"] });
    const aspectless = makeCard({ base_card_number: "002", aspects: [] });
    const filters: FilterState = { ...DEFAULT_FILTERS, aspects: new Set(["Command"]) };
    const result = applyFilters([command, aspectless], filters);
    expect(result).toHaveLength(1);
    expect(result[0].base_card_number).toBe("001");
  });

  // DISPOSITION (REPLACE, BL-130): DEFAULT_FILTERS.aspectMode is now "exact"
  // (issue #306, owner-locked 2026-07-14) instead of implicit any-of, so a
  // 2+ value selection spread from DEFAULT_FILTERS no longer exercises OR
  // semantics unless the mode is pinned explicitly. This test's original
  // intent -- "NO_ASPECT unions with a real aspect" -- is still true, just
  // Any-mode-specific now; the Exact-mode counterpart for this same
  // selection (nothing matches -- no card is simultaneously aspectless and
  // aspected) is covered in the BL-130 matrix below.
  it("NO_ASPECT combined with a real aspect is a standard any-of union (Any mode)", () => {
    const command = makeCard({ base_card_number: "001", aspects: ["Command"] });
    const aggression = makeCard({ base_card_number: "002", aspects: ["Aggression"] });
    const aspectless = makeCard({ base_card_number: "003", aspects: [] });
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(["Command", NO_ASPECT]),
      aspectMode: "any",
    };
    const result = applyFilters([command, aggression, aspectless], filters);
    expect(result.map((c) => c.base_card_number).sort()).toEqual(["001", "003"]);
  });

  // DISPOSITION (REPLACE, BL-130): same reasoning -- this test's "any one of
  // its aspects" premise is Any-mode's definition specifically now that
  // Exact is the default; pinned explicitly here. The Exact-mode result for
  // this same card/selection (excluded, since {Command, Aggression} !=
  // {Aggression}) is covered in the BL-130 matrix below.
  it("a multi-aspect card matches on any one of its aspects being selected (Any mode)", () => {
    const card = makeCard({ base_card_number: "001", aspects: ["Command", "Aggression"] });
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(["Aggression"]),
      aspectMode: "any",
    };
    const result = applyFilters([card], filters);
    expect(result).toHaveLength(1);
  });

  it("deselect-all is a stable state: re-applying an empty set after a narrowed selection returns everything again, no snap-back", () => {
    const cards = [
      makeCard({ base_card_number: "001", aspects: ["Command"] }),
      makeCard({ base_card_number: "002", aspects: [] }),
    ];
    const narrowed = applyFilters(cards, { ...DEFAULT_FILTERS, aspects: new Set(["Command"]) });
    expect(narrowed).toHaveLength(1);

    const cleared = applyFilters(cards, { ...DEFAULT_FILTERS, aspects: new Set() });
    expect(cleared).toHaveLength(2);
  });
});

// ── Aspect matching modes (BL-130, issue #306, CREATE) ──────────────────────
//
// Matrix across mode x selection size x aspectless cards. `pool` is shared
// by every test below: one mono-Aggression card, one mono-Villainy card,
// one dual Aggression+Villainy card, one mono-Command card (the "outside
// the selection" probe), and one aspectless card.

describe("applyFilters — aspect match modes (BL-130)", () => {
  const monoA = makeCard({ base_card_number: "A", aspects: ["Aggression"] });
  const monoV = makeCard({ base_card_number: "V", aspects: ["Villainy"] });
  const dualAV = makeCard({ base_card_number: "AV", aspects: ["Aggression", "Villainy"] });
  const monoC = makeCard({ base_card_number: "C", aspects: ["Command"] });
  const aspectless = makeCard({ base_card_number: "N", aspects: [] });
  const pool = [monoA, monoV, dualAV, monoC, aspectless];

  function ids(cards: typeof pool): string[] {
    return cards.map((c) => c.base_card_number).sort();
  }

  function withAspects(aspects: string[], mode: AspectMatchMode): FilterState {
    return { ...DEFAULT_FILTERS, aspects: new Set(aspects), aspectMode: mode };
  }

  it.each(ASPECT_MATCH_MODES)(
    "selection size 0: unfiltered in every mode (BL-90 semantics held constant) — %s",
    (mode) => {
      const result = applyFilters(pool, withAspects([], mode));
      expect(ids(result)).toEqual(ids(pool));
    }
  );

  // Issue #306's single-select degenerate case ("Within ≡ Exact ≡
  // mono-<aspect>") is specifically about Within/Exact -- Any is not
  // degenerate at size 1: it's still an OR match, so a multi-aspect card
  // carrying the selected aspect (dualAV carries Aggression) still passes.
  it("selection size 1 ({Aggression}), Any: matches every card carrying Aggression, including the dual-aspect card", () => {
    const result = applyFilters(pool, withAspects(["Aggression"], "any"));
    expect(ids(result)).toEqual(["A", "AV"]);
  });

  it.each(["within", "exact"] as const)(
    "selection size 1 ({Aggression}): Within and Exact collapse to the same mono-Aggression-only result (issue #306 degenerate case) — %s",
    (mode) => {
      const result = applyFilters(pool, withAspects(["Aggression"], mode));
      expect(ids(result)).toEqual(["A"]);
    }
  );

  describe("selection size 2+ ({Aggression, Villainy}): modes diverge", () => {
    const selection = ["Aggression", "Villainy"];

    it("Any matches every card carrying at least one selected aspect", () => {
      const result = applyFilters(pool, withAspects(selection, "any"));
      expect(ids(result)).toEqual(["A", "AV", "V"]);
    });

    it("Within matches every card whose own aspects are a subset of the selection (the deckbuilder question: mono-A, mono-V, and A+V all fit)", () => {
      const result = applyFilters(pool, withAspects(selection, "within"));
      expect(ids(result)).toEqual(["A", "AV", "V"]);
    });

    it("Exact matches only the card whose aspect set equals the selection exactly", () => {
      const result = applyFilters(pool, withAspects(selection, "exact"));
      expect(ids(result)).toEqual(["AV"]);
    });
  });

  describe("aspectless cards / NO_ASPECT across modes", () => {
    it.each(ASPECT_MATCH_MODES)(
      "{NO_ASPECT} alone matches only the aspectless card — %s",
      (mode) => {
        const result = applyFilters(pool, withAspects([NO_ASPECT], mode));
        expect(ids(result)).toEqual(["N"]);
      }
    );

    it("Any: {Aggression, NO_ASPECT} unions real-aspect matches with the aspectless card", () => {
      const result = applyFilters(pool, withAspects(["Aggression", NO_ASPECT], "any"));
      expect(ids(result)).toEqual(["A", "AV", "N"]);
    });

    it("Within: {Aggression, NO_ASPECT} matches mono-Aggression and aspectless, not the dual-aspect card (Villainy falls outside the selection)", () => {
      const result = applyFilters(pool, withAspects(["Aggression", NO_ASPECT], "within"));
      expect(ids(result)).toEqual(["A", "N"]);
    });

    it("Exact: {Aggression, NO_ASPECT} matches nothing — no card is simultaneously aspectless and aspected, so no card's aspect set ever equals a mixed real+sentinel selection", () => {
      const result = applyFilters(pool, withAspects(["Aggression", NO_ASPECT], "exact"));
      expect(result).toHaveLength(0);
    });
  });
});

describe("facetValidValues / facetedOptions — aspects (BL-90 x BL-70)", () => {
  it("No Aspect's faceted count reflects aspectless cards in the current (other-filters-applied) result set", () => {
    const cards = [
      makeCard({
        base_card_number: "001",
        set_code: "SOR",
        aspects: [],
        variants: [makeVariant({ variant_id: 1, source_set_code: "SOR" })],
      }),
      makeCard({
        base_card_number: "002",
        set_code: "JTL",
        aspects: [],
        variants: [makeVariant({ variant_id: 2, source_set_code: "JTL" })],
      }),
      makeCard({
        base_card_number: "003",
        set_code: "SOR",
        aspects: ["Command"],
        variants: [makeVariant({ variant_id: 3, source_set_code: "SOR" })],
      }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, aspects: new Set(), set: new Set(["SOR"]) };
    const valid = facetValidValues(cards, filters, "aspects");

    expect(valid).not.toBeNull();
    expect(valid!.has(NO_ASPECT)).toBe(true); // card 001: aspectless, in SOR
    expect(valid!.has("Command")).toBe(true); // card 003
    expect(valid!.has("Aggression")).toBe(false); // no SOR card carries it

    const universe = [
      ...ASPECT_LIST.map((a) => ({ value: a, label: a })),
      { value: NO_ASPECT, label: "No Aspect" },
    ];
    const opts = facetedOptions(universe, valid, new Set(), false);
    const noAspectOpt = opts.find((o) => o.value === NO_ASPECT)!;
    expect(noAspectOpt.inert).toBeUndefined();
    expect(noAspectOpt.label).toBe("No Aspect");
  });

  it("No Aspect goes inert (0-count) when the other active filters eliminate every aspectless card", () => {
    const cards = [
      makeCard({
        base_card_number: "001",
        set_code: "JTL",
        aspects: [],
        variants: [makeVariant({ variant_id: 1, source_set_code: "JTL" })],
      }),
      makeCard({
        base_card_number: "002",
        set_code: "SOR",
        aspects: ["Command"],
        variants: [makeVariant({ variant_id: 2, source_set_code: "SOR" })],
      }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, aspects: new Set(), set: new Set(["SOR"]) };
    const valid = facetValidValues(cards, filters, "aspects");
    expect(valid!.has(NO_ASPECT)).toBe(false);

    const opts = facetedOptions([{ value: NO_ASPECT, label: "No Aspect" }], valid, new Set(), true);
    expect(opts[0].inert).toBe(true);
    expect(opts[0].label).toBe("No Aspect (0)");
  });

  it("selecting a real aspect ignores aspects' own selection when faceting itself (dead-end-prevention): No Aspect stays visible even while Command is selected", () => {
    const cards = [
      makeCard({ base_card_number: "001", aspects: ["Command"] }),
      makeCard({ base_card_number: "002", aspects: [] }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, aspects: new Set(["Command"]) };
    const valid = facetValidValues(cards, filters, "aspects");
    // facetValidValues resets the target field's own selection before
    // computing validity, so selecting Command must not hide No Aspect.
    expect(valid!.has(NO_ASPECT)).toBe(true);
    expect(valid!.has("Command")).toBe(true);
  });

  // BL-130: facetValidValues folds `filters` (including aspectMode) straight
  // into applyFilters for every OTHER field's computation, so a field like
  // Type must see different valid values depending on the active aspect
  // mode -- Any admits both cards (both carry Aggression); Exact only
  // admits the mono-Aggression card (the dual-aspect card's set doesn't
  // equal {Aggression} exactly).
  it("facetValidValues for another field respects the active aspect mode (BL-130)", () => {
    const cards = [
      makeCard({ base_card_number: "001", type: "Unit", aspects: ["Aggression"] }),
      makeCard({ base_card_number: "002", type: "Base", aspects: ["Aggression", "Villainy"] }),
    ];
    const anyFilters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(["Aggression"]),
      aspectMode: "any",
    };
    const anyValid = facetValidValues(cards, anyFilters, "type");
    expect(anyValid!.has("Unit")).toBe(true);
    expect(anyValid!.has("Base")).toBe(true);

    const exactFilters: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(["Aggression"]),
      aspectMode: "exact",
    };
    const exactValid = facetValidValues(cards, exactFilters, "type");
    expect(exactValid!.has("Unit")).toBe(true);
    expect(exactValid!.has("Base")).toBe(false);
  });
});

// ── isDefaultFilterState (BL-91, CREATE) ────────────────────────────────────

describe("isDefaultFilterState", () => {
  it("is true for DEFAULT_FILTERS itself", () => {
    expect(isDefaultFilterState(DEFAULT_FILTERS)).toBe(true);
  });

  it("is true for a structurally-equal but distinct FilterState (independent Set/array instances -- reset must not rely on reference equality)", () => {
    const clone: FilterState = {
      ...DEFAULT_FILTERS,
      aspects: new Set(DEFAULT_FILTERS.aspects),
      set: new Set(DEFAULT_FILTERS.set),
      type: new Set(DEFAULT_FILTERS.type),
      rarity: new Set(DEFAULT_FILTERS.rarity),
      finish: new Set(DEFAULT_FILTERS.finish),
      keyword: new Set(DEFAULT_FILTERS.keyword),
      trait: new Set(DEFAULT_FILTERS.trait),
      arena: new Set(DEFAULT_FILTERS.arena),
      costRange: [...DEFAULT_FILTERS.costRange] as [number, number],
      powerRange: [...DEFAULT_FILTERS.powerRange] as [number, number],
      hpRange: [...DEFAULT_FILTERS.hpRange] as [number, number],
    };
    expect(isDefaultFilterState(clone)).toBe(true);
  });

  it("is false when search differs", () => {
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, search: "vader" })).toBe(false);
  });

  it("is false when the aspects facet differs (BL-90: empty is the default, not all-selected)", () => {
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, aspects: new Set(["Command"]) })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, aspects: new Set(ASPECT_LIST) })).toBe(false);
  });

  // BL-130 (issue #306): Exact is the owner-locked default.
  it("defaults aspectMode to Exact", () => {
    expect(DEFAULT_FILTERS.aspectMode).toBe("exact");
  });

  it("is false when aspectMode differs from the default, even with an empty aspects selection (BL-130)", () => {
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, aspectMode: "any" })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, aspectMode: "within" })).toBe(false);
  });

  it("is false when any other single facet Set differs", () => {
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, type: new Set(["Unit"]) })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, set: new Set(["SOR"]) })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, rarity: new Set(["Rare"]) })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, finish: new Set(["Foil"]) })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, keyword: new Set(["Ambush"]) })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, trait: new Set(["Rebel"]) })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, arena: new Set(["Ground"]) })).toBe(false);
  });

  it("is false when a range is narrowed on either bound", () => {
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, costRange: [1, COST_MAX] })).toBe(false);
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, powerRange: [0, POWER_MAX - 1] })).toBe(
      false
    );
    expect(isDefaultFilterState({ ...DEFAULT_FILTERS, hpRange: [2, HP_MAX - 2] })).toBe(false);
  });
});

// ── buildFinishTree / shapeFinishTree (BL-133, issue #318) ─────────────────
//
// DISPOSITION: the "distinctFinishes ordering (BL-129 R6, R6b)" describe
// block that lived here (3 tests, flat SelectOption[] + `pinned` boolean) is
// REPLACED -- BL-133 reshapes the same raw-value universe into a two-tier
// tree (buildFinishTree) with a separate faceting pass (shapeFinishTree).
// The pinned-vs-alphabetized-remainder CONCEPT survives (first test below is
// the direct descendant of R6b's ordering test, same 10-value dataset), but
// the shape and the explicit below-divider order are new, so a line-for-line
// port wasn't possible. Interaction-level coverage (parent click, chip
// toggle, aria attributes, stripped labels) lives in
// components/FinishFilter.test.tsx, not here -- this file stays pure-logic
// only per the RR-22 split.

describe("buildFinishTree (BL-133)", () => {
  it("orders the 5 pinned rows (pair/plain/group) in the locked sequence, consuming the same 10-value dataset R6b's test used", () => {
    const cards = [
      makeCard({
        variants: [
          makeVariant({ finish: "Showcase" }),
          makeVariant({ finish: "Serialized Prestige" }),
          makeVariant({ finish: "Standard" }),
          makeVariant({ finish: "Foil Prestige" }),
          makeVariant({ finish: "Hyperspace Foil" }),
          makeVariant({ finish: "Standard Prestige" }),
          makeVariant({ finish: "Hyperspace" }),
          makeVariant({ finish: "Standard Foil" }),
          // Weekly Play cards carry no `finish` (channel-based) -- raw
          // variant_type is the fallback buildFinishTree reads, same as the
          // old distinctFinishes.
          makeVariant({ finish: null, variant_type: "Weekly Play" }),
          makeVariant({ finish: null, variant_type: "Weekly Play Foil" }),
        ],
      }),
    ];

    const tree = buildFinishTree(cards);
    expect(tree.map((r) => r.key)).toEqual([
      "Standard",
      "Hyperspace",
      "Showcase",
      "Prestige",
      "Weekly Play",
    ]);
    expect(tree.every((r) => r.pinned)).toBe(true);

    expect(tree[0]).toMatchObject({
      kind: "pair",
      baseValue: "Standard",
      foilValue: "Standard Foil",
    });
    expect(tree[1]).toMatchObject({
      kind: "pair",
      baseValue: "Hyperspace",
      foilValue: "Hyperspace Foil",
    });
    expect(tree[2]).toMatchObject({ kind: "plain", value: "Showcase" });
    expect(tree[4]).toMatchObject({
      kind: "pair",
      baseValue: "Weekly Play",
      foilValue: "Weekly Play Foil",
    });

    // The Prestige group's 3 known children render in the locked
    // Standard/Foil/Serialized order (raw values), not data-arrival order
    // (the dataset above lists Serialized before Standard/Foil).
    const prestige = tree[3];
    if (prestige.kind !== "group") throw new Error("expected a group row");
    expect(prestige.children.map((c) => c.value)).toEqual([
      "Standard Prestige",
      "Foil Prestige",
      "Serialized Prestige",
    ]);
    expect(prestige.children.map((c) => c.displayLabel)).toEqual([
      "Standard",
      "Foil",
      "Serialized",
    ]);
  });

  it("groups tournament-prefixed values in ladder order and appends an unknown rung after the known ones (CREATE: PQ Top 32)", () => {
    const cards = [
      makeCard({
        variants: [
          makeVariant({ finish: null, variant_type: "PQ Top 4" }),
          makeVariant({ finish: null, variant_type: "PQ Champion" }),
          makeVariant({ finish: null, variant_type: "PQ Top 8" }),
          // Synthetic future value -- not on TOURNAMENT_LADDER at all.
          makeVariant({ finish: null, variant_type: "PQ Top 32" }),
        ],
      }),
    ];

    const tree = buildFinishTree(cards);
    const group = tree.find((r) => r.key === "Planetary Qualifier");
    expect(group?.kind).toBe("group");
    if (group?.kind !== "group") throw new Error("expected a group row");
    // Ladder order: Top 8 before Top 4 before Champion; the unrecognized
    // "Top 32" rung lands after every known one instead of being dropped or
    // sorted arbitrarily into the middle.
    expect(group.children.map((c) => c.displayLabel)).toEqual([
      "Top 8",
      "Top 4",
      "Champion",
      "Top 32",
    ]);
    expect(group.children.map((c) => c.value)).toEqual([
      "PQ Top 8",
      "PQ Top 4",
      "PQ Champion",
      "PQ Top 32",
    ]);
    // Below-divider position 8 (0-indexed) in FINISH_TOP_LEVEL_ORDER.
    expect(group.pinned).toBe(false);
  });

  it("groups Prestige-suffixed values by suffix rule and appends an unknown variant after the known three (CREATE: Azure Prestige)", () => {
    const cards = [
      makeCard({
        variants: [
          makeVariant({ finish: "Serialized Prestige" }),
          makeVariant({ finish: "Standard Prestige" }),
          // Synthetic future value -- not on PRESTIGE_LADDER.
          makeVariant({ finish: "Azure Prestige" }),
          makeVariant({ finish: "Foil Prestige" }),
        ],
      }),
    ];

    const group = buildFinishTree(cards).find((r) => r.key === "Prestige");
    expect(group?.kind).toBe("group");
    if (group?.kind !== "group") throw new Error("expected a group row");
    expect(group.children.map((c) => c.value)).toEqual([
      "Standard Prestige",
      "Foil Prestige",
      "Serialized Prestige",
      "Azure Prestige",
    ]);
    expect(group.pinned).toBe(true); // Prestige is the 4th pinned slot.
  });

  it("fuses a value with its Foil twin into a pair row only when both exist -- a future 'Showcase Foil' auto-fuses, a lone value degrades to plain (CREATE: absent-twin degradation)", () => {
    const fusedCards = [
      makeCard({
        variants: [makeVariant({ finish: "Showcase" }), makeVariant({ finish: "Showcase Foil" })],
      }),
    ];
    const fusedTree = buildFinishTree(fusedCards);
    expect(fusedTree.find((r) => r.key === "Showcase")).toMatchObject({
      kind: "pair",
      baseValue: "Showcase",
      foilValue: "Showcase Foil",
    });

    // Hyperspace with no "Hyperspace Foil" anywhere in the universe: no pair
    // forms, so it degrades to a plain row instead -- same mechanism
    // shapeFinishTree uses at facet time (chose one mechanism for both
    // cases, see BL-133 report).
    const loneCards = [makeCard({ variants: [makeVariant({ finish: "Hyperspace" })] })];
    const loneTree = buildFinishTree(loneCards);
    const loneRow = loneTree.find((r) => r.key === "Hyperspace");
    expect(loneRow).toMatchObject({ kind: "plain", value: "Hyperspace" });
    // Still pinned slot 2 -- FINISH_TOP_LEVEL_ORDER positions by key
    // regardless of whether that key resolved to a pair or a plain row.
    expect(loneRow?.pinned).toBe(true);
  });

  it("renders the below-divider section in the locked explicit order (not alphabetical), and appends an unrecognized top-level value alphabetized at the very end (CREATE)", () => {
    const cards = [
      makeCard({
        variants: [
          // Deliberately out of both alphabetical and eventual order.
          makeVariant({ finish: null, variant_type: "Movie Promo" }),
          makeVariant({ finish: null, variant_type: "Convention Exclusive" }),
          makeVariant({ finish: null, variant_type: "Judge Program" }),
          makeVariant({ finish: null, variant_type: "Event Exclusive" }),
          // Unrecognized: not paired/grouped, not in FINISH_TOP_LEVEL_ORDER.
          makeVariant({ finish: null, variant_type: "Zorii Promo" }),
        ],
      }),
    ];

    const tree = buildFinishTree(cards);
    expect(tree.map((r) => r.key)).toEqual([
      "Convention Exclusive",
      "Event Exclusive",
      "Judge Program",
      "Movie Promo",
      "Zorii Promo",
    ]);
    expect(tree.every((r) => r.pinned === false)).toBe(true);
  });
});

describe("shapeFinishTree (BL-133)", () => {
  function pairTree(): FinishTreeRow[] {
    return [
      {
        kind: "pair",
        key: "Standard",
        label: "Standard",
        baseValue: "Standard",
        foilValue: "Standard Foil",
        pinned: true,
      },
    ];
  }

  function groupTree(): FinishTreeRow[] {
    return [
      {
        kind: "group",
        key: "Planetary Qualifier",
        label: "Planetary Qualifier",
        children: [
          { value: "PQ Top 8", displayLabel: "Top 8" },
          { value: "PQ Top 4", displayLabel: "Top 4" },
        ],
        pinned: false,
      },
    ];
  }

  it("maps a checked raw value to the pair row's matching chip (CREATE: chip toggle -> correct raw value)", () => {
    const [row] = shapeFinishTree(pairTree(), null, new Set(["Standard Foil"]), false);
    if (row.kind !== "pair") throw new Error("expected pair");
    expect(row.base).toMatchObject({ value: "Standard", checked: false });
    expect(row.foil).toMatchObject({ value: "Standard Foil", checked: true });
  });

  it("degrades a pair row to a single chip when the other side is facet-invalid, unselected, and show-all is off", () => {
    const valid = new Set(["Standard"]); // "Standard Foil" not facet-valid
    const [row] = shapeFinishTree(pairTree(), valid, new Set(), false);
    if (row.kind !== "pair") throw new Error("expected pair");
    expect(row.base).not.toBeNull();
    expect(row.foil).toBeNull();
  });

  it("keeps a selected-but-invalid chip visible and inert instead of dropping it (BL-70 parity)", () => {
    const valid = new Set(["Standard"]);
    const [row] = shapeFinishTree(pairTree(), valid, new Set(["Standard Foil"]), false);
    if (row.kind !== "pair") throw new Error("expected pair");
    expect(row.foil).toMatchObject({ value: "Standard Foil", checked: true, inert: true });
  });

  it("propagates a child toggle to the raw value in the group's shaped children (CREATE: child toggle -> raw value in the Set)", () => {
    const [row] = shapeFinishTree(groupTree(), null, new Set(["PQ Top 8"]), false);
    if (row.kind !== "group") throw new Error("expected group");
    expect(row.children).toEqual([
      { value: "PQ Top 8", displayLabel: "Top 8", checked: true, inert: false },
      { value: "PQ Top 4", displayLabel: "Top 4", checked: false, inert: false },
    ]);
  });

  it("computes the collapsed-parent selected-count badge from all selected children, not just the shown ones (CREATE)", () => {
    const [row] = shapeFinishTree(groupTree(), null, new Set(["PQ Top 8", "PQ Top 4"]), false);
    if (row.kind !== "group") throw new Error("expected group");
    expect(row.selectedCount).toBe(2);
  });

  it("flags a group row all-inert only when every one of its children is facet-invalid (CREATE: all-children-inert styling)", () => {
    const bothInvalid = shapeFinishTree(groupTree(), new Set(), new Set(), true); // show-all reveals both
    const groupBothInvalid = bothInvalid[0];
    if (groupBothInvalid.kind !== "group") throw new Error("expected group");
    expect(groupBothInvalid.allInert).toBe(true);

    const oneValid = shapeFinishTree(groupTree(), new Set(["PQ Top 8"]), new Set(), true);
    const groupOneValid = oneValid[0];
    if (groupOneValid.kind !== "group") throw new Error("expected group");
    expect(groupOneValid.allInert).toBe(false);
  });

  it("omits a group row entirely once every child is hidden (invalid, unselected, show-all off)", () => {
    const shaped = shapeFinishTree(groupTree(), new Set(), new Set(), false);
    expect(shaped).toHaveLength(0);
  });
});
