import { expect, measureEach, test } from "./helpers";
import { installFakeScanner } from "./scan-helpers";
import { addTimes } from "./tool-helpers";

// S7-09: the camera mode is on. The keypad's mode toggle opens the camera by
// a document hop to the isolated /scan/ document (with the batch); inside it
// the toggle switches in place (ruling 1: /scan/ is the full app, so the
// keypad works there); the camera X walks back to the main document at the
// screen the tool was opened over. The bar's centre button opens the mode
// used last (ports S3's bar-one-opens-keypad; rev4 camera-*).
test.afterEach(measureEach);

const isolated = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.crossOriginIsolated);

test("s7-09-toggle-and-hop", async ({ page }) => {
  await installFakeScanner(page);
  await page.goto("/#/vault?q=vader");
  await expect(page.locator(".m-vault")).toBeVisible();
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page).toHaveURL(/\/#\/pad$/);
  await addTimes(page, 87);

  // Keypad -> camera: the hop (a new, isolated document) with the batch.
  await page.locator(".m-tool__mode [aria-label='Camera mode']").click();
  await expect(page).toHaveURL(/\/scan\/#\/camera$/);
  await expect(page.locator(".m-tool--camera .m-cam")).toBeVisible();
  expect(await isolated(page)).toBe(true);
  await expect(page.locator(".m-cam__bar .m-logbtn__n")).toHaveText("1");

  // Camera -> keypad inside /scan/: in place, same document.
  await page.locator(".m-tool__mode [aria-label='Keypad mode']").click();
  await expect(page).toHaveURL(/\/scan\/#\/pad$/);
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  expect(await isolated(page)).toBe(true);
  await page.locator(".m-tool__mode [aria-label='Camera mode']").click();
  await expect(page).toHaveURL(/\/scan\/#\/camera$/);
  await expect(page.locator(".m-tool--camera .m-cam")).toBeVisible();

  // The camera X with a copy waiting: the close guard over the open camera;
  // Return keeps both; Discard & Close empties the batch and walks back to the
  // main document at the screen the tool was opened over.
  await page.locator(".m-tool__head [aria-label='Close camera']").click();
  await expect(page.locator(".m-d2-confirm-layer")).toBeVisible();
  await expect(page.locator(".m-tool--camera .m-cam")).toBeVisible();
  await page.locator(".m-d2-confirm-layer .swu-btn", { hasText: /return/i }).click();
  await expect(page.locator(".m-d2-confirm-layer")).toHaveCount(0);
  await expect(page.locator(".m-cam__bar .m-logbtn__n")).toHaveText("1");
  await page.locator(".m-tool__head [aria-label='Close camera']").click();
  await page.locator(".m-d2-confirm-layer .swu-btn", { hasText: /discard/i }).click();
  await expect(page).toHaveURL(/\/#\/vault\?q=vader$/);
  expect(await isolated(page)).toBe(false);
  await expect(page.locator(".m-vault")).toBeVisible();
  await page.locator(".m-nav__center .swu-btn").click(); // opens the camera now (last mode)
  await expect(page).toHaveURL(/\/scan\/#\/camera$/);
  await expect(page.locator(".m-cam__bar .m-logbtn--empty")).toHaveCount(1);
});

test("s7-09-bar-opens-last-mode", async ({ page }) => {
  await installFakeScanner(page);
  // Fresh tab: the keypad.
  await page.goto("/#/vault");
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page).toHaveURL(/\/#\/pad$/);
  await expect(page.locator(".m-nav__tool--on")).toHaveCount(1);
  // Switch to the camera, then close it (empty batch: no guard) -> back on /.
  await page.locator(".m-tool__mode [aria-label='Camera mode']").click();
  await expect(page).toHaveURL(/\/scan\/#\/camera$/);
  await expect(page.locator(".m-tool--camera .m-cam")).toBeVisible();
  await page.locator(".m-tool__head [aria-label='Close camera']").click();
  await expect(page).toHaveURL(/\/#\/vault$/);
  expect(await isolated(page)).toBe(false);
  // The bar now opens the camera (the mode used last), lit glyph = camera.
  await expect(page.locator(".m-nav__tool--on svg")).toHaveCount(1);
  const lit = await page.evaluate(() =>
    [...document.querySelectorAll(".m-nav__tool")].findIndex((e) =>
      e.classList.contains("m-nav__tool--on")
    )
  );
  expect(lit).toBe(1);
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page).toHaveURL(/\/scan\/#\/camera$/);
  await expect(page.locator(".m-tool--camera .m-cam")).toBeVisible();
  // A cold /#/camera on the main document is the hop too.
  await page.goto("/#/camera");
  await expect(page).toHaveURL(/\/scan\/#\/camera$/);
  expect(await isolated(page)).toBe(true);
});
