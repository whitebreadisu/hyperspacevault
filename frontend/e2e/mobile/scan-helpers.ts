import type { Page } from "@playwright/test";
import { expect } from "./helpers";

// BL-253 stage 7b: drive the camera screen WITHOUT the fake-camera clips
// (the clip specs are stage 7c's, s7-19+ with clip-helpers.ts): the page's getUserMedia returns a canvas
// stream (sharp noise, or flat grey = blurry), and the Paddle / Tesseract
// readers on `window.__scan` are replaced by a scripted reader that returns
// `window.__fakeRead` (the strip text the "camera" shows). The real frame
// pipeline, sharpness gate, scan core, Acceptor, decision flow, batch and
// analytics all run; only the pixels and the OCR are stand-ins.

declare global {
  interface Window {
    __fakeCam?: { mode: "sharp" | "blur" | "none" | "deny" };
    __fakeRead?: string | null;
    __reads?: number;
    __tessReads?: number;
  }
}

/** Install the canvas camera + the scripted reader (before any navigation). */
export async function installFakeScanner(
  page: Page,
  opts: { mode?: "sharp" | "blur" | "none" | "deny"; read?: string | null } = {}
) {
  await page.addInitScript(
    ({ mode, read }) => {
      window.__fakeCam = { mode };
      window.__fakeRead = read;
      window.__reads = 0;
      window.__tessReads = 0;
      const W = 1080;
      const H = 1920;
      let canvas: HTMLCanvasElement | null = null;
      let noise: ImageData | null = null;
      let tick = 0;
      const paint = () => {
        if (!canvas) return;
        const g = canvas.getContext("2d")!;
        if (window.__fakeCam?.mode === "blur") {
          g.fillStyle = "#808080";
          g.fillRect(0, 0, W, H);
        } else {
          if (!noise) {
            noise = g.createImageData(W, H);
            for (let i = 0; i < noise.data.length; i += 4) {
              const v = Math.random() < 0.5 ? 0 : 255;
              noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
              noise.data[i + 3] = 255;
            }
          }
          g.putImageData(noise, 0, 0);
        }
        // A changing corner keeps the stream producing frames.
        g.fillStyle = tick++ % 2 ? "#000" : "#fff";
        g.fillRect(0, 0, 4, 4);
      };
      const md = navigator.mediaDevices;
      if (md) {
        md.getUserMedia = async () => {
          const m = window.__fakeCam?.mode;
          if (m === "none") throw Object.assign(new Error("none"), { name: "NotFoundError" });
          if (m === "deny") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
          canvas = document.createElement("canvas");
          canvas.width = W;
          canvas.height = H;
          paint();
          setInterval(paint, 50);
          return canvas.captureStream(20);
        };
      }
      // The scripted reader: replace the readers the scanner document boots.
      let real: Record<string, unknown> | undefined;
      Object.defineProperty(window, "__scan", {
        configurable: true,
        get: () => real,
        set: (v: Record<string, unknown>) => {
          v.reader = {
            state: "ready",
            init: async () => ({ ok: true, loadMs: 1, threads: 1, crossOriginIsolated: true }),
            read: async (frame: { close?: () => void }) => {
              frame?.close?.();
              window.__reads = (window.__reads ?? 0) + 1;
              const t = window.__fakeRead;
              // ~Paddle's phone timing (Results: ~260 ms). Faster stub reads
              // would starve the Acceptor's strong-key rule (2 reads >= 150 ms
              // apart), which IS live on the trimmed e2e catalogue: its keys
              // have no one-digit neighbours, unlike the real catalogue's.
              await new Promise((r) => setTimeout(r, 200));
              return t
                ? {
                    ok: true,
                    text: t,
                    confidence: 92,
                    ms: 200,
                    box_count: 1,
                    box_h: 42,
                    glyph_px: 30,
                  }
                : {
                    ok: true,
                    text: "",
                    confidence: null,
                    ms: 15,
                    box_count: 0,
                    box_h: null,
                    glyph_px: null,
                  };
            },
            dispose: () => {},
          };
          v.fallback = {
            started: false,
            ensure: async () => ({ ok: true, loadMs: 0 }),
            read: async () => {
              window.__tessReads = (window.__tessReads ?? 0) + 1;
              return { ok: true, text: "", confidence: 0, ms: 5, glyph_px: null, psm: 6 };
            },
          };
          real = v;
        },
      });
    },
    { mode: opts.mode ?? "sharp", read: opts.read ?? null }
  );
}

/** SOR 229 as the strip prints it. The scanner specs run on the
 * `base-cards-scan` catalogue (scan-fixture.ts), whose SOR main size is the
 * real 252, so the denominator validates. */
export const SOR_229 = "SOR • EN R 229/252";

/** Open the camera in the scanner document and wait for the live preview. */
export async function openScanCamera(page: Page, hash = "#/camera") {
  await page.goto("/scan/" + hash);
  await expect(page.locator(".m-tool--camera .m-cam")).toBeVisible();
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live");
}
