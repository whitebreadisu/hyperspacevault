import { describe, it, expect } from "vitest";
import { preconData, preconDecks, preconEntries } from "./preconDecks";
import type { PreconDeck } from "./preconDecks";

/** BL-151 S2 (§5 case 7 / §6): "a frontend vitest for structural invariants
 * (deck count, required fields, positive quantities) that runs in CI without
 * a DB." Deliberately SHAPE-ONLY -- no deck-count or specific-content
 * assertions (that's the backend verify_precon_decks.py script's job, per
 * §3/§6, run against the real catalog DB at prep time). This file must stay
 * green whether it's reading S2's 2-deck placeholder or S1's real 22-deck
 * file -- that's the whole point of the placeholder swap being a pure data
 * change. */

function makeDeck(overrides: Partial<PreconDeck> = {}): PreconDeck {
  return {
    code: "TEST-DECK",
    set_code: "SOR",
    product: "Two-Player Starter",
    name: "Test Deck",
    aspects: "Vigilance",
    cards: [
      {
        swuapi_uuid: "u1",
        set_code: "SOR",
        card_number: "1",
        variant_type: "Standard",
        name: "A",
        quantity: 1,
      },
    ],
    ...overrides,
  };
}

describe("preconDecks.json structural invariants (BL-151 S2)", () => {
  it("has top-level generated/source metadata and a decks array", () => {
    expect(typeof preconData.generated).toBe("string");
    // DISPOSITION (REPLACE, S1 integration): the definition doc's schema
    // sketch showed `source` as one string, but S1's real data records an
    // ARRAY of research-doc paths (multiple source docs fed the set) --
    // the richer shape is the truthful one, so the assertion follows it.
    const sources = Array.isArray(preconData.source) ? preconData.source : [preconData.source];
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(typeof s).toBe("string");
    expect(Array.isArray(preconDecks)).toBe(true);
    expect(preconDecks.length).toBeGreaterThan(0);
  });

  it("gives every deck a non-empty code/set_code/product/name/aspects and a non-empty card list", () => {
    for (const deck of preconDecks) {
      expect(deck.code).toBeTruthy();
      expect(deck.set_code).toBeTruthy();
      expect(deck.product).toBeTruthy();
      expect(deck.name).toBeTruthy();
      // DISPOSITION (REPLACE, S1b integration): dual-leader Twin Suns decks
      // carry aspects: null (their four-aspect pools are noise; the official
      // deck title is the identity) -- string OR null, never undefined.
      expect(deck.aspects === null || typeof deck.aspects === "string").toBe(true);
      expect(Array.isArray(deck.cards)).toBe(true);
      expect(deck.cards.length).toBeGreaterThan(0);
    }
  });

  it("gives every card row a swuapi_uuid, set_code, card_number, variant_type, name, and a positive integer quantity", () => {
    for (const deck of preconDecks) {
      for (const card of deck.cards) {
        expect(card.swuapi_uuid).toBeTruthy();
        expect(card.set_code).toBeTruthy();
        expect(card.card_number).toBeTruthy();
        expect(card.variant_type).toBeTruthy();
        expect(card.name).toBeTruthy();
        expect(Number.isInteger(card.quantity)).toBe(true);
        expect(card.quantity).toBeGreaterThan(0);
      }
    }
  });

  it("has deck codes unique across the whole file", () => {
    const codes = preconDecks.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has swuapi_uuids unique within a single deck", () => {
    for (const deck of preconDecks) {
      const uuids = deck.cards.map((c) => c.swuapi_uuid);
      expect(new Set(uuids).size).toBe(uuids.length);
    }
  });
});

// DISPOSITION LOG (BL-151 S2b, §4-REV owner dev-review 2026-07-24):
// boxedProducts() (the S2 boxed-three-choice model) is designed away --
// SOR/SHD/TWI starter decks revert to individually selectable entries, no
// "whole box" option survives for them. The tests below are each given an
// explicit disposition rather than silently dropped:
//   - "groups an exact pair ... into one boxed product" (SOR) -- RETIRE. The
//     behavior it asserted (SOR pairs box up) no longer exists.
//   - "does not box a non-boxed set code ... (Spotlight-style)" (JTL) --
//     RETIRE as originally written (it tested a boxed/non-boxed distinction
//     that no longer exists), but its *intent* -- "two decks under one set
//     code don't collapse into one entry" -- is now true for EVERY set
//     except IBH, so it's carried forward as "every non-IBH set with two
//     decks stays two entries" below (REPLACE).
//   - "falls back to single entries for a boxed set code missing its
//     matching half" (SOR) -- RETIRE (SOR was never a special case in the
//     new model to begin with; the fallback behavior it exercised was
//     already true for the not-yet-boxed default in the old code, so
//     there's nothing left to distinguish).
//   - "treats a lone TS26 deck as a single entry" -- PORT unchanged as
//     "single deck sets stay individual entries" below (still exactly true).
//   - "boxedProducts() with no argument reads the real data" -- PORT,
//     renamed to preconEntries().
// New coverage (CREATE): IBH's always-both-decks grouping (the one
// remaining -- and now inverted -- special case) and its own missing-half
// fallback.
describe("preconEntries (BL-151 S2b, §4-REV)", () => {
  it("gives SOR's two starter decks two separate entries, not one boxed entry (REPLACE: boxed choice reverted)", () => {
    const decks = [
      makeDeck({ code: "SOR-A", set_code: "SOR", name: "Deck A" }),
      makeDeck({ code: "SOR-B", set_code: "SOR", name: "Deck B" }),
    ];
    const entries = preconEntries(decks);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "deck")).toBe(true);
  });

  it("gives every non-IBH set with two decks two separate entries (REPLACE, generalizes the old Spotlight-only case)", () => {
    const decks = [
      makeDeck({ code: "JTL-A", set_code: "JTL", name: "Spotlight A" }),
      makeDeck({ code: "JTL-B", set_code: "JTL", name: "Spotlight B" }),
    ];
    const entries = preconEntries(decks);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "deck")).toBe(true);
  });

  it("treats a lone TS26 deck as a single entry (PORT, unchanged)", () => {
    const decks = [makeDeck({ code: "TS26-1", set_code: "TS26", name: "Twin Suns Deck" })];
    const entries = preconEntries(decks);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("deck");
  });

  it("groups IBH's two decks into exactly one ibhBox entry (CREATE, §4-REV IBH always-both)", () => {
    const decks = [
      makeDeck({ code: "IBH-LEIA", set_code: "IBH", name: "Leia Organa" }),
      makeDeck({ code: "IBH-VADER", set_code: "IBH", name: "Darth Vader" }),
    ];
    const entries = preconEntries(decks);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("ibhBox");
    expect(entries[0].key).toBe("IBH");
  });

  it("falls back to a plain deck entry for an unpaired IBH deck (CREATE)", () => {
    const decks = [makeDeck({ code: "IBH-LEIA", set_code: "IBH", name: "Leia Organa" })];
    const entries = preconEntries(decks);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("deck");
  });

  it("preconEntries() with no argument reads the real data without throwing, and gives IBH exactly one entry (PORT)", () => {
    expect(() => preconEntries()).not.toThrow();
    const entries = preconEntries();
    expect(entries.length).toBeGreaterThan(0);
    const ibhEntries = entries.filter((e) => e.setCode === "IBH");
    expect(ibhEntries).toHaveLength(1);
    expect(ibhEntries[0].kind).toBe("ibhBox");
  });
});
