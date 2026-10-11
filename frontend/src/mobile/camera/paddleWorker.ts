/// <reference lib="webworker" />
import { createReaderHandler } from "./readerCore";
import type { EngineResult, PaddleEngine, WorkerRequest } from "./readerCore";

// BL-253 S7-05: the Paddle reader as a module worker -- onnxruntime-web and
// ppu-paddle-ocr run here, never on the UI thread (paddle-reader.js -> worker).
// The vendored bundle (public/vendor/scan/paddle/paddle-bundle.min.js, copied
// from the spike, never rebuilt) is an IIFE that ends `window.BL238Paddle = ...`,
// and a worker has no `window`; so `self` stands in for it and the bundle is
// loaded with a dynamic import (a module worker has no importScripts). Where
// the bundle asks for `document` it already falls back to OffscreenCanvas
// (`typeof document < "u" ? ... : new OffscreenCanvas(...)`), so no DOM shim.

interface PaddleBundle {
  ort: { env: { wasm: { wasmPaths: string; numThreads: number } } };
  PaddleOcrService: new (cfg: unknown) => PaddleEngine & { initialize(): Promise<void> };
}

const scope = self as unknown as DedicatedWorkerGlobalScope & {
  window?: unknown;
  BL238Paddle?: PaddleBundle;
};

async function loadEngine(base: string, threads: number): Promise<PaddleEngine> {
  scope.window = scope;
  await import(/* @vite-ignore */ base + "paddle-bundle.min.js");
  const P = scope.BL238Paddle;
  if (!P) throw new Error("paddle bundle did not register");
  P.ort.env.wasm.wasmPaths = base + "ort/";
  P.ort.env.wasm.numThreads = threads;
  const service = new P.PaddleOcrService({
    model: {
      detection: base + "models/PP-OCRv6_tiny_det.ort",
      recognition: base + "models/PP-OCRv6_tiny_rec.ort",
      charactersDictionary: base + "models/ppocrv6_tiny_dict.txt",
    },
    session: { executionProviders: ["wasm"] },
  });
  await service.initialize();
  return {
    recognize: (surface, opts): Promise<EngineResult> => service.recognize(surface, opts),
  };
}

/** ImageBitmap | ImageData -> an OffscreenCanvas the engine reads. */
function toSurface(frame: unknown): OffscreenCanvas {
  if (typeof ImageData !== "undefined" && frame instanceof ImageData) {
    const c = new OffscreenCanvas(frame.width, frame.height);
    c.getContext("2d")!.putImageData(frame, 0, 0);
    return c;
  }
  const bmp = frame as ImageBitmap;
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

const handle = createReaderHandler({ loadEngine, toSurface, now: () => performance.now() });

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  void handle(e.data).then((res) => scope.postMessage(res));
};
