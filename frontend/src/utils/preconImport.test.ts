import { describe, it, expect } from "vitest";
import {
  buildPreconImportFile,
  cardsForEntry,
  mergeDeckCards,
  verificationRowsFromReport,
} from "./preconImport";
import type { PreconDeck } from "../data/preconDecks";
import type { ImportReport } from "../api/inventoryImportExport";

// DISPOSITION LOG (BL-151 S2b, §4-REV owner dev-review 2026-07-24):
//  - mergeDeckCards tests -- PORT unchanged. The function itself is
//    unchanged (still the "whole box" union), only its one caller changed
//    (cardsForEntry's ibhBox branch instead of a 3-way boxed choice).
//  - the whole "cardsForSelection" describe block (single/A/B/both) --
//    RETIRE. PreconSelection and the boxed A/B/Both choice it exercised are
//    designed away; SOR/SHD/TWI decks are plain individual entries now.
//    REPLACED below by "cardsForEntry", covering the new PreconEntry shape:
//    a plain deck entry (was "single") and the IBH "ibhBox" entry (which
//    inherits the *old* boxed-both behavior, minus the choice -- IBH always
//    merges, never A-only or B-only).
//  - the whole "labelForSelection" describe block -- RETIRE. The function
//    was already dead code (no caller in AddCardsModal.tsx) before this
//    revision and is deleted outright, not replaced -- the owner's "dead
//    code left behind is a review reject" note applies doubly to code that
//    was already unreferenced.
//  - buildPreconImportFile test -- PORT unchanged (the function is
//    untouched by this revision).
//  - verificationRowsFromReport tests -- CREATE. New adapter, the mapping
//    that lets AddCardsVerification become the ONE shared Verify Cards
//    component for both flows (§4-REV's third policy point).

function deck(overrides: Partial<PreconDeck> = {}): PreconDeck {
  return {
    code: "SOR-LUKE",
    set_code: "SOR",
    product: "Two-Player Starter",
    name: "Luke Skywalker",
    aspects: "Vigilance / Heroism",
    cards: [
      {
        swuapi_uuid: "u1",
        set_code: "SOR",
        card_number: "1",
        variant_type: "Standard",
        name: "A",
        quantity: 1,
      },
      {
        swuapi_uuid: "u2",
        set_code: "SOR",
        card_number: "2",
        variant_type: "Standard",
        name: "B",
        quantity: 3,
      },
    ],
    ...overrides,
  };
}

describe("mergeDeckCards (PORT, unchanged -- BL-151 S2b §4-REV IBH whole-box union)", () => {
  it("unions two decks' rows, summing quantities for a shared uuid", () => {
    const a = deck({ code: "A" });
    const b = deck({
      code: "B",
      cards: [
        {
          swuapi_uuid: "u1",
          set_code: "SOR",
          card_number: "1",
          variant_type: "Standard",
          name: "A",
          quantity: 2,
        },
        {
          swuapi_uuid: "u3",
          set_code: "SOR",
          card_number: "3",
          variant_type: "Standard",
          name: "C",
          quantity: 1,
        },
      ],
    });
    const merged = mergeDeckCards([a, b]);
    const byUuid = Object.fromEntries(merged.map((c) => [c.swuapi_uuid, c.quantity]));
    expect(byUuid.u1).toBe(3); // 1 (deck A) + 2 (deck B)
    expect(byUuid.u2).toBe(3); // deck A only
    expect(byUuid.u3).toBe(1); // deck B only
    expect(merged).toHaveLength(3);
  });

  it("never double-imports: no duplicate swuapi_uuid rows in the merged output", () => {
    const a = deck({ code: "A" });
    const b = deck({ code: "B" }); // identical uuids to A
    const merged = mergeDeckCards([a, b]);
    const uuids = merged.map((c) => c.swuapi_uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
  });
});

describe("cardsForEntry (REPLACE -- cardsForSelection's boxed A/B/Both choice is gone)", () => {
  const deckA = deck({ code: "SOR-LUKE" });
  const deckB = deck({
    code: "SOR-VADER",
    name: "Darth Vader",
    cards: [
      {
        swuapi_uuid: "u4",
        set_code: "SOR",
        card_number: "4",
        variant_type: "Standard",
        name: "D",
        quantity: 1,
      },
    ],
  });

  it("returns a plain deck entry's own rows", () => {
    expect(cardsForEntry({ kind: "deck", key: deckA.code, setCode: "SOR", deck: deckA })).toEqual(
      deckA.cards
    );
  });

  it("returns the merged union of both decks for an ibhBox entry -- always both, no per-deck choice", () => {
    const cards = cardsForEntry({ kind: "ibhBox", key: "IBH", setCode: "IBH", deckA, deckB });
    expect(cards).toHaveLength(3); // deckA's 2 + deckB's 1, no overlap here
  });
});

describe("buildPreconImportFile (PORT, unchanged)", () => {
  it("builds a swu-inv/1 File whose cards mirror the input rows", async () => {
    const cards = deck().cards;
    const file = buildPreconImportFile(cards);
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("application/json");

    const text = await file.text();
    const parsed = JSON.parse(text);
    expect(parsed.format_version).toBe("swu-inv/1");
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.cards[0]).toEqual({
      swuapi_uuid: "u1",
      set_code: "SOR",
      card_number: "1",
      variant_type: "Standard",
      quantity: 1,
      name: "A",
    });
  });
});

function baseReport(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    stage: "dry_run",
    mode: "merge_add",
    cap_handling: "add_above",
    committed: false,
    totals: {
      rows: 0,
      resolved: 0,
      matched_by_fallback: 0,
      unresolved: 0,
      ambiguous: 0,
      trimmed: 0,
      ceiling_clamped: 0,
      duplicate_rows_merged: 0,
      unrecognized_columns: [],
      removed_by_replace_all: 0,
    },
    rows: [],
    removed: [],
    ...overrides,
  };
}

describe("verificationRowsFromReport (CREATE -- BL-151 S2b §4-REV, one shared Verify Cards component)", () => {
  it("puts an untrimmed resolved row in willAdd with a green dot and 'current → resulting' text", () => {
    const report = baseReport({
      rows: [
        {
          row_number: 1,
          status: "resolved",
          card: { set_code: "SOR", card_number: "1", variant_type: "Standard", name: "Card One" },
          file_quantity: 1,
          current_quantity: 0,
          resulting_quantity: 1,
        },
      ],
    });
    const { willAdd, willSkip, unresolved } = verificationRowsFromReport(report);
    expect(willAdd).toHaveLength(1);
    expect(willSkip).toHaveLength(0);
    expect(unresolved).toHaveLength(0);
    expect(willAdd[0]).toMatchObject({
      groupKey: "SOR",
      cardNumber: "1",
      name: "Card One",
      inventoryText: "0 → 1",
      dotColor: "green",
      setText: "Base Set",
      isOP: false,
    });
    expect(willAdd[0].overLimitNote).toBeFalsy();
  });

  it("puts a fully-blocked trimmed row (0 added) in willSkip with a red dot and a reason", () => {
    const report = baseReport({
      rows: [
        {
          row_number: 1,
          status: "resolved",
          card: { set_code: "SOR", card_number: "1", variant_type: "Standard", name: "At Limit" },
          file_quantity: 3,
          current_quantity: 3,
          resulting_quantity: 3,
          copies_not_added: 3,
          trim_reason: "keep_limit",
        },
      ],
    });
    const { willAdd, willSkip } = verificationRowsFromReport(report);
    expect(willAdd).toHaveLength(0);
    expect(willSkip).toHaveLength(1);
    expect(willSkip[0].dotColor).toBe("red");
    expect(willSkip[0].skipReason).toContain("3 copies not added");
    expect(willSkip[0].skipReason).toContain("keep-limit");
  });

  it("puts a partially-trimmed row (some added) in willSkip with an amber dot and the still-added count in its reason", () => {
    const report = baseReport({
      rows: [
        {
          row_number: 1,
          status: "resolved",
          card: { set_code: "SOR", card_number: "1", variant_type: "Standard", name: "Partial" },
          file_quantity: 3,
          current_quantity: 0,
          resulting_quantity: 2,
          copies_not_added: 1,
          trim_reason: "keep_limit",
        },
      ],
    });
    const { willAdd, willSkip } = verificationRowsFromReport(report);
    expect(willAdd).toHaveLength(0);
    expect(willSkip).toHaveLength(1);
    expect(willSkip[0].dotColor).toBe("amber");
    expect(willSkip[0].skipReason).toContain("1 copy not added");
    expect(willSkip[0].skipReason).toContain("2 still added");
  });

  it("labels a ceiling-clamped trim distinctly from a keep-limit trim", () => {
    const report = baseReport({
      rows: [
        {
          row_number: 1,
          status: "resolved",
          card: { set_code: "SOR", card_number: "1", variant_type: "Standard", name: "Ceiling" },
          file_quantity: 1000,
          current_quantity: 0,
          resulting_quantity: 999,
          copies_not_added: 1,
          trim_reason: "ceiling",
        },
      ],
    });
    const { willSkip } = verificationRowsFromReport(report);
    expect(willSkip[0].skipReason).toContain("999 ceiling");
  });

  it("puts an unresolved row in its own unresolved bucket, never willAdd/willSkip", () => {
    const report = baseReport({
      rows: [
        {
          row_number: 1,
          status: "unresolved",
          reason: "unknown_triple",
          card: { set_code: "SOR", card_number: "999", variant_type: "Standard" },
          file_quantity: 1,
        },
      ],
    });
    const { willAdd, willSkip, unresolved } = verificationRowsFromReport(report);
    expect(willAdd).toHaveLength(0);
    expect(willSkip).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].skipReason).toMatch(/no matching card/i);
    expect(unresolved[0].dotColor).toBe("red");
  });
});
