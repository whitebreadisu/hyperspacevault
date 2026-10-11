import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera, SOR_229 } from "./scan-helpers";

// S7-13: the read loop reaches Found within 8 s on a sharp frame whose strip
// reads SOR 229 -- agreement first (on the trimmed e2e catalogue SOR 229 has
// no one-digit neighbour, so it is a STRONG key: 2 reads >= 150 ms apart; the
// real catalogue's keys are all weak = 3 of the last 4, vitest S7-13) -- and the
// loop then pauses (no further reads while the prompt is up). Stage 7b drives
// it with the scripted reader over a canvas stream; stage 7c replaces both
// with the fake_v2_std clip and the real Paddle worker.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);

test("s7-13-reads-clip", async ({ page }) => {
  await installFakeScanner(page, { read: SOR_229 });
  await openScanCamera(page);
  const t0 = Date.now(); // the clock starts with the live preview
  await expect(page.locator(".m-cam")).toHaveAttribute("data-phase", "found", { timeout: 8000 });
  expect(Date.now() - t0).toBeLessThan(8000);
  await expect(page.locator(".m-cam__panel .m-ident__name")).toHaveText("Cell Block Guard");
  const reads = await page.evaluate(() => window.__reads ?? 0);
  expect(reads).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__reads ?? 0)).toBe(reads); // paused
});
