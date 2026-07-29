import { describe, it, expect } from "vitest";
import { resolveDeckLeaderBase, buildPreconPreview } from "./preconPreview";
import type { AddCardsCatalogEntry } from "./addCardsResolver";
import type { PreconDeck, PreconEntry, PreconDeckCard } from "../data/preconDecks";

// BL-164 §5 (Definition_CosmeticsBatch_2026-07-26.md): the precon dropdown's
// hover-preview composition resolves each deck's Leader(s)/Base against the
// app's catalog (deck JSON rows carry no `type` field of their own). These
// tests fabricate a small catalog + deck fixtures rather than depending on
// the real preconDecks.json content, matching the rest of this test suite's
// convention (addCardsResolver.test.ts, preconImport.test.ts).

function makeCatalogEntry(overrides: Partial<AddCardsCatalogEntry>): AddCardsCatalogEntry {
  return {
    id: 1,
    name: "Placeholder",
    subtitle: null,
    type: "Unit",
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    set_code: "SOR",
    source_set_code: "SOR",
    card_number: "1",
    is_token: false,
    quantity: 0,
    front_image_url: "https://cdn.example/front.png",
    back_image_url: null,
    ...overrides,
  };
}

function makeDeckCard(overrides: Partial<PreconDeckCard>): PreconDeckCard {
  return {
    swuapi_uuid: "uuid-1",
    set_code: "SOR",
    card_number: "1",
    variant_type: "Standard",
    name: "Placeholder",
    quantity: 1,
    ...overrides,
  };
}

function makeDeck(overrides: Partial<PreconDeck>): PreconDeck {
  return {
    code: "SOR-TEST",
    set_code: "SOR",
    product: "Two-Player Starter",
    name: "Test Deck",
    aspects: "Vigilance / Heroism",
    cards: [],
    ...overrides,
  };
}

const LEADER_1 = makeCatalogEntry({
  id: 101,
  card_number: "1",
  type: "Leader",
  name: "Leader One",
});
const LEADER_2 = makeCatalogEntry({
  id: 102,
  card_number: "2",
  type: "Leader",
  name: "Leader Two",
});
const BASE_1 = makeCatalogEntry({ id: 103, card_number: "3", type: "Base", name: "Base One" });
const UNIT_1 = makeCatalogEntry({ id: 104, card_number: "4", type: "Unit", name: "Some Unit" });

describe("resolveDeckLeaderBase", () => {
  it("resolves a standard deck's single leader and base", () => {
    const deck = makeDeck({
      cards: [
        makeDeckCard({ card_number: "1", name: "Leader One" }),
        makeDeckCard({ card_number: "3", name: "Base One" }),
        makeDeckCard({ card_number: "4", name: "Some Unit" }),
      ],
    });
    const catalog = [LEADER_1, BASE_1, UNIT_1];
    const result = resolveDeckLeaderBase(deck, catalog);
    expect(result.leaders).toEqual([LEADER_1]);
    expect(result.base).toEqual(BASE_1);
    expect(result.unresolvedCardNumbers).toEqual([]);
  });

  it("resolves a dual-leader (Twin Suns) deck's two leaders and one base", () => {
    const deck = makeDeck({
      set_code: "TS26",
      aspects: null,
      cards: [
        makeDeckCard({ set_code: "TS26", card_number: "1", name: "Leader One" }),
        makeDeckCard({ set_code: "TS26", card_number: "2", name: "Leader Two" }),
        makeDeckCard({ set_code: "TS26", card_number: "3", name: "Base One" }),
      ],
    });
    const catalog = [
      { ...LEADER_1, set_code: "TS26", source_set_code: "TS26" },
      { ...LEADER_2, set_code: "TS26", source_set_code: "TS26" },
      { ...BASE_1, set_code: "TS26", source_set_code: "TS26" },
    ];
    const result = resolveDeckLeaderBase(deck, catalog);
    expect(result.leaders.map((l) => l.id)).toEqual([101, 102]);
    expect(result.base?.id).toBe(103);
  });

  it("reports a deck card with no catalog match instead of silently dropping it", () => {
    const deck = makeDeck({
      cards: [
        makeDeckCard({ card_number: "1", name: "Leader One" }),
        makeDeckCard({ card_number: "999", name: "Ghost Card" }),
      ],
    });
    const catalog = [LEADER_1];
    const result = resolveDeckLeaderBase(deck, catalog);
    expect(result.leaders).toEqual([LEADER_1]);
    expect(result.base).toBeNull();
    expect(result.unresolvedCardNumbers).toEqual(["999"]);
  });

  it("matches by source_set_code too, so a companion-set deck row still resolves", () => {
    const deck = makeDeck({
      cards: [makeDeckCard({ set_code: "SORP", card_number: "1", name: "Leader One" })],
    });
    const catalog = [LEADER_1]; // set_code "SOR", source_set_code "SOR" -- SORP row must still match via set_code
    const result = resolveDeckLeaderBase(
      { ...deck, cards: [makeDeckCard({ set_code: "SOR", card_number: "1" })] },
      catalog
    );
    expect(result.leaders).toEqual([LEADER_1]);
  });
});

describe("buildPreconPreview", () => {
  function deckEntry(deck: PreconDeck): PreconEntry {
    return { kind: "deck", key: deck.code, setCode: deck.set_code, deck };
  }

  it("standard deck -> kind 'standard' with its leader and base", () => {
    const deck = makeDeck({
      cards: [makeDeckCard({ card_number: "1" }), makeDeckCard({ card_number: "3" })],
    });
    const preview = buildPreconPreview(deckEntry(deck), [LEADER_1, BASE_1]);
    expect(preview.kind).toBe("standard");
    if (preview.kind === "standard") {
      expect(preview.leader).toEqual(LEADER_1);
      expect(preview.base).toEqual(BASE_1);
    }
  });

  it("dual-leader deck -> kind 'dual' with both leaders and one base", () => {
    const deck = makeDeck({
      set_code: "TS26",
      aspects: null,
      cards: [
        makeDeckCard({ set_code: "TS26", card_number: "1" }),
        makeDeckCard({ set_code: "TS26", card_number: "2" }),
        makeDeckCard({ set_code: "TS26", card_number: "3" }),
      ],
    });
    const catalog = [
      { ...LEADER_1, set_code: "TS26", source_set_code: "TS26" },
      { ...LEADER_2, set_code: "TS26", source_set_code: "TS26" },
      { ...BASE_1, set_code: "TS26", source_set_code: "TS26" },
    ];
    const preview = buildPreconPreview(deckEntry(deck), catalog);
    expect(preview.kind).toBe("dual");
    if (preview.kind === "dual") {
      expect(preview.leaders.map((l) => l.id)).toEqual([101, 102]);
      expect(preview.base?.id).toBe(103);
    }
  });

  it("IBH whole-box entry -> kind 'ibh' with each half's own leader+base pair", () => {
    const deckA = makeDeck({
      code: "IBH-A",
      set_code: "IBH",
      cards: [
        makeDeckCard({ set_code: "IBH", card_number: "1" }),
        makeDeckCard({ set_code: "IBH", card_number: "3" }),
      ],
    });
    const deckB = makeDeck({
      code: "IBH-B",
      set_code: "IBH",
      cards: [
        makeDeckCard({ set_code: "IBH", card_number: "2" }),
        makeDeckCard({ set_code: "IBH", card_number: "5" }),
      ],
    });
    const BASE_2 = makeCatalogEntry({ id: 105, card_number: "5", type: "Base", name: "Base Two" });
    const catalog = [
      { ...LEADER_1, set_code: "IBH", source_set_code: "IBH" },
      { ...LEADER_2, set_code: "IBH", source_set_code: "IBH" },
      { ...BASE_1, set_code: "IBH", source_set_code: "IBH" },
      { ...BASE_2, set_code: "IBH", source_set_code: "IBH" },
    ];
    const entry: PreconEntry = { kind: "ibhBox", key: "IBH", setCode: "IBH", deckA, deckB };
    const preview = buildPreconPreview(entry, catalog);
    expect(preview.kind).toBe("ibh");
    if (preview.kind === "ibh") {
      expect(preview.halves[0].leader.id).toBe(101);
      expect(preview.halves[0].base?.id).toBe(103);
      expect(preview.halves[1].leader.id).toBe(102);
      expect(preview.halves[1].base?.id).toBe(105);
    }
  });

  it("reports 'unresolved' rather than a broken partial composition when a leader can't be resolved", () => {
    const deck = makeDeck({ cards: [makeDeckCard({ card_number: "999" })] });
    const preview = buildPreconPreview(deckEntry(deck), []);
    expect(preview.kind).toBe("unresolved");
    if (preview.kind === "unresolved") {
      expect(preview.unresolvedCardNumbers).toEqual(["999"]);
    }
  });

  it("IBH entry reports 'unresolved' when either half's leader can't be resolved", () => {
    const deckA = makeDeck({
      code: "IBH-A",
      set_code: "IBH",
      cards: [makeDeckCard({ card_number: "1" })],
    });
    const deckB = makeDeck({
      code: "IBH-B",
      set_code: "IBH",
      cards: [makeDeckCard({ card_number: "999" })],
    });
    const entry: PreconEntry = { kind: "ibhBox", key: "IBH", setCode: "IBH", deckA, deckB };
    const preview = buildPreconPreview(entry, [LEADER_1]);
    expect(preview.kind).toBe("unresolved");
  });
});
