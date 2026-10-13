import { resolve } from "node:path";
import { test as base } from "./helpers";
import { hideEmulatorBanner } from "./helpers";
import { installApiMocks } from "./mock-api";
import type { CardsFixture } from "./mock-api";

// BL-253 S7-19: the fake-camera harness. The BL-238 spike's smoke_test.js ran
// Chromium with `--use-fake-device-for-media-stream
// --use-file-for-fake-video-capture=<clip>.mjpeg`; those are LAUNCH flags, so
// each clip gets its own browser (one per test). The real getUserMedia, the
// real frame pipeline, the real Paddle worker and the real scan core all run
// -- nothing on window.__scan is replaced (7b's canvas stream + scripted
// reader remain for the specs that do not name a clip). Chromium only: WebKit
// has no fake camera (smoke_test.js:128).

export const CLIP_DIR = resolve("e2e/mobile/clips");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const PORTRAIT = { width: 390, height: 844 };
export const LANDSCAPE = { width: 844, height: 390 };
/** A small phone on its side. Both landscape sizes are the phone app behind
 * the rotate screen (BL-257 FR5-06: the gate is a narrow viewport OR a
 * touch-primary device whose screen's short side is <= 500 px; the harness
 * reports the screen at the viewport's size). */
export const LANDSCAPE_PHONE = { width: 667, height: 375 };

export const clipPath = (name: string) => resolve(CLIP_DIR, `${name}.mjpeg`);

declare global {
  interface Window {
    /** OCR calls the real readers received (counted by countReads). */
    __ocrCalls?: { paddle: number; tesseract: number };
  }
}

export const test = base.extend<{
  clip: string;
  clipViewport: { width: number; height: number };
  cardsFixture: CardsFixture;
}>({
  clip: ["fake_v2_std", { option: true }],
  clipViewport: [PORTRAIT, { option: true }],
  cardsFixture: ["base-cards-scan", { option: true }],
  page: async ({ playwright, baseURL, clip, clipViewport, cardsFixture }, provide) => {
    const browser = await playwright.chromium.launch({
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${clipPath(clip)}`,
      ],
    });
    const context = await browser.newContext({
      baseURL,
      viewport: clipViewport,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: IPHONE_UA,
      storageState: "e2e/.auth/phone.json",
      permissions: ["camera"],
    });
    const page = await context.newPage();
    await installApiMocks(page, { fixture: cardsFixture });
    await page.addInitScript(hideEmulatorBanner);
    await countReads(page);
    await provide(page);
    await context.close();
    await browser.close();
  },
});

/** Count what the REAL readers are asked to read (wraps `read`, replaces
 * nothing): window.__ocrCalls = { paddle, tesseract }. */
async function countReads(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.__ocrCalls = { paddle: 0, tesseract: 0 };
    let real: Record<string, { read: (...a: unknown[]) => unknown }> | undefined;
    Object.defineProperty(window, "__scan", {
      configurable: true,
      get: () => real,
      set: (v: Record<string, { read: (...a: unknown[]) => unknown }>) => {
        for (const [k, key] of [
          ["reader", "paddle"],
          ["fallback", "tesseract"],
        ] as const) {
          const obj = v[k];
          const orig = obj.read.bind(obj);
          obj.read = (...a: unknown[]) => {
            window.__ocrCalls![key]++;
            return orig(...a);
          };
        }
        real = v;
      },
    });
  });
}
