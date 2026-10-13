import { readdirSync, readFileSync } from "node:fs";
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

  // REPLACE (owner decision 2026-10-13 after review, Q4). Was: "a token is a
  // card like any other" -- addable as variant 6267. Tokens are not added by
  // scanning (the keypad cannot enter one either): the read is still named as
  // that token, never as the card that holds its number, and it is its own
  // outcome of the one decision function -- not a check in the screen.
  it("a token is named as that token and is never addable -- in either mode, whatever is picked", () => {
    for (const defaults of [true, false]) {
      const r = readIdentity([6267], cards, NO_PICKS, defaults);
      expect(r).toMatchObject({
        kind: "token",
        card: { name: "Experience", is_token: true },
        hint: { text: "Tokens can't be added from the camera.", attn: false },
      });
      expect(r.kind === "token" && r.printings.map((v) => v.variant_id)).toEqual([6267]);
      expect(readAddable(r)).toBeNull();
      expect(readAddable(r, true)).toBeNull();
    }
    const picked = readIdentity([6267], cards, picks({ finish: "Standard" }), true);
    expect(picked.kind).toBe("token");
    expect(readAddable(picked)).toBeNull();
  });

  // Review S1 (orchestrator call under the owner's rule "nothing is added
  // until the user chooses"). Queen Amidala SEC 1127 is three printings under
  // one number and one variant type: 4170 Carbonite, 4171 Rose Gold, 4172
  // Gold -- the catalogue tells them apart by the image file name only
  // (App Spec 10.5). Was: the first of the three, with no question.
  it("Serialized Prestige (SEC 1127, three printings): one chip per printing, nothing defaulted in either mode", () => {
    for (const defaults of [true, false]) {
      const r = readIdentity([4170, 4171, 4172], cards, NO_PICKS, defaults);
      expect(r.kind).toBe("card");
      if (r.kind !== "card") continue;
      expect(r.card.name).toBe("Queen Amidala");
      expect(r.variant).toBeNull();
      expect(readAddable(r)).toBeNull();
      expect(r.choices).toEqual([
        {
          axis: "finish",
          label: "Finish",
          options: [
            { value: "Carbonite", l1: "Carbonite", l2: null },
            { value: "Gold", l1: "Gold", l2: null },
            { value: "Rose Gold", l1: "Rose Gold", l2: null },
          ],
          value: null,
          needsPick: true,
          defaulted: false,
        },
      ]);
      expect(r.hint).toEqual({
        text: "Carbonite, Gold and Rose Gold share this number. Pick the one you have.",
        attn: false,
      });
    }
    const by = (finish: string, defaults: boolean) =>
      readAddable(readIdentity([4172, 4170, 4171], cards, picks({ finish }), defaults))?.variant
        .variant_id;
    for (const defaults of [true, false]) {
      expect(by("Carbonite", defaults)).toBe(4170);
      expect(by("Rose Gold", defaults)).toBe(4171);
      expect(by("Gold", defaults)).toBe(4172);
      // A finish that is none of the three settles nothing.
      expect(by("Serialized Prestige", defaults)).toBeUndefined();
      expect(by("Standard", defaults)).toBeUndefined();
    }
  });

  it("printings nothing tells apart (no image name to read): nothing is addable and nothing is offered", () => {
    const blind = cards.map((c) => ({
      ...c,
      variants: c.variants.map((v) => ({ ...v, front_image_url: null })),
    }));
    for (const defaults of [true, false]) {
      const r = readIdentity([4170, 4171, 4172], blind, picks({ finish: "Gold" }), defaults);
      expect(r).toMatchObject({
        kind: "card",
        card: { name: "Queen Amidala" },
        variant: null,
        choices: [],
        hint: {
          text: "This number has printings the app cannot tell apart. It is not added by scanning.",
          attn: false,
        },
      });
      expect(readAddable(r)).toBeNull();
      expect(readAddable(r, true)).toBeNull();
    }
  });

  // Review N1: some of the strip's printings are not in the loaded catalogue.
  // Was: the read silently narrowed to the ones found (a foil pair with one
  // printing absent became "one printing" and Fast add added it).
  it("a partial miss (a printing the strip names is not loaded): never added without an Add tap, and the panel says so", () => {
    const pair = readIdentity([6571, -5], cards, NO_PICKS, false);
    expect(pair).toMatchObject({
      kind: "card",
      card: { name: "Cell Block Guard" },
      partial: true,
      variant: { variant_id: 6571 },
      hint: {
        text: "Part of this read is not in the catalogue this app loaded. Check the card before adding.",
        attn: true,
      },
    });
    expect(readAddable(pair, true)).toBeNull(); // no automatic add (Fast add)
    expect(readAddable(pair)?.variant.variant_id).toBe(6571); // an Add tap may
    // The same with a choice left among the ones found: a chip is not an Add tap.
    const three = readIdentity([6571, 6572, -5], cards, picks({ finish: "Standard Foil" }), false);
    expect(three).toMatchObject({ kind: "card", partial: true, variant: { variant_id: 6572 } });
    expect(readAddable(three, true)).toBeNull();
    // A whole read is not partial.
    expect(readIdentity([6571, 6572], cards, NO_PICKS, false)).toMatchObject({ partial: false });
    expect(readIdentity([970100], cards, NO_PICKS, false)).toMatchObject({ partial: false });
    expect(readAddable(readIdentity([970100], cards, NO_PICKS, false), true)).not.toBeNull();
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
    const sets: number[][] = [
      [6571, 6572],
      [6317, 6318],
      [6269, 6273],
      [970172, 922119],
      [6681],
      [4170, 4171, 4172], // review S1: the Serialized Prestige three
      [6267], // a token: never addable
    ];
    const values = [
      null,
      "Standard",
      "Standard Foil",
      "Hyperspace",
      "Judge",
      "Promo",
      "Base Set",
      "Gold",
      "Rose Gold",
    ];
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
              if (vids[0] === 6267) expect(a).toBeNull();
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
  // REPLACE (review N2). Was: a regex over four named files. Now every source
  // file in the camera directory, and the import itself is what is forbidden.
  // What this cannot catch: a helper OUTSIDE this directory (in tool/ or
  // utils/) that wraps one of these functions under another name and is then
  // imported here; a dynamic import; and a re-implementation of the keypad's
  // default written inline. It is a tripwire for the stage 1 calls coming
  // back -- the behaviour tests (fastAddCollision.test.ts, by variant id over
  // every strip) are the protection.
  const WHICH_CARD =
    /\b(padView|padReadout|padAddable|resolveRow|rowFor|entryRow|inventoryStatus|fastAddTarget)\b/;
  /** Why a source text breaks the rule, or null. Comments do not count. */
  function offence(src: string): string | null {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // No mention at all (an import, a call, a re-export).
    const named = WHICH_CARD.exec(code);
    if (named) return "names " + named[1];
    if (/import\s+\*\s+as\s+\w+\s+from\s+"[^"]*(addCardsResolver|padModel)"/.test(code))
      return "imports a whole resolver module";
    // From the resolver module itself only `decompose` (a printing's Set /
    // Stamp / Finish words) and types may be imported.
    for (const m of code.matchAll(
      /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"[^"]*addCardsResolver"/g
    )) {
      if (m[1]) continue; // a type-only import decides nothing
      const extra = m[2]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("type ") && s !== "decompose");
      if (extra.length) return "imports " + extra.join(", ") + " from the resolver";
    }
    return null;
  }

  it("no file under camera/ imports or names the keypad resolver's which-card functions", () => {
    const dir = "src/mobile/camera/";
    const files = readdirSync(dir).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts")
    );
    // The directory was really read (the four files the old guard named are in it).
    for (const f of ["cameraFlow.ts", "cameraController.ts", "CameraScreen.tsx", "readIdentity.ts"])
      expect(files).toContain(f);
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) expect(offence(readFileSync(dir + f, "utf8")), f).toBeNull();
  });

  it("the guard fails on the calls it is there for, and not on a comment or on decompose", () => {
    expect(offence('import { padView } from "../tool/padModel";')).toBe("names padView");
    expect(offence("const a = padAddable(view);")).toBe("names padAddable");
    expect(offence('import { resolveRow } from "../../utils/addCardsResolver";')).toBe(
      "names resolveRow"
    );
    expect(offence('import { decompose, groupBy } from "../../utils/addCardsResolver";')).toBe(
      "imports groupBy from the resolver"
    );
    expect(offence('import * as R from "../../utils/addCardsResolver";')).toBe(
      "imports a whole resolver module"
    );
    expect(offence("// the keypad's padView is not used here\nconst a = 1;")).toBeNull();
    expect(
      offence(
        'import { decompose } from "../../utils/addCardsResolver";\n' +
          'import type { Decomposition, Row } from "../../utils/addCardsResolver";'
      )
    ).toBeNull();
  });

  it("the three users of the rule call readIdentity", () => {
    const read = (f: string) => readFileSync("src/mobile/camera/" + f, "utf8");
    expect(read("cameraController.ts")).toMatch(/readIdentity\(/); // Fast add + Add
    expect(read("CameraScreen.tsx").match(/readIdentity\(/g)?.length).toBeGreaterThanOrEqual(2); // found panel + pick rows
  });
});
