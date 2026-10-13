import { describe, expect, it, vi } from "vitest";
import snapshot from "../../../e2e/mobile/fixtures/scan-catalog.snapshot.json";
import { Acceptor, Catalog } from "./scanCore";
import type { ScanCatalogData } from "./scanCore";
import { ScanLoop, WRONG_CARD_QUIET_MS, partialRead, timeBucket } from "./scanLoop";
import type { LoopDeps, LoopEvents, ReaderResult } from "./scanLoop";

// BL-253 S7-13: the read loop with a stub reader. The test_core.js run_1
// sequence (owner run 1, 85.2-89.6 s, the Mandalorian ASH 795, Tesseract
// confidences) replayed through the loop ends in exactly ONE found (prompt
// mode pauses on acceptance); the Tesseract fallback is capped at 1 per 2
// frames and skipped on an empty primary; the num-length check rejects; a
// blurry frame is never read; a dead reader stops the loop.

const C = new Catalog(snapshot as unknown as ScanCatalogData);
const M = (n: number) => "ASH • EN L " + n;
const run1: [number, number, number][] = [
  [85.2, 796, 34],
  [85.3, 785, 57],
  [85.5, 788, 49],
  [85.6, 795, 32],
  [85.65, 795, 51],
  [85.8, 795, 59],
  [85.9, 785, 46],
  [86.0, 795, 68],
  [86.2, 785, 25],
  [86.4, 795, 23],
  [86.5, 785, 41],
  [86.7, 795, 62],
  [86.9, 795, 52],
  [87.1, 795, 42],
  [87.2, 785, 47],
  [87.4, 795, 60],
  [87.6, 795, 36],
  [87.8, 795, 24],
  [88.0, 785, 17],
  [88.2, 785, 45],
  [88.3, 795, 44],
  [88.5, 795, 32],
  [88.7, 795, 16],
  [88.9, 795, 18],
  [89.1, 795, 24],
  [89.2, 795, 44],
  [89.25, 795, 51],
  [89.4, 785, 46],
  [89.5, 795, 66],
  [89.6, 795, 40],
];

const ok = (
  text: string,
  confidence: number | null = 90,
  glyph_px: number | null = 30
): ReaderResult => ({
  ok: true,
  text,
  confidence,
  ms: 10,
  glyph_px,
  box_count: text ? 1 : 0,
});

function rig(over: Partial<LoopDeps> = {}, events: LoopEvents = {}) {
  let t = 0;
  const deps: LoopDeps = {
    catalog: C,
    acceptor: new Acceptor({ rearmDiffN: Infinity }),
    now: () => t,
    sleep: async () => {},
    frame: () => ({ gate: 50 }),
    primary: async () => ok(""),
    fallback: async () => ok("", 0, null),
    digits: async () => ok("", 0, null),
    ...over,
  };
  const loop = new ScanLoop(deps, events);
  loop.running = true;
  return { loop, deps, at: (ms: number) => (t = ms) };
}

describe("S7-13 read loop + agreement (stub reader)", () => {
  it("run_1 replayed through the loop -> exactly one found (ASH 795), then paused", async () => {
    const accepts: string[] = [];
    let i = 0;
    // Tesseract-scale confidences, read by the primary (Paddle, bar 60): x2
    // keeps every agreeing read's conf / bar ratio identical to the replay's.
    const { loop, at } = rig(
      { primary: async () => ok(M(run1[i][1]), run1[i][2] * 2) },
      { onAccept: (a) => accepts.push(a.key) }
    );
    for (i = 0; i < run1.length; i++) {
      at(Math.round(run1[i][0] * 1000));
      await loop.readOnce();
    }
    expect(accepts).toEqual(["ASH 795"]);
    expect(loop.paused).toBe(true);
  });

  it("an accept reports reader, key strength and first-text -> prompt time", async () => {
    const got: { reader: string; ks: string; t: number | null }[] = [];
    const { loop, at } = rig(
      { primary: async () => ok("SOR • EN R 229/252", 92) },
      { onAccept: (a) => got.push({ reader: a.reader, ks: a.keyStrength, t: a.tAcceptMs }) }
    );
    for (const ms of [1000, 1300, 1600]) {
      at(ms);
      await loop.readOnce();
    }
    expect(got).toEqual([{ reader: "paddle", ks: "weak", t: 600 }]);
    expect(timeBucket(600)).toBe("<1s");
  });

  it("the Tesseract fallback: only on a non-empty primary without code + number, max 1 per 2 frames", async () => {
    const fallback = vi.fn(async () => ok("", 0, null));
    const { loop } = rig({ primary: async () => ok("SOR"), fallback });
    for (let k = 0; k < 6; k++) await loop.readOnce();
    expect(loop.stats.fallbackUsed).toBe(3);
    expect(loop.stats.fallbackSkipped).toBe(3);
    // PSM 6 then 7 per fallback (both empty, inside the 700 ms budget).
    expect(fallback.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([
      6, 7, 6, 7, 6, 7,
    ]);

    const empty = rig({ primary: async () => ok("", null, null), fallback: vi.fn() });
    for (let k = 0; k < 4; k++) await empty.loop.readOnce();
    expect(empty.loop.stats.fallbackUsed).toBe(0);
    expect(empty.deps.fallback).not.toHaveBeenCalled();
  });

  it("the fallback wins when it reads code + number (its read counts); frames alternate", async () => {
    const statuses: string[] = [];
    const { loop } = rig(
      {
        primary: async () => ok("SOR EN"),
        fallback: async () => ok("SOR • EN R 229/252", 80),
      },
      { onStatus: (s) => statuses.push(s.kind + ":" + ("key" in s ? s.key : s.reason)) }
    );
    for (let n = 0; n < 4; n++) await loop.readOnce();
    // Frame 1 + 3: Tesseract read the key; 2 + 4: rate-capped, Paddle's
    // code-only read stands (the spike's 1-per-2-frames cap, verbatim -- an
    // alternating stream never reaches 3 of the last 4).
    expect(statuses).toEqual([
      "confirming:SOR 229/252",
      "searching:no_number",
      "confirming:SOR 229/252",
      "searching:no_number",
    ]);
  });

  it("num-length conflict: an exact no-denominator read with a longer digit run is rejected", async () => {
    const statuses: string[] = [];
    const { loop } = rig(
      { primary: async () => ok("ASH·EN L795"), digits: async () => ok("7950", 80, null) },
      { onStatus: (s) => statuses.push(s.kind + ":" + ("reason" in s ? s.reason : "")) }
    );
    await loop.readOnce();
    expect(statuses).toEqual(["searching:num_len_conflict"]);
  });

  it("a blurry frame is never read; no frame waits; a dead reader stops the loop", async () => {
    const primary = vi.fn(async () => ok("SOR"));
    const gates: (number | null)[] = [];
    const b = rig({ frame: () => ({ gate: 13.9 }), primary }, { onGate: (g) => gates.push(g) });
    await b.loop.readOnce();
    expect(primary).not.toHaveBeenCalled();
    expect(b.loop.stats.skippedBlur).toBe(1);
    expect(gates).toEqual([13.9]);

    const none = rig({ frame: () => null, primary });
    await none.loop.readOnce();
    expect(primary).not.toHaveBeenCalled();

    const fails: string[] = [];
    const dead = rig(
      { primary: async () => ({ ok: false, reason: "init_timeout" }) },
      { onReaderFailure: (r) => fails.push(r) }
    );
    await dead.loop.readOnce();
    expect(fails).toEqual(["init_timeout"]);
    expect(dead.loop.running).toBe(false);
  });

  // REPLACE (owner decision 2026-10-13, BL-262). Was one test: "after a
  // decision the same key is suppressed for 3 s (then prompts again)" -- the
  // 3 s applied after EVERY decision, an add included. The owner removed it
  // after an add ("the camera reset of 1 second should be enough friction");
  // it stays after Wrong card. The seven tests below replace it, one per rule,
  // on a virtual clock (a read every 100 ms).
  const KEY = "SOR 229/252";
  const CARD = "SOR • EN R 229/252";

  /** A loop that has accepted CARD once and is paused on it. `show` swaps
   * what the camera sees; `run(n)` reads n frames; times are since `mark()`. */
  async function accepted() {
    let text = CARD;
    let t = 0;
    let t0 = 0;
    const accepts: number[] = [];
    const ambig: number[] = [];
    const statuses: string[] = [];
    const { loop, at } = rig(
      { primary: async () => ok(text, text ? 92 : null, text ? 30 : null) },
      {
        onAccept: () => accepts.push(t - t0),
        onAmbiguous: () => ambig.push(t - t0),
        onStatus: (s) => statuses.push(s.kind),
      }
    );
    const run = async (n: number) => {
      for (let k = 0; k < n; k++) {
        at((t += 100));
        await loop.readOnce();
      }
    };
    await run(3);
    expect(accepts).toHaveLength(1);
    expect(loop.paused).toBe(true);
    accepts.length = 0;
    statuses.length = 0;
    return {
      loop,
      run,
      accepts,
      ambig,
      statuses,
      show: (s: string) => (text = s),
      mark: () => (t0 = t),
    };
  }

  it("BL-262 Wrong card: the same read stays quiet for 3 s, then prompts again", async () => {
    expect(WRONG_CARD_QUIET_MS).toBe(3000);
    const r = await accepted();
    r.mark();
    r.loop.resume(KEY, "wrong_card");
    await r.run(29); // 2.9 s: agreed again and again, never prompted
    expect(r.accepts).toEqual([]);
    expect(r.statuses).toContain("suppressed");
    await r.run(6);
    expect(r.accepts).toHaveLength(1);
    expect(r.accepts[0]).toBeGreaterThanOrEqual(3000);
  });

  it("BL-262 after an Add (prompt mode) there is no timed wait: the card still in view is prompted again on the next agreement", async () => {
    const r = await accepted();
    r.mark();
    r.loop.resume(KEY, "add");
    await r.run(3); // three agreeing reads = the agreement rule, nothing more
    expect(r.accepts).toEqual([300]);
    expect(r.statuses).not.toContain("suppressed");
    expect(r.loop.paused).toBe(true); // a prompt: the loop waits for the user
  });

  it("BL-262 after a Fast add the card left under the camera is never accepted again (no 3 s wait needed)", async () => {
    const r = await accepted();
    r.mark();
    r.loop.resume(KEY, "fast_add");
    await r.run(120); // 12 s in view
    expect(r.accepts).toEqual([]);
    expect(new Set(r.statuses)).toEqual(new Set(["held"]));
  });

  it("BL-262 after a Fast add, under a second of lost reads is not 'left the frame': still not accepted again", async () => {
    const r = await accepted();
    r.mark();
    r.loop.resume(KEY, "fast_add");
    await r.run(5);
    for (let round = 0; round < 6; round++) {
      r.show(""); // 0.9 s with nothing readable (a hand over the card)
      await r.run(9);
      r.show(CARD);
      await r.run(20);
    }
    expect(r.accepts).toEqual([]);
  });

  it("BL-262 after a Fast add, a card taken out for a second and returned is accepted again -- before the old 3 s", async () => {
    const r = await accepted();
    r.mark();
    r.loop.resume(KEY, "fast_add");
    r.show(""); // out of the frame at once
    await r.run(12); // 1.2 s away (the reader's re-arm: >= 1 s without it)
    expect(r.accepts).toEqual([]);
    r.show(CARD); // back
    await r.run(18);
    // The reader's own duplicate window (2 s since the resume, scanCore
    // DUP_MS -- untouched) is the only wait left; the 3 s is gone.
    expect(r.accepts).toHaveLength(1);
    expect(r.accepts[0]).toBeGreaterThanOrEqual(2000);
    expect(r.accepts[0]).toBeLessThan(3000);
  });

  it("BL-262 after a Fast add the same card returned later is accepted on plain agreement", async () => {
    const r = await accepted();
    r.loop.resume(KEY, "fast_add");
    r.show("");
    await r.run(30); // 3 s away
    r.show(CARD);
    r.mark();
    await r.run(3);
    expect(r.accepts).toEqual([300]);
  });

  // A pick's key is an ambiguous read, which the Acceptor cannot hold "until
  // it leaves" (it only matches exact reads). With the 3 s gone, a card left
  // in view after a pick + add is ASKED again -- a question, never an add.
  it("BL-262 after a pick + add the card still in view opens the pick again; nothing is accepted", async () => {
    let t = 0;
    const ambig: number[] = [];
    const accepts: number[] = [];
    const { loop, at } = rig(
      { primary: async () => ok("ASHP • EN 16", 92) },
      { onAmbiguous: () => ambig.push(t), onAccept: () => accepts.push(t) }
    );
    const run = async (n: number) => {
      for (let k = 0; k < n; k++) {
        at((t += 100));
        await loop.readOnce();
      }
    };
    await run(2);
    expect(ambig).toEqual([200]);
    loop.resume("ASHP 16", "fast_add");
    await run(30);
    expect(accepts).toEqual([]);
    expect(ambig).toHaveLength(2);
    expect(loop.paused).toBe(true);
    // ... while "Neither / scan again" keeps it quiet for 3 s.
    const resumed = t;
    loop.resume("ASHP 16", "wrong_card");
    await run(29);
    expect(ambig).toHaveLength(2);
    await run(4);
    expect(ambig).toHaveLength(3);
    expect(ambig[2] - resumed).toBeGreaterThanOrEqual(3000);
  });

  it("S7-F1 one number_conflict frame between clean frames does not open a pick", async () => {
    const reads = [
      "ASHP·EN O 16 1",
      "SOR • EN R 229/252",
      "SOR • EN R 229/252",
      "SOR • EN R 229/252",
    ];
    let i = 0;
    const accepts: string[] = [];
    const ambig: string[] = [];
    const { loop, at } = rig(
      { primary: async () => ok(reads[i], 92) },
      { onAccept: (a) => accepts.push(a.key), onAmbiguous: (_e, r) => ambig.push(r) }
    );
    for (i = 0; i < reads.length; i++) {
      at(1000 + i * 300);
      await loop.readOnce();
    }
    expect(ambig).toEqual([]);
    expect(accepts).toEqual(["SOR 229/252"]);
  });

  it("S7-F1 two consecutive same-key ambiguous reads open one pick", async () => {
    const ambig: string[] = [];
    const { loop, at } = rig(
      { primary: async () => ok("ASHP • EN 16", 92) },
      { onAmbiguous: (_e, r) => ambig.push(r) }
    );
    for (let k = 0; k < 2; k++) {
      at(1000 + k * 300);
      await loop.readOnce();
    }
    expect(ambig).toHaveLength(1);
    expect(loop.paused).toBe(true);
  });

  it("partialRead: the newest of the last 8 reads with a code or number", () => {
    expect(partialRead([])).toBeNull();
    expect(
      partialRead([
        { code: "SOR", num: "229" },
        { code: null, num: null },
      ])
    ).toEqual({ code: "SOR", num: "229" });
    const old = [{ code: "SOR", num: null }, ...Array(8).fill({ code: null, num: null })];
    expect(partialRead(old)).toBeNull();
  });
});
