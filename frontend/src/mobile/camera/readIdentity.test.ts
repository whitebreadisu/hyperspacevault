import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BaseCardCatalog } from "../../api/baseCards";
import { scanCards } from "../../../e2e/mobile/scan-fixture";
import { toInventoryCards } from "../../utils/inventory";
import type { BatchRow } from "../tool/batch";
import { padReadout, padView, toCatalog } from "../tool/padModel";
import { NO_PICKS } from "../tool/toolStore";
import type { PadPicks } from "../tool/toolStore";
import { printingReadout, readAddable, readIdentity } from "./readIdentity";

// BL-262 stage 2: the ONE function that decides what a read identifies --
// nothing | one card (one printing, or several with the choice among exactly
// those) | several cards -- from the printings the strip named. Fast add, the
// found panel, Add and the pick list's rows all go through it.

const cards = toInventoryCards(
  (scanCards() as BaseCardCatalog[]).map((c) => ({
    ...c,
    variants: c.variants.map((v) => ({ ...v, quantity: v.variant_id === 6571 ? 2 : 0 })),
  }))
);
const catalog = toCatalog(cards);
const picks = (p: Partial<PadPicks>): PadPicks => ({ ...NO_PICKS, ...p });

describe("BL-262 readIdentity: what a read identifies", () => {
  it("one printing: that card and printing, nothing asked -- with or without defaults", () => {
    for (const defaults of [true, false]) {
      const r = readIdentity([970100], cards, NO_PICKS, defaults);
      expect(r).toMatchObject({
        kind: "card",
        card: { name: "Scan Filler 100" },
        variant: { variant_id: 970100 },
        choices: [],
        hint: null,
      });
      expect(readAddable(r)?.variant.variant_id).toBe(970100);
    }
  });

  it("one printing on a number the keypad shares: no card question, no other card", () => {
    // Waylay's Weekly Play printing is SOR 3; the keypad's SOR 3 is another card.
    const keypad = padView("SOR", "3", NO_PICKS, catalog, cards);
    expect(keypad.kind === "card" && keypad.choices.map((c) => c.axis)).toContain("cardKey");
    const r = readIdentity([6681], cards, NO_PICKS, true);
    expect(r).toMatchObject({ kind: "card", card: { name: "Waylay" }, choices: [] });
    expect(readAddable(r)?.variant.variant_id).toBe(6681);
  });

  it("a token is a card like any other", () => {
    const r = readIdentity([6267], cards, NO_PICKS, false);
    expect(r).toMatchObject({ kind: "card", card: { name: "Experience", is_token: true } });
    expect(readAddable(r)?.variant.variant_id).toBe(6267);
  });

  it("one card, foil + non-foil, no defaults (Fast add): Finish must be picked; the pick settles it", () => {
    const r = readIdentity([6571, 6572], cards, NO_PICKS, false);
    expect(r.kind).toBe("card");
    if (r.kind !== "card") return;
    expect(r.printings.map((v) => v.variant_id)).toEqual([6571, 6572]);
    expect(r.variant).toBeNull();
    expect(r.choices).toEqual([
      {
        axis: "finish",
        label: "Finish",
        options: [
          { value: "Standard", l1: "Standard", l2: null },
          { value: "Standard Foil", l1: "Standard Foil", l2: null },
        ],
        value: null,
        needsPick: true,
        defaulted: false,
      },
    ]);
    expect(r.hint).toEqual({
      text: "Foil and non-foil share this number. Pick the one you have.",
      attn: false,
    });
    expect(readAddable(r)).toBeNull();
    const foil = readIdentity([6571, 6572], cards, picks({ finish: "Standard Foil" }), false);
    expect(readAddable(foil)?.variant.variant_id).toBe(6572);
    const std = readIdentity([6571, 6572], cards, picks({ finish: "Standard" }), false);
    expect(readAddable(std)?.variant.variant_id).toBe(6571);
  });

  it("one card, foil + non-foil, with defaults (prompt mode): the keypad's non-foil default and its cue", () => {
    const r = readIdentity([6571, 6572], cards, NO_PICKS, true);
    expect(r).toMatchObject({
      kind: "card",
      variant: { variant_id: 6571 },
      hint: { text: "Card number is shared across variants. Verify selection.", attn: true },
    });
    if (r.kind !== "card") return;
    expect(r.choices[0]).toMatchObject({ axis: "finish", value: "Standard", defaulted: true });
    // ... exactly what the keypad shows for the same number.
    const keypad = padView("SOR", "229", NO_PICKS, catalog, cards);
    expect(keypad.kind === "card" && keypad.choices).toEqual(r.choices);
    expect(keypad.kind === "card" && keypad.hint).toEqual(r.hint);
  });

  it("the non-foil is the first Finish chip whatever order the read lists its printings", () => {
    const r = readIdentity([6572, 6571], cards, NO_PICKS, false);
    expect(r.kind === "card" && r.choices[0].options.map((o) => o.value)).toEqual([
      "Standard",
      "Standard Foil",
    ]);
    expect(r.kind === "card" && r.printings.map((v) => v.variant_id)).toEqual([6572, 6571]);
  });

  it("a pick outside the read's printings is ignored (a stale keypad pick cannot choose)", () => {
    const r = readIdentity([6571, 6572], cards, picks({ finish: "Hyperspace" }), false);
    expect(readAddable(r)).toBeNull();
    const one = readIdentity([970100], cards, picks({ finish: "Hyperspace", cardKey: "X" }), false);
    expect(readAddable(one)?.variant.variant_id).toBe(970100);
  });

  it("one card, two stamps (Prerelease Promo / Judge): Stamp must be picked in both modes", () => {
    for (const defaults of [true, false]) {
      const r = readIdentity([6269, 6273], cards, NO_PICKS, defaults);
      expect(r.kind).toBe("card");
      if (r.kind !== "card") continue;
      expect(r.card.name).toBe("Darth Vader");
      expect(r.variant).toBeNull();
      expect(r.choices.map((c) => [c.axis, c.options.map((o) => o.value), c.needsPick])).toEqual([
        ["stamp", ["Promo", "Judge"], true],
      ]);
      expect(r.hint?.text).toBe("This code is on more than one printing. Pick the one you have.");
    }
    const j = readIdentity([6269, 6273], cards, picks({ stamp: "Judge" }), false);
    expect(readAddable(j)?.variant.variant_id).toBe(6273);
  });

  it("one card, two events: Set is asked; prompt mode defaults to Base Set, Fast add does not", () => {
    // Scan Filler 172: Standard (Base Set) + a Galactic Championship printing.
    const prompt = readIdentity([970172, 922119], cards, NO_PICKS, true);
    expect(prompt).toMatchObject({ kind: "card", variant: { variant_id: 970172 } });
    const fast = readIdentity([970172, 922119], cards, NO_PICKS, false);
    expect(fast.kind === "card" && fast.variant).toBeNull();
    expect(fast.kind === "card" && fast.choices.map((c) => [c.axis, c.needsPick])).toEqual([
      ["setKey", true],
    ]);
    const gc = readIdentity(
      [970172, 922119],
      cards,
      picks({ setKey: "Galactic Championship" }),
      false
    );
    expect(readAddable(gc)?.variant.variant_id).toBe(922119);
  });

  it("printings of more than one card: several cards -- nothing is addable", () => {
    const r = readIdentity([922105, 909292], cards, NO_PICKS, true);
    expect(r.kind).toBe("cards");
    expect(r.kind === "cards" && r.cards.map((c) => c.name).sort()).toEqual([
      "Emperor's Messenger",
      "Grogu",
    ]);
    expect(readAddable(r)).toBeNull();
  });

  it("printings the catalogue does not hold: nothing", () => {
    expect(readIdentity([], cards, NO_PICKS, true)).toEqual({ kind: "none" });
    expect(readIdentity([1, 2], cards, NO_PICKS, true)).toEqual({ kind: "none" });
    expect(readAddable({ kind: "none" })).toBeNull();
  });

  it("the choice never leaves the read's printings, whatever is picked", () => {
    const sets: number[][] = [[6571, 6572], [6317, 6318], [6269, 6273], [970172, 922119], [6681]];
    const values = [null, "Standard", "Standard Foil", "Hyperspace", "Judge", "Promo", "Base Set"];
    for (const vids of sets)
      for (const defaults of [true, false])
        for (const setKey of values)
          for (const stamp of values)
            for (const finish of values) {
              const r = readIdentity(
                vids,
                cards,
                { cardKey: null, setKey, stamp, finish },
                defaults
              );
              const a = readAddable(r);
              if (a) expect(vids).toContain(a.variant.variant_id);
            }
  });
});

describe("BL-262 printingReadout: the keep-limit readout for the printing itself", () => {
  const row = (variantId: number): BatchRow => ({
    id: "b-" + variantId,
    via: "camera",
    force: false,
    setCode: "SOR",
    cardNumber: "229",
    picks: NO_PICKS,
    variantId,
    baseCardId: 131,
  });

  it("equals the keypad's readout wherever the keypad resolves to the same printing", () => {
    const batch = [row(6571), row(6571), row(6572)];
    for (const capMode of ["hard", "soft"] as const) {
      expect(printingReadout(6571, batch, catalog, null, capMode)).toEqual(
        padReadout("SOR", "229", NO_PICKS, batch, catalog, null, capMode)
      );
      expect(printingReadout(6572, batch, catalog, null, capMode)).toEqual(
        padReadout("SOR", "229", picks({ finish: "Standard Foil" }), batch, catalog, null, capMode)
      );
      expect(printingReadout(970100, [], catalog, null, capMode)).toEqual(
        padReadout("SOR", "100", NO_PICKS, [], catalog, null, capMode)
      );
    }
    expect(printingReadout(6571, batch, catalog, null, "hard")).toMatchObject({
      owned: 2,
      after: 5,
    });
  });

  it("reads a printing the keypad cannot reach (a token), and nothing for an unknown id", () => {
    expect(printingReadout(6267, [], catalog, null, "hard")).toMatchObject({ owned: 0, after: 1 });
    expect(printingReadout(-1, [], catalog, null, "hard")).toBeNull();
  });
});

describe("BL-262 one rule: the camera never asks the keypad resolver which card", () => {
  it("no camera source resolves set + number (padView / padReadout / resolveRow / padAddable)", () => {
    for (const f of [
      "cameraFlow.ts",
      "cameraController.ts",
      "CameraScreen.tsx",
      "readIdentity.ts",
    ]) {
      const src = readFileSync("src/mobile/camera/" + f, "utf8");
      expect(src, f).not.toMatch(/\b(padView|padReadout|resolveRow|padAddable|fastAddTarget)\b/);
    }
  });

  it("the three users of the rule call readIdentity", () => {
    const read = (f: string) => readFileSync("src/mobile/camera/" + f, "utf8");
    expect(read("cameraController.ts")).toMatch(/readIdentity\(/); // Fast add + Add
    expect(read("CameraScreen.tsx").match(/readIdentity\(/g)?.length).toBeGreaterThanOrEqual(2); // found panel + pick rows
  });
});
