import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera } from "./scan-helpers";

// S7-16: no read -> the keypad, prefilled where partly read. A strip with a
// code but no number never prompts (6 s), the meter shows the partial read
// ("read SOR ···") and its Keypad link opens #/pad?set=SOR; a code + number
// that matches no printing prefills both (#/pad?set=SOR&num=229) and the
// keypad resolves it. The header's keypad toggle takes the same route.
// Stage 7b: the scripted reader stands in for the fake_v2_nocode clip.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);

test("s7-16-no-read-keypad-prefill", async ({ page }) => {
  await installFakeScanner(page, { read: "SOR EN R" });
  await openScanCamera(page);
  const cam = page.locator(".m-cam");
  await expect(page.locator(".m-meter__read")).toContainText("read SOR ···");
  await page.waitForTimeout(6000);
  await expect(cam).toHaveAttribute("data-phase", "searching");
  await page.locator(".m-meter__keypad").click();
  await expect(page).toHaveURL(/\/scan\/#\/pad\?set=SOR$/);
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  await expect(page.locator(".m-padset__code")).toHaveText("SOR");

  // Back to the camera; a code + number that is no printing (no denominator):
  // the header toggle leaves with both prefilled.
  await page.evaluate(() => {
    window.__fakeRead = "SOR EN 229";
  });
  await page.locator(".m-tool__mode [aria-label='Camera mode']").click();
  await expect(cam).toHaveAttribute("data-stream", "live");
  await expect(page.locator(".m-meter__read")).toContainText("read SOR 229");
  await page.locator(".m-tool__mode [aria-label='Keypad mode']").click();
  await expect(page).toHaveURL(/\/scan\/#\/pad\?set=SOR&num=229$/);
  await expect(page.locator(".m-ident__name")).toHaveText("Cell Block Guard");
});
