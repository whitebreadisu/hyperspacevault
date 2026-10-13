import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera, SOR_229 } from "./scan-helpers";

// S7-12: a blurry frame is never read -- the meter is red with Spec 24.2's
// "Blurry — move back / closer", no OCR runs, no prompt appears in 6 s
// (smoke_test.js live_blur). Stage 7b: a flat grey canvas stream stands in for
// the fake_v2_blur clip (stage 7c runs the clip). A sharp frame turns the
// meter green ("Sharp") and the reader starts reading.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);

test("s7-12-blur-guidance", async ({ page }) => {
  await installFakeScanner(page, { mode: "blur", read: SOR_229 });
  await openScanCamera(page);
  const meter = page.locator(".m-meter");
  await expect(meter).toHaveAttribute("data-band", "red");
  // PORT (BL-257 FR5-03): a blurry picture reads "Focusing…" for the first 3 s
  // after the stream starts; "Blurry" is what the meter says after it.
  await expect(page.locator(".m-cam")).toHaveAttribute("data-settle", "timeout");
  await expect(meter.locator(".m-meter__word")).toHaveText("Blurry");
  await expect(meter.locator(".m-meter__sub")).toContainText("Move back / closer");
  await expect(meter.locator("[role=status]")).toHaveAttribute(
    "aria-label",
    "Blurry — move back / closer"
  );
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => window.__reads)).toBe(0);
  await expect(page.locator(".m-cam")).toHaveAttribute("data-phase", "searching");
  await expect(page.locator(".m-cam__panel")).toHaveCount(0);
  // The fill moves by transform only.
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".m-meter__fill")!).transitionProperty
    )
  ).toBe("transform");

  // Sharp frames: green "Sharp", and reads start.
  await page.evaluate(() => {
    window.__fakeRead = null;
    window.__fakeCam!.mode = "sharp";
  });
  await expect(meter).toHaveAttribute("data-band", "green");
  await expect(meter.locator(".m-meter__word")).toHaveText("Sharp");
  await expect.poll(() => page.evaluate(() => window.__reads ?? 0)).toBeGreaterThan(0);
});
