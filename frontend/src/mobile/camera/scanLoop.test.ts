import { describe, expect, it, vi } from "vitest";
import snapshot from "../../../e2e/mobile/fixtures/scan-catalog.snapshot.json";
import { Acceptor, Catalog } from "./scanCore";
import type { ScanCatalogData } from "./scanCore";
import { ScanLoop, partialRead, timeBucket } from "./scanLoop";
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

  it("after a decision the same key is suppressed for 3 s (then prompts again)", async () => {
    const accepts: number[] = [];
    const { loop, at } = rig(
      { primary: async () => ok("SOR • EN R 229/252", 92) },
      { onAccept: () => accepts.push(1) }
    );
    let t = 0;
    const step = async () => {
      at((t += 100));
      await loop.readOnce();
    };
    for (let k = 0; k < 3; k++) await step();
    expect(accepts).toHaveLength(1);
    loop.resume("SOR 229/252");
    for (let k = 0; k < 25; k++) await step(); // 2.5 s: suppressed
    expect(accepts).toHaveLength(1);
    for (let k = 0; k < 10; k++) await step(); // past 3 s
    expect(accepts).toHaveLength(2);
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
