/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LICENCE_FILES,
  NOTICES_FILE,
  PADDLE_ASSETS,
  TESSERACT_ASSETS,
  VENDOR_BASE,
  readerAssets,
} from "./readerAssets";

// BL-253 S7-04: the vendored payload (plan A12) is plain git under
// public/vendor/scan/. The asset list the reader may request must match the
// directory exactly, and the notices must name every licence file.

const ROOT = join("public", "vendor", "scan");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(relative(ROOT, p).split("\\").join("/"));
  }
  return out;
}

describe("S7-04 reader payload", () => {
  it("readerAssets() + licences + notices is exactly the directory", () => {
    const listed = [...PADDLE_ASSETS, ...TESSERACT_ASSETS, ...LICENCE_FILES, NOTICES_FILE].sort();
    expect(walk(ROOT).sort()).toEqual(listed);
  });

  it("maps every asset to a /vendor/scan/ site path, by group", () => {
    const a = readerAssets();
    expect(a.paddle).toHaveLength(6);
    expect(a.tesseract).toHaveLength(6);
    for (const p of [...a.paddle, ...a.tesseract]) expect(p.startsWith(VENDOR_BASE)).toBe(true);
    // Tesseract is its own group: nothing of it is in the Paddle list.
    expect(a.paddle.some((p) => /tesseract|worker\.min|eng\.traineddata/.test(p))).toBe(false);
  });

  it("the bytes are the spike's (sizes from the BL-238 vendor listing)", () => {
    const sizes: Record<string, number> = {
      "paddle/paddle-bundle.min.js": 116021,
      "paddle/models/PP-OCRv6_tiny_det.ort": 1882568,
      "paddle/models/PP-OCRv6_tiny_rec.ort": 4530048,
      "paddle/models/ppocrv6_tiny_dict.txt": 27157,
      "paddle/ort/ort-wasm-simd-threaded.mjs": 20321,
      "paddle/ort/ort-wasm-simd-threaded.wasm": 11905541,
      "tesseract.min.js": 62961,
      "worker.min.js": 111307,
      "core/tesseract-core-lstm.wasm.js": 3896484,
      "core/tesseract-core-relaxedsimd-lstm.wasm.js": 3905767,
      "core/tesseract-core-simd-lstm.wasm.js": 3899472,
      "lang/eng.traineddata.gz": 2952873,
      "paddle/LICENSE-ppu-paddle-ocr.txt": 1080,
      "LICENSE-tesseract.js.txt": 11357,
      "core/LICENSE-tesseract.js-core.txt": 11358,
    };
    for (const [f, n] of Object.entries(sizes)) expect(statSync(join(ROOT, f)).size, f).toBe(n);
  });

  it("THIRD_PARTY_NOTICES names every vendored package and licence file", () => {
    const notices = readFileSync(join(ROOT, NOTICES_FILE), "utf8");
    for (const lic of LICENCE_FILES) expect(notices, lic).toContain(lic);
    for (const name of [
      "ppu-paddle-ocr 6.6.1",
      "onnxruntime-web 1.23.2",
      "PP-OCRv6",
      "Tesseract.js",
      "eng.traineddata",
    ])
      expect(notices, name).toContain(name);
  });
});
