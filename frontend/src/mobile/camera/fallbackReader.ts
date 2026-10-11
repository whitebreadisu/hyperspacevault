import { VENDOR_BASE } from "./readerAssets";
import type { Failure } from "./readerCore";

// BL-253 S7-05: the Tesseract fallback reader (spike app.js:53-91), wrapped.
// Tesseract.js runs its own worker, so this stays a UI-thread wrapper around
// `window.Tesseract`. Loaded LAZILY: nothing under vendor/scan/ for Tesseract
// is requested until the first fallback need calls `ensure()` (the spike
// loaded it at boot, app.js:1364 -- a deliberate change, S7-04).

/** app.js:53 -- the character whitelist of the full-strip passes. */
export const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/•.- ";

export interface FallbackRead {
  ok: true;
  text: string;
  confidence: number | null;
  ms: number;
  /** Median word-box height of words with >= 2 alphanumerics, processed px. */
  glyph_px: number | null;
  psm: number;
}

export interface FallbackOptions {
  whitelist?: string;
  psm?: number;
}

interface TessWord {
  text?: string;
  bbox?: { y0: number; y1: number };
}
interface TessResult {
  data: {
    text?: string;
    confidence?: number;
    blocks?: { paragraphs?: { lines?: { words?: TessWord[] }[] }[] }[];
  };
}
export interface TessWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(
    img: unknown,
    opts: object,
    output: { text: boolean; blocks: boolean }
  ): Promise<TessResult>;
}
interface TessGlobal {
  createWorker(
    lang: string,
    oem: number,
    opts: {
      workerPath: string;
      corePath: string;
      langPath: string;
      workerBlobURL: boolean;
      gzip: boolean;
    }
  ): Promise<TessWorker>;
}

export interface FallbackDeps {
  /** Loads tesseract.min.js and returns window.Tesseract. */
  loadTesseract(): Promise<TessGlobal>;
  now(): number;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = src;
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error("tesseract failed to load"));
    document.head.appendChild(sc);
  });
}

const defaultDeps: FallbackDeps = {
  async loadTesseract() {
    await loadScript(VENDOR_BASE + "tesseract.min.js");
    return (window as unknown as { Tesseract: TessGlobal }).Tesseract;
  },
  now: () => performance.now(),
};

/** app.js:79-84 -- median word-box height (processed px). */
export function glyphPx(res: TessResult): number | null {
  const hs: number[] = [];
  (res.data.blocks || []).forEach((b) =>
    (b.paragraphs || []).forEach((pg) =>
      (pg.lines || []).forEach((l) =>
        (l.words || []).forEach((w) => {
          if (w.bbox && ((w.text || "").match(/[A-Z0-9]/g) || []).length >= 2)
            hs.push(w.bbox.y1 - w.bbox.y0);
        })
      )
    )
  );
  hs.sort((a, b) => a - b);
  return hs.length ? hs[hs.length >> 1] : null;
}

export interface FallbackReader {
  /** First call loads Tesseract + the English model; memoised. Never rejects. */
  ensure(): Promise<{ ok: true; loadMs: number } | Failure>;
  read(canvas: unknown, opts?: FallbackOptions): Promise<FallbackRead | Failure>;
  readonly started: boolean;
}

export function createFallbackReader(deps: FallbackDeps = defaultDeps): FallbackReader {
  let worker: TessWorker | null = null;
  let started = false;
  let initP: Promise<{ ok: true; loadMs: number } | Failure> | null = null;
  let curWhitelist: string | null = null;
  let curPsm = "7";

  return {
    get started() {
      return started;
    },
    ensure() {
      if (initP) return initP;
      started = true;
      const ts = deps.now();
      initP = deps
        .loadTesseract()
        .then((T) =>
          T.createWorker("eng", 1, {
            workerPath: VENDOR_BASE + "worker.min.js",
            corePath: VENDOR_BASE + "core",
            langPath: VENDOR_BASE + "lang",
            workerBlobURL: false,
            gzip: true,
          })
        )
        .then((w) => {
          worker = w;
          return w.setParameters({
            tessedit_pageseg_mode: "7",
            tessedit_char_whitelist: WHITELIST,
            user_defined_dpi: "300",
          });
        })
        .then((): { ok: true; loadMs: number } => {
          curWhitelist = WHITELIST;
          curPsm = "7";
          return { ok: true, loadMs: Math.round(deps.now() - ts) };
        })
        .catch((e): Failure => {
          worker = null;
          initP = null;
          return { ok: false, reason: "init_failed: " + String((e as Error)?.message ?? e) };
        });
      return initP;
    },
    async read(canvas, opts) {
      if (!worker) return { ok: false, reason: "not_ready" };
      const w = worker;
      const wl = opts?.whitelist ?? WHITELIST;
      const psm = String(opts?.psm ?? 7);
      const ts = deps.now();
      try {
        const prm: Record<string, string> = {};
        if (wl !== curWhitelist) {
          prm.tessedit_char_whitelist = wl;
          curWhitelist = wl;
        }
        if (psm !== curPsm) {
          prm.tessedit_pageseg_mode = psm;
          curPsm = psm;
        }
        if (Object.keys(prm).length) await w.setParameters(prm);
        const res = await w.recognize(canvas, {}, { text: true, blocks: true });
        return {
          ok: true,
          text: (res.data.text || "").replace(/\n+/g, " ").trim(),
          confidence: res.data.confidence ?? null,
          ms: Math.round(deps.now() - ts),
          glyph_px: glyphPx(res),
          psm: +psm,
        };
      } catch (e) {
        return { ok: false, reason: "read_failed: " + String((e as Error)?.message ?? e) };
      }
    },
  };
}
