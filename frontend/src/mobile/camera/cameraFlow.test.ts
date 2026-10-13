import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "../../../e2e/mobile/fixtures/scan-catalog.snapshot.json";
import { audioUnlock, beep, cueCounts, resetCueForTest } from "../tool/cue";
import { CameraController } from "./cameraController";
import {
  CameraFlow,
  HOLD_MS,
  SETTLE_MS,
  SETTLE_OFF,
  isSettling,
  pickRows,
  programName,
  settleEnd,
  settleFrame,
  settleStart,
  settleStatus,
  targetOf,
} from "./cameraFlow";
import type { FlowEffects } from "./cameraFlow";
import { meterWords } from "./Meter";
import { Catalog } from "./scanCore";
import type { ScanCatalogData } from "./scanCore";
import type { Accepted } from "./scanLoop";

// BL-253 S7-14 / S7-15 / S7-17: the camera's decision state machine.

const C = new Catalog(snapshot as unknown as ScanCatalogData);

function accepted(text: string): Accepted {
  const ev = C.evaluate(text);
  return {
    key: ev.best!.key,
    ev,
    card: ev.best!.cards[0],
    reader: "paddle",
    keyStrength: "weak",
    tAcceptMs: 800,
    decision: { state: "accept", accept: true, key: ev.best!.key },
  };
}

function rig(fast = false, addOk = true) {
  let seq = 0;
  const log: string[] = [];
  const fx: FlowEffects = {
    now: () => 1000,
    fastAdd: () => fast,
    cue: vi.fn(() => log.push("cue")),
    add: vi.fn((t, via) => {
      log.push("add:" + via + ":" + t.setCode + " " + t.cardNumber);
      return addOk ? "b-" + ++seq : null;
    }),
    remove: vi.fn((id) => log.push("remove:" + id)),
    resume: vi.fn((key, hold) => log.push("resume:" + key + (hold ? ":hold" : ""))),
    setTimer: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    decision: vi.fn((d) => log.push("decision:" + d)),
    recognised: vi.fn(),
    pickShown: vi.fn(),
  };
  return { flow: new CameraFlow(fx), fx, log };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("S7-14 recognise-then-prompt (decision state machine)", () => {
  it("an exact read prompts (cue, paused) with the keypad's {setCode, cardNumber}; nothing counted", () => {
    const { flow, fx, log } = rig();
    flow.accepted(accepted("SOR • EN R 229/252"));
    expect(flow.phase).toMatchObject({
      kind: "found",
      key: "SOR 229/252",
      target: { setCode: "SOR", cardNumber: "229", name: "Cell Block Guard" },
    });
    expect(log).toEqual(["cue"]);
    expect(fx.add).not.toHaveBeenCalled();
    expect(fx.recognised).toHaveBeenCalledTimes(1);
  });

  it("Add -> one copy (via camera), the 1.5 s hold, then resume with the key suppressed", () => {
    const { flow, log } = rig();
    flow.accepted(accepted("SOR • EN R 229/252"));
    flow.add();
    expect(flow.phase).toMatchObject({ kind: "hold", entryId: "b-1", fast: false });
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(flow.phase.kind).toBe("hold");
    vi.advanceTimersByTime(1);
    expect(flow.phase.kind).toBe("searching");
    expect(log).toEqual(["cue", "add:camera:SOR 229", "decision:add", "resume:SOR 229/252"]);
  });

  it("Wrong card = restart the scan: no add, no keypad, suppression of that key", () => {
    const { flow, fx, log } = rig();
    flow.accepted(accepted("SOR • EN R 229/252"));
    flow.wrongCard();
    expect(flow.phase.kind).toBe("searching");
    expect(fx.add).not.toHaveBeenCalled();
    expect(log).toEqual(["cue", "decision:wrong_card", "resume:SOR 229/252"]);
  });

  it("Card details is a decision that leaves the prompt up; Add signed out keeps the prompt", () => {
    const { flow, log } = rig(false, false);
    flow.accepted(accepted("SOR • EN R 229/252"));
    flow.details();
    expect(flow.phase.kind).toBe("found");
    flow.add();
    expect(flow.phase.kind).toBe("found");
    expect(log).toEqual(["cue", "decision:details", "add:camera:SOR 229"]);
  });

  it("targetOf: the first printing's set + number", () => {
    const a = accepted("SOR • EN R 229/252");
    expect(targetOf(a.card)).toEqual({
      setCode: "SOR",
      cardNumber: "229",
      name: "Cell Block Guard",
    });
  });
});

describe("S7-15 ambiguous -> amber pick", () => {
  it("ASHP 16: a printed-code collision, one row per card with program names, never auto-resolved", () => {
    const { flow, fx } = rig(true);
    const ev = C.evaluate("ASHP • EN 16");
    expect(ev.result).toBe("ambiguous");
    expect(ev.reason).toBe("printed_code_collision");
    flow.ambiguous(ev, ev.reason);
    expect(flow.phase.kind).toBe("pick");
    expect(fx.pickShown).toHaveBeenCalledWith("printed_code_collision");
    expect(fx.add).not.toHaveBeenCalled(); // Fast add never skips a pick
    const rows = flow.phase.kind === "pick" ? flow.phase.rows : [];
    expect(
      rows
        .map((r) => [r.target.name, r.target.setCode, r.target.cardNumber, programName(r.vt)])
        .sort()
    ).toEqual([
      ["Emperor's Messenger", "ASHP", "16", "Weekly Play"],
      ["Grogu", "P26", "16", "Store Showdown · Top 8"],
    ]);
  });

  it("program names (rev4 PROGRAM map, verbatim)", () => {
    expect(programName("SS Top 8")).toBe("Store Showdown · Top 8");
    expect(programName("RQ Top 16")).toBe("Regional Qualifier · Top 16");
    expect(programName("PQ Winner")).toBe("Planetary Qualifier · Winner");
    expect(programName("SQ Top 4")).toBe("Sector Qualifier · Top 4");
    expect(programName("GC Champion")).toBe("Galactic Championship · Champion");
    expect(programName("Weekly Play")).toBe("Weekly Play");
  });

  it("N/2 tiers are always a pick (small_series_N_of_2), even for one card", () => {
    // Every SOR / SHD / TWI "/2" printing in the spike catalogue is a pick.
    const rows = (snapshot as unknown as ScanCatalogData).p.filter(
      (r) => r[5] === "2" && ["SOR", "SHD", "TWI"].includes(r[0])
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows.slice(0, 12)) {
      const ev = C.evaluate(r[0] + " EN " + r[1] + "/2");
      expect(ev.result).toBe("ambiguous");
      expect(ev.reason).toBe("small_series_N_of_2");
    }
  });

  it("a pick resolves (cue), then the prompt -- or, under Fast add, the add + hold", () => {
    const ev = C.evaluate("ASHP • EN 16");
    const a = rig(false);
    a.flow.ambiguous(ev, ev.reason);
    const rowsA = a.flow.phase.kind === "pick" ? a.flow.phase.rows : [];
    const grogu = rowsA.find((r) => r.target.setCode === "P26")!;
    a.flow.pick(grogu);
    expect(a.flow.phase).toMatchObject({
      kind: "found",
      fromPick: true,
      target: { setCode: "P26" },
    });
    expect(a.log).toEqual(["decision:pick", "cue"]);

    const b = rig(true);
    b.flow.ambiguous(ev, ev.reason);
    const rowsB = b.flow.phase.kind === "pick" ? b.flow.phase.rows : [];
    b.flow.pick(rowsB.find((r) => r.target.setCode === "ASHP")!);
    expect(b.flow.phase).toMatchObject({ kind: "hold", fast: true, target: { setCode: "ASHP" } });
    expect(b.log).toEqual(["decision:pick", "cue", "add:camera_fast_add:ASHP 16"]);
  });

  it("Neither / scan again = wrong card", () => {
    const ev = C.evaluate("ASHP • EN 16");
    const { flow, log } = rig();
    flow.ambiguous(ev, ev.reason);
    flow.wrongCard();
    expect(flow.phase.kind).toBe("searching");
    expect(log).toEqual(["decision:wrong_card", "resume:ASHP 16"]);
  });

  it("pickRows folds finishes of one printing into one row", () => {
    const rows = pickRows([
      {
        card: 1,
        name: "A",
        subtitle: "",
        type: "Unit",
        home: "SOR",
        printings: [
          { vid: 10, vt: "Standard", src: "SOR", num: 5 },
          { vid: 11, vt: "Standard Foil", src: "SOR", num: 5 },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].vids).toEqual([10, 11]);
  });
});

describe("S7-17 cue + Fast add + hold", () => {
  it("Fast add: a read adds one copy at once (camera_fast_add), hold 1500 ms, resume holding the key until it leaves", () => {
    const { flow, log } = rig(true);
    flow.accepted(accepted("SOR • EN R 229/252"));
    expect(flow.phase).toMatchObject({ kind: "hold", fast: true, entryId: "b-1" });
    vi.advanceTimersByTime(1499);
    expect(flow.phase.kind).toBe("hold");
    vi.advanceTimersByTime(1);
    expect(flow.phase.kind).toBe("searching");
    expect(log).toEqual(["cue", "add:camera_fast_add:SOR 229", "resume:SOR 229/252:hold"]);
  });

  it("Wrong card during the hold takes that copy back out (and cancels the timer)", () => {
    const { flow, log } = rig(true);
    flow.accepted(accepted("SOR • EN R 229/252"));
    flow.wrongCard();
    expect(log).toEqual([
      "cue",
      "add:camera_fast_add:SOR 229",
      "decision:wrong_card",
      "remove:b-1",
      "resume:SOR 229/252",
    ]);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(log.filter((l) => l.startsWith("resume"))).toHaveLength(1);
  });

  it("Fast add on a number that needs a pick falls back to the prompt", () => {
    const { flow } = rig(true, false);
    flow.accepted(accepted("SOR • EN R 229/252"));
    expect(flow.phase.kind).toBe("found");
  });

  it("the cue is a beep (1320 Hz, 0.0001 -> 0.2 -> 0.0001, stop +90 ms) + flash; never navigator.vibrate", () => {
    resetCueForTest();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const calls: string[] = [];
    class FakeCtx {
      state = "suspended";
      currentTime = 2;
      destination = {};
      resume() {
        this.state = "running";
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect: () => {},
          start: (t: number) => calls.push("start " + t),
          stop: (t: number) => calls.push("stop " + t),
          set freq(v: number) {
            void v;
          },
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: (v: number, t: number) => calls.push("set " + v + "@" + t),
            exponentialRampToValueAtTime: (v: number, t: number) =>
              calls.push("ramp " + v + "@" + t),
          },
          connect: () => {},
        };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    expect(beep()).toBe(false); // no context before a user gesture
    audioUnlock();
    expect(beep()).toBe(true);
    expect(calls).toEqual([
      "set 0.0001@2",
      "ramp 0.2@2.01",
      "ramp 0.0001@2.08",
      "start 2",
      "stop 2.09",
    ]);
    expect(cueCounts.beeps).toBe(2);
    expect(vibrate).not.toHaveBeenCalled();
    // No vibrate call anywhere in the camera's sources (owner: no haptics).
    for (const f of [
      "src/mobile/tool/cue.ts",
      "src/mobile/camera/CameraScreen.tsx",
      "src/mobile/camera/cameraController.ts",
      "src/mobile/camera/cameraFlow.ts",
    ])
      expect(readFileSync(f, "utf8")).not.toMatch(/\.vibrate\s*\(/);
  });

  it("the flash: #178a3a at .45, no transition in, .35 s out, pointer-events none (camera.css)", () => {
    const css = readFileSync("src/mobile/camera/camera.css", "utf8");
    const base = /\.m-camflash \{([^}]*)\}/.exec(css)![1];
    const on = /\.m-camflash--on \{([^}]*)\}/.exec(css)![1];
    expect(base).toMatch(/background: #178a3a/);
    expect(base).toMatch(/pointer-events: none/);
    expect(base).toMatch(/transition: opacity 0\.35s ease-out/);
    expect(on).toMatch(/opacity: 0\.45/);
    expect(on).toMatch(/transition: none/);
  });
});

describe("FR5-03 camera-start focusing state (F-16)", () => {
  const T0 = 10_000;

  it("no stream: off", () => {
    expect(settleStatus(SETTLE_OFF, T0)).toBe("off");
    expect(isSettling(SETTLE_OFF, T0)).toBe(false);
    // Nothing ends or frames a state that never started.
    expect(settleFrame(SETTLE_OFF, "green", T0)).toBe(SETTLE_OFF);
    expect(settleEnd(SETTLE_OFF, "read", T0)).toBe(SETTLE_OFF);
  });

  it("dim from the stream start, before either trigger; blurry frames keep it dim", () => {
    let s = settleStart(T0);
    expect(isSettling(s, T0)).toBe(true);
    for (const t of [T0 + 80, T0 + 900, T0 + SETTLE_MS - 1]) {
      s = settleFrame(s, "red", t);
      expect(settleStatus(s, t)).toBe("settling");
    }
  });

  it("clears at the first frame that is not blurry (amber or green)", () => {
    for (const band of ["amber", "green"] as const) {
      let s = settleStart(T0);
      s = settleFrame(s, "red", T0 + 200);
      expect(isSettling(s, T0 + 200)).toBe(true);
      s = settleFrame(s, band, T0 + 640);
      expect(settleStatus(s, T0 + 640)).toBe("sharp");
      expect(isSettling(s, T0 + 640)).toBe(false);
    }
  });

  it("clears at 3 s with no sharp frame", () => {
    expect(SETTLE_MS).toBe(3000);
    let s = settleStart(T0);
    s = settleFrame(s, "red", T0 + 2990);
    expect(settleStatus(s, T0 + 2999)).toBe("settling");
    expect(settleStatus(s, T0 + 3000)).toBe("timeout");
    expect(isSettling(s, T0 + 60_000)).toBe(false);
    // A sharp frame after the limit does not rewrite how it ended.
    expect(settleStatus(settleFrame(s, "green", T0 + 3500), T0 + 3500)).toBe("timeout");
  });

  it("a blurry frame after clearing does not dim it again", () => {
    let s = settleFrame(settleStart(T0), "green", T0 + 300);
    for (const t of [T0 + 400, T0 + 1000, T0 + 2500, T0 + 9000]) {
      s = settleFrame(s, "red", t);
      expect(isSettling(s, t)).toBe(false);
      expect(settleStatus(s, t)).toBe("sharp");
    }
    // The same after the time limit.
    let u = settleStart(T0);
    u = settleFrame(u, "red", T0 + 3100);
    expect(isSettling(u, T0 + 3100)).toBe(false);
  });

  it("a card read while dim ends it", () => {
    const s = settleEnd(settleStart(T0), "read", T0 + 700);
    expect(settleStatus(s, T0 + 700)).toBe("read");
    // ... and a later sharp frame keeps that.
    expect(settleStatus(settleFrame(s, "green", T0 + 800), T0 + 800)).toBe("read");
  });

  it("resets on a new stream start, whatever ended the last one", () => {
    const ended = [
      settleFrame(settleStart(T0), "green", T0 + 300),
      settleEnd(settleStart(T0), "read", T0 + 300),
      settleStart(T0), // times out
    ];
    for (const s of ended) {
      expect(isSettling(s, T0 + 5000)).toBe(false);
      const again = settleStart(T0 + 5000);
      expect(isSettling(again, T0 + 5000)).toBe(true);
      expect(isSettling(again, T0 + 7999)).toBe(true);
      expect(settleStatus(again, T0 + 8000)).toBe("timeout");
    }
  });

  // REPLACE (owner decision 2026-10-12 after review, T1): no hint line under
  // "Focusing…" -- was sub "Wait to line up".
  it("the meter word: Focusing… alone (no second line), one fixed accessible label", () => {
    expect(meterWords({ kind: "focusing" })).toEqual({
      word: "Focusing…",
      sub: "",
      label: "Focusing…",
    });
    expect(readFileSync("src/mobile/camera/Meter.tsx", "utf8")).not.toMatch(/Wait to line up/);
  });

  it("display only: no analytics event, toast or haptics in the settle code", () => {
    const flow = readFileSync("src/mobile/camera/cameraFlow.ts", "utf8");
    const settleSrc = flow.slice(flow.indexOf("FR5-03"), flow.indexOf("/** What the keypad"));
    expect(settleSrc.length).toBeGreaterThan(500);
    expect(settleSrc).not.toMatch(/scan[A-Z]\w*\(|capture\(|vibrate|toast/i);
    const analytics = readFileSync("src/mobile/camera/scanAnalytics.ts", "utf8");
    expect(analytics).not.toMatch(/settl|focusing/i);
    // The read loop never looks at it: reading is not gated or delayed.
    expect(readFileSync("src/mobile/camera/scanLoop.ts", "utf8")).not.toMatch(/settl/i);
  });

  it("the guide dims by opacity only and returns in 0.15 s; none under reduced motion (camera.css)", () => {
    const css = readFileSync("src/mobile/camera/camera.css", "utf8");
    const dim = /\.m-guide--settling \{([^}]*)\}/.exec(css)![1];
    expect(dim.trim()).toBe("opacity: 0.45;");
    const corner = /\.m-guide__corner \{([^}]*)\}/.exec(css)![1];
    expect(corner).toMatch(/transition: opacity 0\.15s ease/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(/\.m-guide__corner \{([^}]*)\}/.exec(reduced)![1]).toMatch(/transition: none/);
    expect(/\.m-guide__box \{([^}]*)\}/.exec(reduced)![1]).not.toMatch(/opacity/);
  });
});

describe("FR5-03 controller: every stream start begins the focusing state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fakeStream = () => {
    const track = { stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  const scan = {
    startReader: async () => ({ ok: true }),
    reader: {},
    fallback: {},
  } as unknown as ConstructorParameters<typeof CameraController>[0];

  it("settling on start, timeout at 3 s, off when stopped, settling again on Start", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => fakeStream() },
    });
    const ctl = new CameraController(scan);
    const seen: string[] = [];
    ctl.subscribe(() => {
      const s = ctl.getSnapshot().settle;
      if (seen[seen.length - 1] !== s) seen.push(s);
    });
    expect(ctl.getSnapshot().settle).toBe("off");
    ctl.startStream();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.getSnapshot().stream.kind).toBe("live");
    expect(ctl.getSnapshot().settle).toBe("settling");
    await vi.advanceTimersByTimeAsync(2900);
    expect(ctl.getSnapshot().settle).toBe("settling");
    await vi.advanceTimersByTimeAsync(200);
    expect(ctl.getSnapshot().settle).toBe("timeout");
    // The page hides: the stream pauses, the state is off.
    ctl.stream.stop("paused");
    expect(ctl.getSnapshot().settle).toBe("off");
    // Start after "Camera paused": the state begins again.
    ctl.startStream();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.getSnapshot().settle).toBe("settling");
    // A card read while dim ends it (the found prompt takes over).
    ctl.flow.ambiguous(
      {
        best: { key: "K", cards: [], reason: "two_cards" },
      } as unknown as Parameters<typeof ctl.flow.ambiguous>[0],
      "two_cards"
    );
    expect(ctl.getSnapshot().phase.kind).toBe("pick");
    expect(ctl.getSnapshot().settle).toBe("read");
    // ... and no timer brings anything back later.
    await vi.advanceTimersByTimeAsync(5000);
    expect(ctl.getSnapshot().settle).toBe("read");
    ctl.stream.stop();
    ctl.loop.stop();
    ctl.flow.dispose();
    // ("off" first: the stream's "starting" notice arrives before it is live.)
    expect(seen).toEqual(["off", "settling", "timeout", "off", "settling", "read", "off"]);
  });

  // Review FR5 N2: the cover (a phone on its side is one) blocks reading in
  // the same commit that shows it.
  it("setBlocked pauses the loop at once; the screen applies it in a layout effect", () => {
    const ctl = new CameraController(scan);
    expect(ctl.loop.paused).toBe(false);
    ctl.setBlocked(true);
    // Synchronous: a read still in flight is dropped by the loop's paused check.
    expect(ctl.loop.paused).toBe(true);
    ctl.setBlocked(false);
    expect(ctl.loop.paused).toBe(false);
    ctl.loop.stop();
    ctl.flow.dispose();
    const src = readFileSync("src/mobile/camera/CameraScreen.tsx", "utf8");
    const call = src.indexOf("ctl.setBlocked(blocked)");
    expect(call).toBeGreaterThan(0);
    const before = src.slice(0, call);
    // The nearest effect opening before the call is the layout one.
    expect(before.lastIndexOf("useLayoutEffect(")).toBeGreaterThan(
      before.lastIndexOf("useEffect(")
    );
    expect(before.slice(before.lastIndexOf("const blocked ="))).toMatch(/\|\| sideways;/);
    // ... and the loop drops a read that finishes while paused.
    expect(readFileSync("src/mobile/camera/scanLoop.ts", "utf8")).toMatch(
      /if \(this\.paused \|\| !this\.running\) return;/
    );
  });
});
