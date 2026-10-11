import { afterEach, describe, expect, it, vi } from "vitest";
import { createFallbackReader, glyphPx } from "./fallbackReader";
import type { TessWorker } from "./fallbackReader";
import { createReaderHandler, summariseRead } from "./readerCore";
import type { EngineResult, PaddleEngine, WorkerRequest, WorkerResponse } from "./readerCore";
import { createPaddleClient } from "./readerClient";
import type { WorkerLike } from "./readerClient";

// BL-253 S7-05: the reader worker's message protocol with a stub engine, the
// glyph rule, and the main-thread client / Tesseract wrapper. No real model.

const initReq = (id = 1, isolated = true, hwc: number | null = 12): WorkerRequest => ({
  type: "init",
  id,
  base: "https://x/vendor/scan/paddle/",
  crossOriginIsolated: isolated,
  hardwareConcurrency: hwc,
});

function handlerWith(engine: PaddleEngine | Error) {
  const loadEngine = vi.fn(async () => {
    if (engine instanceof Error) throw engine;
    return engine;
  });
  let t = 0;
  const handle = createReaderHandler({
    loadEngine,
    toSurface: (f) => f,
    now: () => (t += 10),
  });
  return { handle, loadEngine };
}

const box = (h: number) => ({ box: { height: h } });

describe("S7-05 reader worker protocol", () => {
  it("init: loads the engine with the thread rule and reports load ms", async () => {
    const { handle, loadEngine } = handlerWith({ recognize: async () => ({}) });
    const res = (await handle(initReq(7, true, 12))) as WorkerResponse & { ok: true };
    expect(res).toMatchObject({
      type: "init",
      id: 7,
      ok: true,
      threads: 4,
      crossOriginIsolated: true,
    });
    expect(loadEngine).toHaveBeenCalledWith("https://x/vendor/scan/paddle/", 4);
    expect(res).toHaveProperty("loadMs");
  });

  it("init: one thread when not isolated; a second init does not reload", async () => {
    const { handle, loadEngine } = handlerWith({ recognize: async () => ({}) });
    const a = await handle(initReq(1, false, 12));
    const b = await handle(initReq(2, false, 12));
    expect(a).toMatchObject({ ok: true, threads: 1 });
    expect(b).toMatchObject({ id: 2, ok: true });
    expect(loadEngine).toHaveBeenCalledTimes(1);
  });

  it("init failure -> {ok:false, reason}, never a throw; read then says not_ready; init can be retried", async () => {
    const { handle, loadEngine } = handlerWith(new Error("wasm blocked"));
    const res = await handle(initReq(1));
    expect(res).toEqual({ type: "init", id: 1, ok: false, reason: "init_failed: wasm blocked" });
    expect(await handle({ type: "read", id: 2, frame: {} })).toEqual({
      type: "read",
      id: 2,
      ok: false,
      reason: "not_ready",
    });
    await handle(initReq(3));
    expect(loadEngine).toHaveBeenCalledTimes(2);
  });

  it("read: the spike's result shape (upper-cased, newlines -> space, 1 dp confidence, glyph rule)", async () => {
    const engine: PaddleEngine = {
      recognize: async (): Promise<EngineResult> => ({
        text: "sor •\nen r 229/252\n",
        confidence: 0.9286,
        lines: [[box(23.4), box(31)], [box(25)]],
      }),
    };
    const { handle } = handlerWith(engine);
    await handle(initReq());
    const res = await handle({ type: "read", id: 5, frame: {} });
    expect(res).toMatchObject({
      type: "read",
      id: 5,
      ok: true,
      text: "SOR • EN R 229/252",
      confidence: 92.9,
      box_count: 3,
      // sorted rounded heights 23, 25, 31 -> median 25 -> 25 / 1.4 = 17.86 -> 18
      box_h: 25,
      glyph_px: 18,
    });
    expect(res).toHaveProperty("ms");
  });

  it("glyph rule: round(median box height / 1.4); null with no box; null confidence kept", () => {
    expect(summariseRead({ text: "x", lines: [[box(28)]] }, 5).glyph_px).toBe(20);
    expect(summariseRead({ text: "x", lines: [[box(31)]] }, 5).glyph_px).toBe(22); // the floor
    expect(summariseRead({ text: "x", lines: [[box(30)]] }, 5).glyph_px).toBe(21); // below it
    const none = summariseRead({ text: "", lines: [[], [null]] }, 5);
    expect(none).toMatchObject({ box_count: 0, box_h: null, glyph_px: null, confidence: null });
  });

  it("read failure -> {ok:false, reason}, never a throw", async () => {
    const { handle } = handlerWith({
      recognize: async () => {
        throw new Error("oom");
      },
    });
    await handle(initReq());
    expect(await handle({ type: "read", id: 9, frame: {} })).toEqual({
      type: "read",
      id: 9,
      ok: false,
      reason: "read_failed: oom",
    });
  });
});

describe("S7-05 reader client", () => {
  afterEach(() => vi.useRealTimers());

  /** A worker double that answers through the real handler. */
  function loopbackWorker(engine: PaddleEngine | Error): WorkerLike {
    const { handle } = handlerWith(engine);
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
      postMessage(msg) {
        void handle(msg as WorkerRequest).then((res) => w.onmessage?.({ data: res }));
      },
    };
    return w;
  }

  it("init then read round-trips through the worker; the UI never throws", async () => {
    const c = createPaddleClient({
      workerFactory: () => loopbackWorker({ recognize: async () => ({ text: "ash en l 795" }) }),
      base: "https://x/p/",
      env: { crossOriginIsolated: true, hardwareConcurrency: 2 },
    });
    expect(c.state).toBe("idle");
    expect(await c.read({} as ImageData)).toEqual({ ok: false, reason: "not_ready" });
    const init = await c.init();
    expect(init).toMatchObject({ ok: true, threads: 2 });
    expect(c.state).toBe("ready");
    expect(await c.read({} as ImageData)).toMatchObject({ ok: true, text: "ASH EN L 795" });
  });

  it("init failure and a worker that cannot be created both resolve {ok:false}", async () => {
    const bad = createPaddleClient({
      workerFactory: () => loopbackWorker(new Error("no model")),
      env: { crossOriginIsolated: false, hardwareConcurrency: 1 },
    });
    expect(await bad.init()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no model"),
    });
    expect(bad.state).toBe("failed");

    const none = createPaddleClient({
      workerFactory: () => {
        throw new Error("Worker is not defined");
      },
      env: { crossOriginIsolated: false, hardwareConcurrency: 1 },
    });
    expect(await none.init()).toMatchObject({ ok: false });
    expect(none.state).toBe("failed");
  });

  it("a worker that never answers is reported failed after the timeout", async () => {
    vi.useFakeTimers();
    const silent: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
      postMessage: () => undefined,
    };
    const c = createPaddleClient({
      workerFactory: () => silent,
      initTimeoutMs: 5000,
      env: { crossOriginIsolated: true, hardwareConcurrency: 4 },
    });
    const p = c.init();
    await vi.advanceTimersByTimeAsync(5001);
    expect(await p).toMatchObject({ ok: false, reason: "init_timeout" });
    expect(c.state).toBe("failed");
  });

  it("a worker error event fails pending calls without throwing", async () => {
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
      postMessage: () => undefined,
    };
    const c = createPaddleClient({ workerFactory: () => w, initTimeoutMs: 60_000 });
    const p = c.init();
    w.onerror?.({ message: "boom" });
    expect(await p).toMatchObject({ ok: false });
    expect(c.state).toBe("failed");
  });
});

describe("S7-05 Tesseract fallback wrapper", () => {
  const word = (text: string, y0: number, y1: number) => ({ text, bbox: { y0, y1 } });
  const res = (text: string, words: ReturnType<typeof word>[], confidence = 61) => ({
    data: { text, confidence, blocks: [{ paragraphs: [{ lines: [{ words }] }] }] },
  });

  it("glyph px = median word-box height of words with >= 2 alphanumerics", () => {
    expect(
      glyphPx(
        res("x", [word("SOR", 0, 30), word("229/252", 0, 34), word("•", 0, 90), word("R", 0, 70)])
      )
    ).toBe(34); // sorted [30, 34] -> index 1
    expect(glyphPx(res("x", [word("•", 0, 9)]))).toBeNull();
  });

  it("is lazy: nothing loads until ensure(); read before that is not_ready", async () => {
    const loadTesseract = vi.fn();
    const r = createFallbackReader({ loadTesseract, now: () => 0 });
    expect(r.started).toBe(false);
    expect(await r.read({})).toEqual({ ok: false, reason: "not_ready" });
    expect(loadTesseract).not.toHaveBeenCalled();
  });

  it("ensure() creates the worker with the vendored paths and the PSM 7 whitelist; read sets only what changed", async () => {
    const calls: string[] = [];
    const worker: TessWorker = {
      setParameters: vi.fn(async (p) => void calls.push(JSON.stringify(p))),
      recognize: vi.fn(async () => res("SOR EN R 229/252\n", [word("SOR", 0, 30)])),
    };
    const createWorker = vi.fn(async () => worker);
    const r = createFallbackReader({
      loadTesseract: async () => ({ createWorker }),
      now: () => 0,
    });
    expect(await r.ensure()).toMatchObject({ ok: true });
    expect(await r.ensure()).toMatchObject({ ok: true });
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledWith("eng", 1, {
      workerPath: "/vendor/scan/worker.min.js",
      corePath: "/vendor/scan/core",
      langPath: "/vendor/scan/lang",
      workerBlobURL: false,
      gzip: true,
    });
    expect(calls[0]).toContain('"tessedit_pageseg_mode":"7"');
    expect(calls[0]).toContain("user_defined_dpi");
    const a = await r.read({}, { psm: 6 });
    expect(a).toMatchObject({ ok: true, text: "SOR EN R 229/252", psm: 6, glyph_px: 30 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('{"tessedit_pageseg_mode":"6"}');
    await r.read({}, { psm: 6 });
    expect(calls).toHaveLength(2); // unchanged parameters are not re-sent
    await r.read({}, { whitelist: "0123456789/T" });
    // the default PSM (7) is restored in the same call, as in the spike
    expect(calls[2]).toBe('{"tessedit_char_whitelist":"0123456789/T","tessedit_pageseg_mode":"7"}');
  });

  it("a load failure is {ok:false}, never a throw, and can be retried", async () => {
    const loadTesseract = vi.fn(async () => {
      throw new Error("tesseract failed to load");
    });
    const r = createFallbackReader({ loadTesseract, now: () => 0 });
    expect(await r.ensure()).toMatchObject({ ok: false });
    await r.ensure();
    expect(loadTesseract).toHaveBeenCalledTimes(2);
  });
});
