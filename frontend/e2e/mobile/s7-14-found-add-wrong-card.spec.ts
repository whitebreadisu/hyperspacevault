import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera, SOR_229 } from "./scan-helpers";

// S7-14: recognise-then-prompt in the keypad's resolved-card panel. SOR 229
// -> Cell Block Guard with the strip (green dot, "Read", the mono key, Wrong
// card) over the keypad's panel (name, set + number + printing, the In vault
// / After add readout, Card details / Add). Nothing is counted until Add; Add
// -> Verify · 1 and the hold; Card details opens the card layer over the
// paused camera and returns to the same prompt; Wrong card restarts the scan
// with the batch unchanged and no keypad prefill.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);

test("s7-14-found-add-wrong-card", async ({ page }) => {
  await installFakeScanner(page, { read: SOR_229 });
  await openScanCamera(page);
  const cam = page.locator(".m-cam");
  const panel = page.locator(".m-cam__panel");
  const badge = page.locator(".m-cam__bar .m-logbtn");
  await expect(cam).toHaveAttribute("data-phase", "found");
  await expect(panel.locator(".m-cam__state")).toContainText("Read");
  await expect(panel.locator(".m-cam__code")).toHaveText("SOR 229/252");
  await expect(panel.locator(".m-ident__name")).toHaveText("Cell Block Guard");
  await expect(panel.locator(".m-ident__meta")).toHaveText("SOR 229 · Standard");
  await expect(panel.locator(".m-readout")).toContainText("In vault");
  await expect(panel.locator(".m-ident__details")).toBeVisible();
  await expect(panel.locator(".m-cam__wrong")).toHaveText("Wrong card");
  await expect(page.locator(".m-guide__box--read")).toHaveCount(1);
  await expect(badge).toHaveClass(/m-logbtn--empty/); // nothing counted yet

  // Card details: the card layer over the paused camera; back -> same prompt.
  await panel.locator(".m-ident__details").click();
  await expect(page).toHaveURL(/\/scan\/#\/card\/\d+\?v=\d+$/);
  await expect(page.locator(".m-cardlayer")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".m-cardlayer")).toHaveCount(0);
  await expect(cam).toHaveAttribute("data-phase", "found");

  // Add: one copy, then the hold.
  await page.evaluate(() => {
    window.__fakeRead = null; // the card leaves the frame
  });
  await panel.locator(".m-ident__add .swu-btn").click();
  await expect(badge.locator(".m-logbtn__n")).toHaveText("1");
  await expect(cam).toHaveAttribute("data-phase", "hold");
  await expect(cam).toHaveAttribute("data-phase", "searching", { timeout: 3000 });

  // Another card -> Wrong card: the scan restarts; the batch is unchanged.
  await page.evaluate(() => {
    window.__fakeRead = "SOR • EN C 87/252";
  });
  await expect(cam).toHaveAttribute("data-phase", "found");
  await expect(panel.locator(".m-cam__code")).toHaveText("SOR 87/252");
  await panel.locator(".m-cam__wrong").click();
  await expect(cam).toHaveAttribute("data-phase", "searching");
  await expect(page).toHaveURL(/\/scan\/#\/camera$/); // no keypad prefill
  await expect(badge.locator(".m-logbtn__n")).toHaveText("1");
});
