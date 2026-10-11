import { ortThreads } from "./isolationReport";

// BL-253 S7-05: the Paddle reader's message protocol and result rules -- the
// part of paddle-reader.js (spike v0.5.5) that is logic rather than plumbing,
// kept free of Worker / DOM so it is unit-testable with a stub engine. The
// worker (paddleWorker.ts) wires it to onnxruntime-web + ppu-paddle-ocr; the
// client (readerClient.ts) wires it to the UI thread. Errors never throw into
// the UI: every response is `{ok: true, ...}` or `{ok: false, reason}`.

/** Paddle's box height is ~1.4 x the cap height (smoke-test calibration:
 * 14 px and 34 px synthetic strips at 1100 px width). paddle-reader.js:10. */
export const BOX_PAD_FACTOR = 1.4;

export interface PaddleRead {
  ok: true;
  /** Upper-cased, newlines -> space, trimmed. */
  text: string;
  /** 0-100, one decimal; null when the engine reported none. */
  confidence: number | null;
  ms: number;
  box_count: number;
  /** Median box height, processed px; null when no box. */
  box_h: number | null;
  /** round(box_h / 1.4) -- the glyph height the floor of 22 compares. */
  glyph_px: number | null;
}

export interface Failure {
  ok: false;
  reason: string;
}

export interface InitOk {
  ok: true;
  loadMs: number;
  threads: number;
  crossOriginIsolated: boolean;
}

/** What the engine (ppu-paddle-ocr's PaddleOcrService) returns. */
export interface EngineResult {
  text?: string;
  confidence?: number | null;
  lines?: ({ box?: { height?: number } } | null)[][];
}

export interface PaddleEngine {
  recognize(surface: unknown, opts: { noCache: boolean }): Promise<EngineResult>;
}

export type InitRequest = {
  type: "init";
  id: number;
  /** Absolute URL of the vendored paddle/ folder (trailing slash). */
  base: string;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number | null;
};
export type ReadRequest = { type: "read"; id: number; frame: unknown };
export type WorkerRequest = InitRequest | ReadRequest;

export type InitResponse = { type: "init"; id: number } & (InitOk | Failure);
export type ReadResponse = { type: "read"; id: number } & (PaddleRead | Failure);
export type WorkerResponse = InitResponse | ReadResponse;

/** paddle-reader.js:43-52 -- the result summary. */
export function summariseRead(res: EngineResult, ms: number): PaddleRead {
  const hs: number[] = [];
  for (const line of res.lines || [])
    for (const it of line || [])
      if (it && it.box && it.box.height) hs.push(Math.round(it.box.height));
  hs.sort((a, b) => a - b);
  return {
    ok: true,
    text: String(res.text || "")
      .replace(/\n+/g, " ")
      .trim()
      .toUpperCase(),
    confidence: res.confidence != null ? Math.round(res.confidence * 1000) / 10 : null,
    ms: Math.round(ms),
    box_count: hs.length,
    box_h: hs.length ? hs[hs.length >> 1] : null,
    glyph_px: hs.length ? Math.round(hs[hs.length >> 1] / BOX_PAD_FACTOR) : null,
  };
}

export interface HandlerDeps {
  /** Loads the bundle, points ort at its WASM, builds + initialises the
   * service. May throw; the handler turns that into `{ok: false}`. */
  loadEngine(base: string, threads: number): Promise<PaddleEngine>;
  /** A frame (ImageBitmap | ImageData) -> whatever the engine reads. */
  toSurface(frame: unknown): unknown;
  now(): number;
}

const message = (e: unknown) => String((e && (e as Error).message) || e);

/** The worker's brain: one request in, one response out, never throws. */
export function createReaderHandler(deps: HandlerDeps) {
  let engine: PaddleEngine | null = null;
  let initP: Promise<InitResponse> | null = null;

  async function init(req: InitRequest): Promise<InitResponse> {
    const ts = deps.now();
    const threads = ortThreads(req.crossOriginIsolated, req.hardwareConcurrency);
    try {
      engine = await deps.loadEngine(req.base, threads);
      return {
        type: "init",
        id: req.id,
        ok: true,
        loadMs: Math.round(deps.now() - ts),
        threads,
        crossOriginIsolated: req.crossOriginIsolated,
      };
    } catch (e) {
      engine = null;
      return { type: "init", id: req.id, ok: false, reason: "init_failed: " + message(e) };
    }
  }

  async function read(req: ReadRequest): Promise<ReadResponse> {
    if (!engine) return { type: "read", id: req.id, ok: false, reason: "not_ready" };
    const ts = deps.now();
    try {
      const res = await engine.recognize(deps.toSurface(req.frame), { noCache: true });
      return { type: "read", id: req.id, ...summariseRead(res, deps.now() - ts) };
    } catch (e) {
      return { type: "read", id: req.id, ok: false, reason: "read_failed: " + message(e) };
    }
  }

  return function handle(req: WorkerRequest): Promise<WorkerResponse> {
    if (req.type === "read") return read(req);
    // One init in flight / done; a failed init may be retried.
    if (!initP) {
      initP = init(req).then((r) => {
        if (!r.ok) initP = null;
        return r;
      });
    }
    return initP.then((r) => ({ ...r, id: req.id }));
  };
}
