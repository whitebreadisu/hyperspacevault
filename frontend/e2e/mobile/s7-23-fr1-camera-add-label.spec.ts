import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera } from "./scan-helpers";

// FR1-04 (BL-257, F-10): lives in an s7-* file because only those run in the
// `scan` project (Chromium + fake camera).
test.afterEach(measureEach);

test.describe("FR1-04 camera add label", () => {
  test.use({ cardsFixture: "base-cards-scan" });
  for (const [name, read, compact] of [
    ["plain", "SOR • EN R 229/252", false],
    ["compact (choices present)", "SOR • EN C 87/252", true],
  ] as const) {
    test(`fr1-04 camera add button reads Add to batch on one line - ${name}`, async ({ page }) => {
      test.skip(test.info().project.name !== "scan", "scan project only");
      await installFakeScanner(page, { read });
      await openScanCamera(page);
      await expect(page.locator(".m-cam")).toHaveAttribute("data-phase", "found");
      const panel = page.locator(".m-cam__panel");
      const btn = panel.locator(".m-ident__add .swu-btn");
      await expect(btn).toHaveText("Add to batch");
      if (compact) await expect(panel.locator(".m-ident--compact")).toHaveCount(1);
      const m = await btn.evaluate((b) => {
        const label = b.querySelector(".swu-btn__label") ?? b;
        const range = document.createRange();
        range.selectNodeContents(label);
        const rects = [...range.getClientRects()];
        const lineTops = new Set(rects.map((r) => Math.round(r.top)));
        const br = b.getBoundingClientRect();
        const pr = document.querySelector(".m-cam__panel")!.getBoundingClientRect();
        return {
          lines: lineTops.size,
          textW: Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)),
          btnW: br.width,
          btnRight: br.right,
          panelRight: pr.right,
          vw: innerWidth,
          docOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(m.lines).toBe(1);
      expect(m.textW).toBeLessThanOrEqual(m.btnW);
      expect(m.btnRight).toBeLessThanOrEqual(m.panelRight + 0.5);
      expect(m.panelRight).toBeLessThanOrEqual(m.vw);
      expect(m.docOverflow).toBe(false);
    });
  }
});
