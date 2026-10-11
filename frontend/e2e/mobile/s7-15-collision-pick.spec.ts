import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera } from "./scan-helpers";

// S7-15: a printed-code collision is an amber pick, never auto-resolved --
// "ASHP 16" is printed on two promos (the spike catalogue: Grogu P26 16 "SS
// Top 8" and Emperor's Messenger ASHP 16 "Weekly Play"). Amber panel, "Two
// cards" + the key, the question, one row per card with its program name;
// a pick resolves (the cue) and lands in the keypad's panel; Add -> a batch
// row. Stage 7b: the scripted reader stands in for the fake_v2_promo clip.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);

test("s7-15-collision-pick", async ({ page }) => {
  await installFakeScanner(page, { read: "ASHP • EN 16" });
  await openScanCamera(page);
  const cam = page.locator(".m-cam");
  const panel = page.locator(".m-cam__panel--amber");
  await expect(cam).toHaveAttribute("data-phase", "pick");
  await expect(panel.locator(".m-cam__state--amber")).toContainText("Two cards");
  await expect(panel.locator(".m-cam__code")).toHaveText("ASHP 16");
  await expect(panel.locator(".m-cam__pickq")).toHaveText(
    "This code is printed on two promos. Pick the card you have."
  );
  await expect(page.locator(".m-guide__box--amber")).toHaveCount(1);
  const rows = panel.locator(".m-cam__pick");
  await expect(rows).toHaveCount(2);
  const grogu = rows.filter({ hasText: "Grogu" });
  await expect(grogu.locator(".m-cam__program")).toHaveText("Store Showdown · Top 8");
  await expect(
    rows.filter({ hasText: "Emperor's Messenger" }).locator(".m-cam__program")
  ).toHaveText("Weekly Play");
  // Never auto-resolved: still a pick after a while, nothing added.
  await page.waitForTimeout(1500);
  await expect(cam).toHaveAttribute("data-phase", "pick");
  await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);

  const beeps = await page.evaluate(
    () => (window as unknown as { __scan: { cues: { beeps: number } } }).__scan.cues.beeps
  );
  await grogu.click();
  await expect(cam).toHaveAttribute("data-phase", "found");
  expect(
    await page.evaluate(
      () => (window as unknown as { __scan: { cues: { beeps: number } } }).__scan.cues.beeps
    )
  ).toBe(beeps + 1);
  await expect(page.locator(".m-cam__panel .m-ident__name")).toHaveText("Grogu");
  await expect(page.locator(".m-cam__panel .m-ident__meta")).toContainText("P26 16");
  await page.evaluate(() => {
    window.__fakeRead = null;
  });
  await page.locator(".m-cam__panel .m-ident__add .swu-btn").click();
  await expect(page.locator(".m-cam__bar .m-logbtn__n")).toHaveText("1");
});
