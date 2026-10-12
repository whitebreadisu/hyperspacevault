/* global process, console, document, Image */
// BL-257 FR3-01: measures each set logo's opaque artwork (its alpha bounding
// box) so the phone can centre and size the ARTWORK, not the PNG's box. The
// PNGs under public/images/set_*.png are never edited -- this only reads them.
//
// Usage (from frontend/):  node scripts/measure-set-logos.mjs
// Prints one row per base set: the PNG's pixel size, the artwork box as
// fractions of the PNG (left, top, width, height), the artwork's aspect and
// its ink coverage (opaque pixels / artwork-box pixels). Paste the trims into
// SET_LOGO_ART in src/mobile/setLogoArt.ts when a logo is added or replaced.
//
// No dependency of its own: the pixels are read through the Playwright
// browser's canvas (@playwright/test is already a devDependency).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/** A pixel counts as artwork from this alpha up (of 255): keeps soft glows
 * and anti-aliased edges out of the box. */
const ALPHA_MIN = 24;

const dir = join(process.cwd(), "public", "images");
const files = readdirSync(dir).filter((f) => /^set_[A-Z0-9]+\.png$/.test(f));

const browser = await chromium.launch();
const page = await browser.newPage();
const out = {};
for (const f of files) {
  const code = f.slice(4, -4);
  const b64 = readFileSync(join(dir, f)).toString("base64");
  out[code] = await page.evaluate(
    async ({ b64, min }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, w, h).data;
      let x0 = w;
      let y0 = h;
      let x1 = -1;
      let y1 = -1;
      let ink = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (d[(y * w + x) * 4 + 3] >= min) {
            ink++;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      const aw = x1 - x0 + 1;
      const ah = y1 - y0 + 1;
      const r = (n) => Math.round(n * 10000) / 10000;
      return {
        w,
        h,
        l: r(x0 / w),
        t: r(y0 / h),
        aw: r(aw / w),
        ah: r(ah / h),
        aspect: r(aw / ah),
        ink: r(ink / (aw * ah)),
      };
    },
    { b64, min: ALPHA_MIN }
  );
}
await browser.close();

for (const [code, m] of Object.entries(out))
  console.log(
    `${code.padEnd(5)} { w: ${m.w}, h: ${m.h}, l: ${m.l}, t: ${m.t}, aw: ${m.aw}, ah: ${m.ah} }, // art ${m.aspect}:1, ink ${m.ink}`
  );
