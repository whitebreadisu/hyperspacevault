import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera, SOR_229 } from "./scan-helpers";

// S7-17: Fast add (header toggle, remembered in hsv.scan.v1): one read = one
// batch copy at once, then the 1.5 s hold ("In batch 1", Add hidden, "Fast add
// · next card in 1.5 s"); the same card staying in frame is never counted
// twice (r4-14-verify-camera-hold). The cue on every recognition is one beep
// attempt + the green flash (r4-12-cue-fires-on-hold), observed via the beep
// counter and a MutationObserver on the flash's class; never a vibration.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);

type ScanWin = { __scan: { cues: { beeps: number } }; __flashes?: number; __vibrations?: number };

test("s7-17-fast-add-hold", async ({ page }) => {
  await installFakeScanner(page, { read: null });
  await openScanCamera(page);
  const fast = page.locator(".m-tool__fast");
  await expect(fast).toHaveAttribute("aria-checked", "false");
  await fast.click();
  await expect(fast).toHaveAttribute("aria-checked", "true");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("hsv.scan.v1") ?? "{}").fastAdd)
  ).toBe(true);

  const cam = page.locator(".m-cam");
  const n = page.locator(".m-cam__bar .m-logbtn__n");
  await page.evaluate((t) => {
    window.__fakeRead = t; // the card stays in frame for the rest of the test
  }, SOR_229);
  await expect(cam).toHaveAttribute("data-phase", "hold");
  await expect(n).toHaveText("1");
  await expect(page.locator(".m-cam__holdtxt")).toHaveText("Fast add · next card in 1.5 s");
  await expect(page.locator(".m-ident__added")).toContainText("In batch 1");
  await expect(page.locator(".m-cam__panel .m-ident__add .swu-btn")).toHaveCount(0);
  await expect(cam).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
  // Same card still in frame: never a second copy.
  await page.waitForTimeout(4000);
  await expect(n).toHaveText("1");

  // Remembered across a reload.
  await page.reload();
  await expect(page.locator(".m-tool__fast")).toHaveAttribute("aria-checked", "true");
});

test("s7-17-flash-and-beep-fired", async ({ page }) => {
  await installFakeScanner(page, { read: null });
  await page.addInitScript(() => {
    const w = window as unknown as ScanWin;
    w.__flashes = 0;
    w.__vibrations = 0;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: () => {
        w.__vibrations = (w.__vibrations ?? 0) + 1;
        return true;
      },
    });
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target as HTMLElement;
        if (
          el.classList?.contains("m-camflash--on") &&
          !(m.oldValue ?? "").includes("m-camflash--on")
        )
          w.__flashes = (w.__flashes ?? 0) + 1;
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
    });
  });
  await openScanCamera(page);
  const before = await page.evaluate(() => (window as unknown as ScanWin).__scan.cues.beeps);
  await page.evaluate((t) => {
    window.__fakeRead = t;
  }, SOR_229);
  await expect(page.locator(".m-cam")).toHaveAttribute("data-phase", "found");
  await expect.poll(() => page.evaluate(() => (window as unknown as ScanWin).__flashes)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as ScanWin).__scan.cues.beeps)).toBe(
    before + 1
  );
  // The flash fades out (opacity back to 0) and never blocks taps.
  await expect(page.locator(".m-camflash")).not.toHaveClass(/m-camflash--on/);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".m-camflash")!).pointerEvents
    )
  ).toBe("none");
  expect(await page.evaluate(() => (window as unknown as ScanWin).__vibrations)).toBe(0);
});
