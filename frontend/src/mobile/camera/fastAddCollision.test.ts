import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCardCatalog } from "../../api/baseCards";
import type { CardSet } from "../../api/sets";
import setsJson from "../../../e2e/mobile/fixtures/sets.json";
import { scanCards } from "../../../e2e/mobile/scan-fixture";
import { toInventoryCards } from "../../utils/inventory";
import { getBatch } from "../tool/batch";
import { padAddable, padView, toCatalog } from "../tool/padModel";
import { setScanSettings } from "../tool/scanSettings";
import { NO_PICKS, getToolState, resetToolForTest, setPadPick } from "../tool/toolStore";
import { CameraController } from "./cameraController";
import { HOLD_MS, fastAddTarget, targetOf } from "./cameraFlow";
import type { PickRow } from "./cameraFlow";
import { buildScanCatalog } from "./scanCatalog";
import { Catalog } from "./scanCore";
import type { Accepted } from "./scanLoop";

// BL-262 (owner, 2026-10-12): with Fast add on, a scanned card whose number is
// shared was added as the base-set card with no question. The read itself is
// right (the scan loop names one card); the add re-resolved {set, number}
// through the keypad resolver, which defaults a shared number to the base-set
// card. These tests run the REAL controller (flow + keypad resolver + batch)
// on the scanner e2e catalogue (e2e/mobile/scan-fixture.ts), one case per
// collision class; only the camera stream and the OCR are absent (the reads
// are handed to the flow as the loop would hand them).

const sets = setsJson as CardSet[];
const cards = toInventoryCards(
  (scanCards() as BaseCardCatalog[]).map((c) => ({
    ...c,
    variants: c.variants.map((v) => ({ ...v, quantity: 0 })),
  }))
);
const C = new Catalog(buildScanCatalog(cards, sets));
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

/** The batch as [card name, printing, via]. */
function batch(): [string, string, string][] {
  return getBatch().map((r) => {
    const c = cards.find((x) => x.variants.some((v) => v.variant_id === r.variantId));
    const v = c?.variants.find((x) => x.variant_id === r.variantId);
    return [c?.name ?? "?", v?.variant_type ?? "?", r.via];
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetToolForTest();
});
afterEach(() => {
  vi.useRealTimers();
  resetToolForTest();
});

describe("BL-262 Fast add never adds a card the user still has to choose", () => {
  // The owner's case: SOR 74 is a base-set card AND the P25 74 Darth Vader
  // Showcase (home set SOR), so the keypad panel asks "Which card?".
  it("BL-262 reproduction: a number shared by two cards (SOR 74) -- no add before the choice, then the chosen card", () => {
    const { ctl, phases } = boot(true);
    exact(ctl, "SOR • EN C 74/252");
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase).toMatchObject({ kind: "found", key: "SOR 74/252" });
    expect(phases).toEqual(["found"]);
    // Nothing happens on its own.
    vi.advanceTimersByTime(HOLD_MS * 5);
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
    // The user picks the other card, then Add: that card, one copy, the hold.
    setPadPick("cardKey", "Darth Vader — Dark Lord of the Sith");
    ctl.add();
    expect(batch()).toEqual([["Darth Vader", "Showcase", "camera"]]);
    expect(ctl.flow.phase).toMatchObject({ kind: "hold", fast: true });
  });

  it("BL-262 a Weekly Play printing on a base-set number (SOR 12/20 Resupply): the base-set card is not added", () => {
    const { ctl } = boot(true);
    const a = exact(ctl, "SOR • EN 12/20");
    expect(a.card.name).toBe("Resupply");
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
    setPadPick("cardKey", "Resupply");
    ctl.add();
    expect(batch()).toEqual([["Resupply", "Weekly Play", "camera"]]);
  });

  it("BL-262 the keypad's default is another card than the one read (SOR 2/252): not added", () => {
    const { ctl } = boot(true);
    const a = exact(ctl, "SOR • EN 2/252");
    expect(a.card.name).toBe("Scan Filler 2");
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
  });

  it("BL-262 one card, two events under one set + number (SOR 172: Base Set / Galactic Championship): not added before the choice", () => {
    const { ctl } = boot(true);
    exact(ctl, "SOR • EN 172/252");
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
    setPadPick("setKey", "Galactic Championship");
    ctl.add();
    expect(batch()).toEqual([["Scan Filler 172", "GC Event Pack", "camera"]]);
  });

  it("BL-262 a token read (SOR T1) is never added as the card that holds its number", () => {
    const { ctl } = boot(true);
    const a = exact(ctl, "SOR • EN T1");
    expect(a.card.name).toBe("Experience");
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
  });

  it("BL-262 N/2 tournament stamps (SOR 1/2): the pick list first; a row on a shared number is not added before the second choice", () => {
    const { ctl } = boot(true);
    const rows = ambiguous(ctl, "SOR • EN 1/2");
    expect(ctl.flow.phase.kind).toBe("pick");
    expect(batch()).toEqual([]);
    const vader = rows.find((r) => r.target.name === "Darth Vader" && r.target.setCode === "SOR")!;
    expect(vader.vt).toMatch(/^Prerelease/);
    ctl.pick(vader);
    // Before BL-262 this added the base-set card at SOR 1, not Darth Vader.
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase).toMatchObject({ kind: "found", fromPick: true });
  });

  it("BL-262 a printed-code collision (ASHP 16): the pick list, then exactly one copy of the CHOSEN card and the hold", () => {
    const { ctl, phases } = boot(true);
    const rows = ambiguous(ctl, "ASHP • EN 16");
    expect(batch()).toEqual([]);
    vi.advanceTimersByTime(HOLD_MS * 5);
    expect(ctl.flow.phase.kind).toBe("pick"); // never resolved on its own
    ctl.pick(rows.find((r) => r.target.name === "Grogu")!);
    expect(batch()).toEqual([["Grogu", "SS Top 8", "camera_fast_add"]]);
    expect(phases).toEqual(["pick", "hold"]);
  });
});

describe("BL-262 Fast add keeps its speed where nothing is asked", () => {
  it("BL-262 one card, one printing (SOR 100/252): added at once -- no found or pick phase", () => {
    const { ctl, phases } = boot(true);
    exact(ctl, "SOR • EN 100/252");
    expect(batch()).toEqual([["Scan Filler 100", "Standard", "camera_fast_add"]]);
    expect(phases).toEqual(["hold"]);
    expect(ctl.flow.phase).toMatchObject({ kind: "hold", fast: true });
  });

  // Early sets print Standard and Standard Foil under one number: one card,
  // one printing in two finishes. The keypad's non-foil default (BL-191) is
  // not a card choice, so Fast add keeps adding it at once.
  it("BL-262 early-set foil / non-foil (SOR 229/252): one card -- added at once as the non-foil default", () => {
    const { ctl, phases } = boot(true);
    exact(ctl, "SOR • EN R 229/252");
    expect(batch()).toEqual([["Cell Block Guard", "Standard", "camera_fast_add"]]);
    expect(phases).toEqual(["hold"]);
  });

  it("BL-262 a Weekly Play printing under its own number (SOR 4/20 -> SORP 4): added at once", () => {
    const { ctl, phases } = boot(true);
    exact(ctl, "SOR • EN 4/20");
    expect(batch()).toEqual([["Vader's Lightsaber", "Hyperspace", "camera_fast_add"]]);
    expect(phases).toEqual(["hold"]);
  });

  it("BL-262 signed out: unchanged -- no add, the prompt", () => {
    const { ctl } = boot(true, false);
    exact(ctl, "SOR • EN 100/252");
    expect(batch()).toEqual([]);
    expect(ctl.flow.phase.kind).toBe("found");
  });
});

describe("BL-262 prompt mode is unchanged: nothing is added without a tap", () => {
  it("BL-262 a shared number prompts with the keypad's default; Add adds what the panel shows", () => {
    const { ctl } = boot(false);
    exact(ctl, "SOR • EN C 74/252");
    expect(ctl.flow.phase.kind).toBe("found");
    expect(batch()).toEqual([]);
    expect(getToolState().picks).toEqual(NO_PICKS);
    ctl.add();
    expect(batch()).toEqual([["Scan Filler 74", "Standard", "camera"]]);
    expect(ctl.flow.phase).toMatchObject({ kind: "hold", fast: false });
  });
});

describe("BL-262 the one rule (fastAddTarget) and the Add condition it shares with the found panel", () => {
  const view = (set: string, num: string) => padView(set, num, NO_PICKS, padCatalog, cards);
  const read = (text: string) => targetOf(C.evaluate(text).best!.cards[0]);

  it("padAddable is the panel's Add condition: a resolved view with its printing", () => {
    expect(padAddable(view("SOR", "100"))?.variant.variant_type).toBe("Standard");
    // A shared number is addable (the keypad defaults it) -- which is why Add
    // being enabled cannot be Fast add's whole condition.
    expect(padAddable(view("SOR", "74"))?.card.name).toBe("Scan Filler 74");
    expect(padAddable(view("SOR", "999"))).toBeNull();
    expect(padAddable(view("SOR", ""))).toBeNull();
  });

  it("fastAddTarget: one card and one printing with nothing asked -> that printing; otherwise null", () => {
    const yes = (text: string) => {
      const t = read(text);
      return fastAddTarget(view(t.setCode, t.cardNumber), t.vids)?.card.name ?? null;
    };
    expect(yes("SOR • EN 100/252")).toBe("Scan Filler 100");
    expect(yes("SOR • EN R 229/252")).toBe("Cell Block Guard"); // finish only
    expect(yes("SOR • EN 4/20")).toBe("Vader's Lightsaber");
    expect(yes("SOR • EN C 74/252")).toBeNull(); // Which card?
    expect(yes("SOR • EN 12/20")).toBeNull(); // Which card? (default = another card)
    expect(yes("SOR • EN 172/252")).toBeNull(); // Set
    expect(yes("SOR • EN T1")).toBeNull(); // a token: the keypad names another card
  });

  it("fastAddTarget refuses a printing the camera did not read, even with nothing asked", () => {
    const v = view("SOR", "100");
    expect(v.kind === "card" && v.choices).toEqual([]);
    expect(fastAddTarget(v, [970100])?.variant.variant_id).toBe(970100);
    expect(fastAddTarget(v, [1, 2, 3])).toBeNull();
    expect(fastAddTarget(v, [])).toBeNull();
  });

  it("the read's printings travel with the target (targetOf, pick rows)", () => {
    const t = read("SOR • EN R 229/252");
    expect(t).toMatchObject({ setCode: "SOR", cardNumber: "229", name: "Cell Block Guard" });
    expect(t.vids.length).toBe(2); // Standard + Standard Foil
  });
});
