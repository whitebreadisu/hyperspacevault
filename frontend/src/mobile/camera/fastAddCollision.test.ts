import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCardCatalog } from "../../api/baseCards";
import type { CardSet } from "../../api/sets";
import setsJson from "../../../e2e/mobile/fixtures/sets.json";
import { scanCards } from "../../../e2e/mobile/scan-fixture";
import { toInventoryCards } from "../../utils/inventory";
import { batchView, getBatch } from "../tool/batch";
import { padAddable, padView, toCatalog } from "../tool/padModel";
import { getScanSettings, setScanSettings } from "../tool/scanSettings";
import { NO_PICKS, getToolState, resetToolForTest } from "../tool/toolStore";
import { CameraController } from "./cameraController";
import { HOLD_MS } from "./cameraFlow";
import type { PickRow } from "./cameraFlow";
import { readAddable, readIdentity } from "./readIdentity";
import { buildScanCatalog } from "./scanCatalog";
import { Catalog } from "./scanCore";
import type { ScanCatalogData } from "./scanCore";
import type { Accepted } from "./scanLoop";

// BL-262 (owner, 2026-10-12): with Fast add on, a scanned card whose number is
// shared was added as the base-set card with no question. The read itself is
// right (the scan loop names one card); the add re-resolved {set, number}
// through the keypad resolver, which defaults a shared number to the base-set
// card.
//
// Stage 2 (owner, 2026-10-13: "Trust what the strip says"; early-set foil /
// non-foil: "Ask foil or non-foil each time"): the printings the strip
// identifies travel with the read, and the add and the panel use THEM -- the
// keypad resolver no longer decides which card. These tests run the REAL
// controller (flow + readIdentity + batch) on the scanner e2e catalogue
// (e2e/mobile/scan-fixture.ts), one case per collision class; only the camera
// stream and the OCR are absent (the reads are handed to the flow as the loop
// would hand them).
//
// Dispositions against stage 1's expectations (reason for every REPLACE: the
// owner's 2026-10-13 decisions above):
//   SOR 74, SOR 2, SOR 172, SOR T1  "panel asks"       -> REPLACE: added at
//       once, as the printing the strip identified (asserted by variant id)
//   SOR 12/20 Resupply "choose the card, then Add"     -> REPLACE: the panel
//       is Resupply's; its strip is a foil / non-foil pair, so Finish is asked
//   SOR 1/2 pick -> "the panel's own question"         -> REPLACE: the panel is
//       the picked row's card; only that row's printings are offered
//   SOR 229 "added at once as the non-foil default"    -> REPLACE: asks Finish
//   prompt mode "the keypad's default"                 -> REPLACE: the read card
//   every "never adds the wrong card" expectation      -> kept, and tightened
//       to the variant id
//   the fastAddTarget unit tests                       -> REPLACE by
//       readIdentity.test.ts (the function is gone; one rule, readIdentity)

const sets = setsJson as CardSet[];
const cards = toInventoryCards(
  (scanCards() as BaseCardCatalog[]).map((c) => ({
    ...c,
    variants: c.variants.map((v) => ({ ...v, quantity: 0 })),
  }))
);
const scanData: ScanCatalogData = buildScanCatalog(cards, sets);
const C = new Catalog(scanData);
const padCatalog = toCatalog(cards);

const scan = {
  startReader: async () => ({ ok: true }),
  reader: {},
  fallback: {},
} as unknown as ConstructorParameters<typeof CameraController>[0];

function boot(fastAdd: boolean, signedIn = true) {
  setScanSettings({ fastAdd });
  const ctl = new CameraController(scan);
  ctl.setInputs({
    cards,
    sets,
    isAuthenticated: signedIn,
    onRequestSignIn: () => {},
    offsets: { h: 0, v: 0 },
    size: { w: 0, h: 0 },
  });
  const phases: string[] = [];
  ctl.flow.subscribe(() => phases.push(ctl.flow.phase.kind));
  return { ctl, phases };
}

/** Hand the flow an exact read, as the loop does on acceptance. */
function exact(ctl: CameraController, text: string): Accepted {
  const ev = C.evaluate(text);
  expect(ev.result, text).toBe("exact");
  const a: Accepted = {
    key: ev.best!.key,
    ev,
    card: ev.best!.cards[0],
    reader: "paddle",
    keyStrength: "weak",
    tAcceptMs: 800,
    decision: { state: "accept", accept: true, key: ev.best!.key },
  };
  ctl.flow.accepted(a);
  return a;
}

/** Hand the flow an ambiguous read; returns the pick rows. */
function ambiguous(ctl: CameraController, text: string): PickRow[] {
  const ev = C.evaluate(text);
  expect(ev.result, text).toBe("ambiguous");
  ctl.flow.ambiguous(ev, ev.reason);
  return ctl.flow.phase.kind === "pick" ? ctl.flow.phase.rows : [];
}

/** The printings the strip identified (the read's variant ids). */
const vidsOf = (a: Accepted) => a.card.printings.map((p) => p.vid);

/** The batch as [variant id, via]. */
const added = (): [number | null, string][] => getBatch().map((r) => [r.variantId, r.via]);

/** The batch as [card name, printing]. */
function names(): [string, string][] {
  return getBatch().map((r) => {
    const c = cards.find((x) => x.variants.some((v) => v.variant_id === r.variantId));
    const v = c?.variants.find((x) => x.variant_id === r.variantId);
    return [c?.name ?? "?", v?.variant_type ?? "?"];
  });
}

/** What the found panel shows for the phase the flow is in (the same call
 * CameraScreen's FoundPanel makes). */
function panel(ctl: CameraController) {
  const p = ctl.flow.phase;
  if (p.kind !== "found") throw new Error("not found: " + p.kind);
  return readIdentity(p.target.vids, cards, getToolState().picks, !getScanSettings().fastAdd);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetToolForTest();
});
afterEach(() => {
  vi.useRealTimers();
  resetToolForTest();
});

describe("BL-262 Fast add adds the card the strip identified -- one printing: at once, by variant id", () => {
  const atOnce = (text: string, name: string, vid: number) => {
    const { ctl, phases } = boot(true);
    const a = exact(ctl, text);
    expect(a.card.name).toBe(name);
    expect(vidsOf(a)).toEqual([vid]);
    // The ADDED variant id is the variant id the strip identified.
    expect(added()).toEqual([[vid, "camera_fast_add"]]);
    expect(phases).toEqual(["hold"]); // no found or pick phase on the way
    expect(ctl.flow.phase).toMatchObject({ kind: "hold", fast: true });
    return ctl;
  };

  it("BL-262 one card, one printing, nothing shared (SOR 100/252)", () => {
    atOnce("SOR • EN 100/252", "Scan Filler 100", 970100);
  });

  // The owner's case. SOR 74 is a base-set card AND the P25 74 Darth Vader
  // Showcase (home set SOR): the keypad asks "Which card?"; the strip does not.
  it("BL-262 a number another card also holds, read = the base-set card (SOR 74/252): the base card, no question", () => {
    atOnce("SOR • EN C 74/252", "Scan Filler 74", 970074);
  });

  it("BL-262 a Weekly Play printing on a base-set number (SOR 3/20 Waylay): the Weekly Play card, never the base-set card", () => {
    // What the keypad makes of SOR 3 is another card -- and stays so.
    expect(padAddable(padView("SOR", "3", NO_PICKS, padCatalog, cards))?.card.name).not.toBe(
      "Waylay"
    );
    atOnce("SOR • EN 3/20", "Waylay", 6681);
    expect(names()).toEqual([["Waylay", "Weekly Play"]]);
  });

  it("BL-262 a read where the keypad's default is another card (SOR 2, no denominator = Darth Vader's Hyperspace): the read card", () => {
    const keypad = padAddable(padView("SOR", "2", NO_PICKS, padCatalog, cards));
    expect(keypad?.card.name).toBe("Scan Filler 2"); // the keypad's base-set default, unchanged
    atOnce("SOR • EN 2", "Darth Vader", 7251);
    expect(names()).toEqual([["Darth Vader", "Hyperspace"]]);
  });

  it("BL-262 the same number with its denominator (SOR 2/252) is the base-set card", () => {
    atOnce("SOR • EN 2/252", "Scan Filler 2", 970002);
  });

  it("BL-262 a token (SOR T1 Experience): the token, never the card that holds its number", () => {
    atOnce("SOR • EN T1", "Experience", 6267);
  });

  it("BL-262 one card with another event's printing under the same number (SOR 172/252): the printing the strip names, no question", () => {
    atOnce("SOR • EN 172/252", "Scan Filler 172", 970172);
    expect(names()).toEqual([["Scan Filler 172", "Standard"]]);
  });

  it("BL-262 a Weekly Play printing under its own number (SOR 4/20 -> SORP 4)", () => {
    atOnce("SOR • EN 4/20", "Vader's Lightsaber", 7252);
  });

  it("BL-262 a card left in view is not added twice by the flow; the hold ends after 1 s", () => {
    const ctl = atOnce("SOR • EN 100/252", "Scan Filler 100", 970100);
    vi.advanceTimersByTime(HOLD_MS);
    expect(ctl.flow.phase.kind).toBe("searching");
    expect(added()).toHaveLength(1);
  });

  it("BL-262 signed out: unchanged -- no add, the prompt", () => {
    const { ctl } = boot(true, false);
    exact(ctl, "SOR • EN 100/252");
    expect(added()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
  });
});

describe("BL-262 Fast add asks only when the strip itself could be more than one printing", () => {
  // Owner 2026-10-13: "Ask foil or non-foil each time." SOR / SHD / TWI print
  // one strip on the foil and the non-foil printing.
  it("BL-262 early-set foil / non-foil (SOR 229/252): nothing is added until Finish is chosen, then the chosen finish", () => {
    const { ctl, phases } = boot(true);
    const a = exact(ctl, "SOR • EN R 229/252");
    expect(vidsOf(a)).toEqual([6571, 6572]);
    expect(added()).toEqual([]);
    expect(ctl.flow.phase).toMatchObject({ kind: "found", key: "SOR 229/252" });
    const p = panel(ctl);
    expect(p.kind).toBe("card");
    if (p.kind !== "card") return;
    expect(p.card.name).toBe("Cell Block Guard");
    expect(p.variant).toBeNull(); // no default finish under Fast add
    expect(p.choices.map((c) => [c.axis, c.options.map((o) => o.value), c.value])).toEqual([
      ["finish", ["Standard", "Standard Foil"], null],
    ]);
    expect(p.choices[0].needsPick).toBe(true);
    expect(readAddable(p)).toBeNull();
    // Nothing happens on its own; Add with no finish chosen adds nothing.
    vi.advanceTimersByTime(HOLD_MS * 5);
    ctl.add();
    expect(added()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
    // The choice is the last thing asked: it adds and holds.
    ctl.choose("finish", "Standard Foil");
    expect(added()).toEqual([[6572, "camera_fast_add"]]);
    expect(ctl.flow.phase).toMatchObject({ kind: "hold", fast: true });
    expect(phases).toEqual(["found", "hold"]);
  });

  it("BL-262 early-set foil / non-foil: choosing the non-foil adds the non-foil", () => {
    const { ctl } = boot(true);
    exact(ctl, "SOR • EN R 229/252");
    ctl.choose("finish", "Standard");
    expect(added()).toEqual([[6571, "camera_fast_add"]]);
  });

  it("BL-262 an early-set Weekly Play pair (SOR 12/20 Resupply): the panel is Resupply's, Finish is asked, the base-set card is never offered", () => {
    const { ctl } = boot(true);
    const a = exact(ctl, "SOR • EN 12/20");
    expect(a.card.name).toBe("Resupply");
    expect(added()).toEqual([]);
    const p = panel(ctl);
    expect(p.kind === "card" && p.card.name).toBe("Resupply");
    expect(p.kind === "card" && p.printings.map((v) => v.variant_id)).toEqual([6317, 6318]);
    expect(p.kind === "card" && p.choices.map((c) => c.axis)).toEqual(["finish"]);
    ctl.choose("finish", "Standard Foil");
    expect(added()).toEqual([[6318, "camera_fast_add"]]);
    expect(names()).toEqual([["Resupply", "Weekly Play Foil"]]);
  });

  it("BL-262 N/2 tournament stamps (SOR 1/2): the pick list, then the picked row's own printings -- never another card on that number", () => {
    const { ctl, phases } = boot(true);
    const rows = ambiguous(ctl, "SOR • EN 1/2");
    expect(ctl.flow.phase.kind).toBe("pick");
    vi.advanceTimersByTime(HOLD_MS * 5);
    expect(ctl.flow.phase.kind).toBe("pick"); // never resolved on its own
    expect(added()).toEqual([]);
    const vader = rows.find((r) => r.target.name === "Darth Vader" && r.target.setCode === "SOR")!;
    expect(vader.vids).toEqual([6269, 6273]); // Prerelease Promo + Prerelease Judge
    ctl.pick(vader);
    // Before BL-262 this added the base-set card at SOR 1, not Darth Vader.
    expect(added()).toEqual([]);
    expect(ctl.flow.phase).toMatchObject({ kind: "found", fromPick: true });
    const p = panel(ctl);
    expect(p.kind === "card" && p.card.name).toBe("Darth Vader");
    expect(
      p.kind === "card" && p.choices.map((c) => [c.axis, c.options.map((o) => o.value)])
    ).toEqual([["stamp", ["Promo", "Judge"]]]);
    ctl.choose("stamp", "Judge");
    expect(added()).toEqual([[6273, "camera_fast_add"]]);
    expect(phases).toEqual(["pick", "found", "hold"]);
  });

  it("BL-262 a printed-code collision (ASHP 16): the pick list, then exactly one copy of the CHOSEN card and the hold", () => {
    const { ctl, phases } = boot(true);
    const rows = ambiguous(ctl, "ASHP • EN 16");
    expect(added()).toEqual([]);
    vi.advanceTimersByTime(HOLD_MS * 5);
    expect(ctl.flow.phase.kind).toBe("pick"); // never resolved on its own
    const grogu = rows.find((r) => r.target.name === "Grogu")!;
    ctl.pick(grogu);
    expect(grogu.vids).toEqual([922105]);
    expect(added()).toEqual([[922105, "camera_fast_add"]]);
    expect(phases).toEqual(["pick", "hold"]);
  });
});

describe("BL-262 prompt mode: the panel opens on the card that was read; nothing is added without a tap", () => {
  const shown = (text: string) => {
    const { ctl } = boot(false);
    const a = exact(ctl, text);
    expect(ctl.flow.phase.kind).toBe("found");
    vi.advanceTimersByTime(HOLD_MS * 5);
    expect(added()).toEqual([]); // never without a tap
    expect(getToolState().picks).toEqual(NO_PICKS);
    const p = panel(ctl);
    if (p.kind !== "card") throw new Error(text + ": " + p.kind);
    expect(p.card.name).toBe(a.card.name);
    return { ctl, a, p };
  };

  it("BL-262 a Weekly Play read (SOR 3/20) opens on Waylay, not the base-set card; Add adds exactly it", () => {
    const { ctl, p } = shown("SOR • EN 3/20");
    expect(p.variant?.variant_id).toBe(6681);
    expect(p.choices).toEqual([]);
    ctl.add();
    expect(added()).toEqual([[6681, "camera"]]);
    expect(ctl.flow.phase).toMatchObject({ kind: "hold", fast: false });
  });

  it("BL-262 a Resupply read (SOR 12/20) opens on Resupply; only its two finishes are offered", () => {
    const { ctl, p } = shown("SOR • EN 12/20");
    expect(p.card.name).toBe("Resupply");
    // Prompt mode keeps the non-foil default with the choice left up.
    expect(p.variant?.variant_id).toBe(6317);
    expect(p.choices.map((c) => [c.axis, c.value, c.defaulted])).toEqual([
      ["finish", "Standard", true],
    ]);
    ctl.add();
    expect(added()).toEqual([[6317, "camera"]]);
  });

  it("BL-262 a shared number (SOR 74/252) opens on the card read with no card question; Add adds it", () => {
    const { ctl, p } = shown("SOR • EN C 74/252");
    expect(p.variant?.variant_id).toBe(970074);
    expect(p.choices).toEqual([]);
    ctl.add();
    expect(added()).toEqual([[970074, "camera"]]);
  });

  it("BL-262 a read the keypad defaults to another card (SOR 2 = Darth Vader's Hyperspace) opens on the read card", () => {
    const { ctl, p } = shown("SOR • EN 2");
    expect(p.card.name).toBe("Darth Vader");
    expect(p.variant?.variant_id).toBe(7251);
    expect(p.choices).toEqual([]);
    ctl.add();
    expect(added()).toEqual([[7251, "camera"]]);
  });

  it("BL-262 a token read (SOR T1) opens on the token; Add adds the token", () => {
    const { ctl, p } = shown("SOR • EN T1");
    expect(p.card.is_token).toBe(true);
    expect(p.variant?.variant_id).toBe(6267);
    ctl.add();
    expect(added()).toEqual([[6267, "camera"]]);
  });

  it("BL-262 early-set foil / non-foil (SOR 229/252): as before -- the non-foil default with Finish left up; Add adds what is shown", () => {
    const { ctl, p } = shown("SOR • EN R 229/252");
    expect(p.variant?.variant_id).toBe(6571);
    expect(p.choices.map((c) => [c.axis, c.value, c.defaulted, c.needsPick])).toEqual([
      ["finish", "Standard", true, false],
    ]);
    expect(p.hint).toEqual({
      text: "Card number is shared across variants. Verify selection.",
      attn: true,
    });
    // A choice in prompt mode adds nothing: Add is still a tap.
    ctl.choose("finish", "Standard Foil");
    expect(added()).toEqual([]);
    expect(panel(ctl)).toMatchObject({ variant: { variant_id: 6572 } });
    ctl.add();
    expect(added()).toEqual([[6572, "camera"]]);
  });

  it("BL-262 a pick row (SOR 1/2 Darth Vader) opens on that card with only its printings; no default stamp", () => {
    const { ctl } = boot(false);
    const rows = ambiguous(ctl, "SOR • EN 1/2");
    ctl.pick(rows.find((r) => r.target.name === "Darth Vader" && r.target.setCode === "SOR")!);
    const p = panel(ctl);
    expect(p.kind === "card" && p.card.name).toBe("Darth Vader");
    expect(p.kind === "card" && p.variant).toBeNull();
    ctl.add();
    expect(added()).toEqual([]); // nothing to add until the stamp is chosen
    ctl.choose("stamp", "Promo");
    ctl.add();
    expect(added()).toEqual([[6269, "camera"]]);
  });
});

// Every strip the e2e catalogue's printings carry, as the card prints it.
function strips(): string[] {
  const out = new Set<string>();
  const codeOf = (src: string) =>
    Object.keys(scanData.printed).filter((k) => scanData.printed[k].includes(src));
  for (const [src, num, , , , cls] of scanData.p)
    for (const code of codeOf(src)) {
      const main = scanData.main[code];
      if (cls === "t") out.add(`${code} • EN T${num}`);
      else if (cls === "m" && main) out.add(`${code} • EN ${num}/${main}`);
      else if (cls === "w") out.add(`${code} • EN ${num}/20`);
      else if (cls === "2") out.add(`${code} • EN ${num}/2`);
      else out.add(`${code} • EN ${num}`);
    }
  return [...out];
}

describe("BL-262 no read is ever added as a printing its strip did not identify (every strip of the catalogue)", () => {
  const all = strips();

  it("the sweep covers the catalogue", () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it("Fast add: one printing -> exactly that variant id at once; more than one -> nothing until a choice", () => {
    let atOnce = 0;
    let asked = 0;
    for (const text of all) {
      const ev = C.evaluate(text);
      if (ev.result !== "exact") continue;
      resetToolForTest();
      const { ctl } = boot(true);
      const a = exact(ctl, text);
      const vids = vidsOf(a);
      const p = readIdentity(vids, cards, NO_PICKS, false);
      if (p.kind === "card" && p.variant) {
        expect(added(), text).toEqual([[p.variant.variant_id, "camera_fast_add"]]);
        expect(vids, text).toContain(p.variant.variant_id);
        atOnce++;
      } else {
        expect(added(), text).toEqual([]);
        expect(ctl.flow.phase.kind, text).toBe("found");
        expect(vids.length, text).toBeGreaterThan(1);
        asked++;
      }
      ctl.flow.dispose();
    }
    expect(atOnce).toBeGreaterThan(200);
    expect(asked).toBeGreaterThan(5);
  });

  it("prompt mode: the panel's card and the printing Add adds are always the read's", () => {
    for (const text of all) {
      const ev = C.evaluate(text);
      if (ev.result !== "exact") continue;
      resetToolForTest();
      const { ctl } = boot(false);
      const a = exact(ctl, text);
      expect(added(), text).toEqual([]);
      const p = panel(ctl);
      expect(p.kind, text).toBe("card");
      if (p.kind !== "card") continue;
      expect(p.card.name, text).toBe(a.card.name);
      expect(p.printings.map((v) => v.variant_id).sort(), text).toEqual(vidsOf(a).sort());
      ctl.add();
      const got = added();
      if (p.variant) expect(got, text).toEqual([[p.variant.variant_id, "camera"]]);
      else expect(got, text).toEqual([]);
      for (const [vid] of got) expect(vidsOf(a), text).toContain(vid);
      ctl.flow.dispose();
    }
  });

  it("every pick row, once picked, offers and adds only that row's printings (both modes)", () => {
    let rowsSeen = 0;
    for (const fast of [true, false])
      for (const text of all) {
        const ev = C.evaluate(text);
        if (ev.result !== "ambiguous") continue;
        const n = ev.best!.cards.length;
        for (let i = 0; i < n; i++) {
          resetToolForTest();
          const { ctl } = boot(fast);
          const rows = ambiguous(ctl, text);
          const row = rows[i % rows.length];
          ctl.pick(row);
          rowsSeen++;
          if (!fast) ctl.add();
          for (const [vid] of added()) expect(row.vids, text).toContain(vid);
          if (row.vids.length === 1 && fast)
            expect(added(), text).toEqual([[row.vids[0], "camera_fast_add"]]);
          ctl.flow.dispose();
        }
      }
    expect(rowsSeen).toBeGreaterThan(4);
  });
});

describe("BL-262 the Verify sheet names the printing that will be added", () => {
  const ctx = { catalog: padCatalog, limits: null, capMode: "hard" as const };

  it("a camera row is listed as its own printing even where the keypad resolves its set + number to another card", () => {
    const { ctl } = boot(true);
    exact(ctl, "SOR • EN 3/20"); // Waylay, Weekly Play
    vi.advanceTimersByTime(HOLD_MS);
    exact(ctl, "SOR • EN T1"); // the Experience token
    const view = batchView(getBatch(), ctx);
    expect(view.unresolved).toEqual([]);
    expect(view.added.map((r) => [r.name, r.setText, r.finishText])).toEqual([
      ["Waylay", "Weekly Play", "Standard"],
      ["Experience", "Base Set", "Standard"],
    ]);
  });

  it("a camera row the keypad resolves to the same printing reads as a keypad row does", () => {
    const { ctl } = boot(false);
    exact(ctl, "SOR • EN R 229/252");
    ctl.choose("finish", "Standard Foil");
    ctl.add();
    const view = batchView(getBatch(), ctx);
    expect(
      view.added.map((r) => [r.name, r.setText, r.finishText, r.groupKey, r.cardNumber])
    ).toEqual([["Cell Block Guard", "Base Set", "Standard Foil", "SOR", "229"]]);
  });
});
