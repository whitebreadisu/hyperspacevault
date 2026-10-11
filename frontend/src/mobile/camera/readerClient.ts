import { VENDOR_BASE } from "./readerAssets";
import type { Failure, InitOk, PaddleRead, WorkerRequest, WorkerResponse } from "./readerCore";

// BL-253 S7-05: the UI thread's handle on the reader worker. Frames travel as
// transferable ImageBitmaps and the UI never waits on OCR (`read` is a promise
// the scan loop awaits off the render path). Nothing here throws into the UI:
// a dead worker, a failed init or a failed read all resolve `{ok: false,
// reason}` and the camera shows the keypad prefilled (S7-16).

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export type ClientInit = (InitOk | Failure) & { total_ms?: number };

export interface PaddleClient {
  /** Starts the worker and the engine; memoised. Never rejects. */
  init(): Promise<ClientInit>;
  read(frame: ImageBitmap | ImageData): Promise<PaddleRead | Failure>;
  dispose(): void;
  readonly state: "idle" | "loading" | "ready" | "failed";
}

export interface ClientOptions {
  workerFactory?: () => WorkerLike;
  /** Absolute URL of the vendored paddle/ folder. */
  base?: string;
  env?: { crossOriginIsolated: boolean; hardwareConcurrency: number | null };
  /** How long init may take before it is reported as failed (default 60 s). */
  initTimeoutMs?: number;
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL("./paddleWorker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
}

const errText = (e: unknown) => String((e as Error)?.message ?? e);

export function createPaddleClient(opts: ClientOptions = {}): PaddleClient {
  let worker: WorkerLike | null = null;
  let seq = 0;
  let state: PaddleClient["state"] = "idle";
  let initP: Promise<ClientInit> | null = null;
  const pending = new Map<number, (r: WorkerResponse) => void>();

  function failAll(reason: string) {
    state = "failed";
    for (const [id, resolve] of pending) resolve({ type: "read", id, ok: false, reason });
    pending.clear();
  }

  function ensureWorker(): WorkerLike | null {
    if (worker) return worker;
    try {
      worker = (opts.workerFactory ?? defaultWorker)();
    } catch (e) {
      failAll("worker_unavailable: " + errText(e));
      return null;
    }
    worker.onmessage = (e) => {
      const res = e.data as WorkerResponse;
      const resolve = pending.get(res.id);
      if (resolve) {
        pending.delete(res.id);
        resolve(res);
      }
    };
    worker.onerror = (e) => {
      const m = (e as { message?: string })?.message;
      failAll("worker_error" + (m ? ": " + m : ""));
    };
    return worker;
  }

  function call(req: WorkerRequest, transfer?: Transferable[]): Promise<WorkerResponse> {
    const fail = (reason: string) =>
      ({ type: req.type, id: req.id, ok: false, reason }) as WorkerResponse;
    const w = ensureWorker();
    if (!w) return Promise.resolve(fail("worker_unavailable"));
    return new Promise((resolve) => {
      pending.set(req.id, resolve);
      try {
        w.postMessage(req, transfer);
      } catch (e) {
        pending.delete(req.id);
        resolve(fail("post_failed: " + errText(e)));
      }
    });
  }

  return {
    get state() {
      return state;
    },
    init() {
      if (initP) return initP;
      state = "loading";
      const base = opts.base ?? new URL(VENDOR_BASE + "paddle/", location.href).href;
      const env = opts.env ?? {
        crossOriginIsolated: !!globalThis.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
      };
      const t0 = performance.now();
      // A worker the browser refuses to start (e.g. a worker script without the
      // COEP header under the isolated document) fires no error event and never
      // answers: bound the wait so the camera can fall back to the keypad.
      const id = ++seq;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<WorkerResponse>((resolve) => {
        timer = setTimeout(
          () => resolve({ type: "init", id, ok: false, reason: "init_timeout" }),
          opts.initTimeoutMs ?? 60_000
        );
      });
      initP = Promise.race([call({ type: "init", id, base, ...env }), timeout]).then((res) => {
        clearTimeout(timer);
        const out = res as ClientInit;
        if (out.ok) state = "ready";
        else {
          state = "failed";
          initP = null;
        }
        return { ...out, total_ms: Math.round(performance.now() - t0) };
      });
      return initP;
    },
    async read(frame) {
      if (state !== "ready") return { ok: false, reason: "not_ready" };
      const transfer: Transferable[] =
        typeof ImageBitmap !== "undefined" && frame instanceof ImageBitmap ? [frame] : [];
      return (await call({ type: "read", id: ++seq, frame }, transfer)) as PaddleRead | Failure;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      initP = null;
      failAll("disposed");
      state = "idle";
    },
  };
}
