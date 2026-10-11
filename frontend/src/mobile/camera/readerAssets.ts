// BL-253 S7-04: the vendored reader payload (plan A12), plain git under
// frontend/public/vendor/scan/ -- copied from the BL-238 spike, never rebuilt.
// Nothing here is requested until the camera needs it: the Paddle group when
// the reader starts, the Tesseract group only on the first fallback need (the
// spike loaded Tesseract at boot, app.js:1364 -- a deliberate change).

export const VENDOR_BASE = "/vendor/scan/";

/** Paddle: bundle + det/rec models + dictionary + the onnxruntime-web WASM. */
export const PADDLE_ASSETS = [
  "paddle/paddle-bundle.min.js",
  "paddle/models/PP-OCRv6_tiny_det.ort",
  "paddle/models/PP-OCRv6_tiny_rec.ort",
  "paddle/models/ppocrv6_tiny_dict.txt",
  "paddle/ort/ort-wasm-simd-threaded.mjs",
  "paddle/ort/ort-wasm-simd-threaded.wasm",
] as const;

/** Tesseract (fallback): loader, worker, the three cores (tesseract.js picks
 * one by the browser's SIMD support) and the English model. */
export const TESSERACT_ASSETS = [
  "tesseract.min.js",
  "worker.min.js",
  "core/tesseract-core-lstm.wasm.js",
  "core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "core/tesseract-core-simd-lstm.wasm.js",
  "lang/eng.traineddata.gz",
] as const;

/** Licence texts and the notices file that ship beside the payload. */
export const LICENCE_FILES = [
  "paddle/LICENSE-ppu-paddle-ocr.txt",
  "LICENSE-tesseract.js.txt",
  "core/LICENSE-tesseract.js-core.txt",
] as const;
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";

export interface ReaderAssetList {
  paddle: string[];
  tesseract: string[];
}

/** The files the reader may request, by group, as site paths. */
export function readerAssets(): ReaderAssetList {
  return {
    paddle: PADDLE_ASSETS.map((f) => VENDOR_BASE + f),
    tesseract: TESSERACT_ASSETS.map((f) => VENDOR_BASE + f),
  };
}
