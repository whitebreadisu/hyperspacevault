import { expect, measureEach, test } from "./helpers";
import { openVault } from "./card-helpers";
import { openPad, typeNum } from "./tool-helpers";

// S3-01: the tool layer at #/pad, opened from the bar's centre button
// (rev4 bar-one-opens-keypad): a layer over the current screen (the Vault
// stays mounted and keeps its state), the bar covered, X top-right; the
// keypad ignores the Vault's finish scope (rev4 b0-q11-keypad-ignores-scope).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

test("s3-01-opens-from-bar", async ({ page }) => {
  await openVault(page, "#/vault?q=vader");
  const rows = await page.locator(".m-row").count();
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page).toHaveURL(/#\/pad$/);
  const tool = page.locator(".m-tool");
  await expect(tool).toBeVisible();
  await expect(page.locator(".m-tool--camera")).toHaveCount(0);
  const m = await page.evaluate(() => {
    const nav = document.querySelector(".m-nav")!.getBoundingClientRect();
    const hit = document.elementFromPoint(nav.left + nav.width / 2, nav.top + nav.height / 2);
    const x = document.querySelector(".m-tool__head [aria-label='Close keypad']")!;
    const r = x.getBoundingClientRect();
    return {
      navCovered: !!hit?.closest(".m-tool"),
      navInert: document.querySelector(".m-app__nav")!.hasAttribute("inert"),
      vaultMounted: !!document.querySelector(".m-app__screen .m-vault"),
      xRight: r.right,
      xTop: r.top,
      xW: r.width,
      xH: r.height,
      iw: innerWidth,
      title: document.querySelector(".m-padlayer__title")!.textContent,
    };
  });
  expect(m.navCovered).toBe(true);
  expect(m.navInert).toBe(true);
  expect(m.vaultMounted).toBe(true);
  expect(m.title).toBe("Keypad");
  expect(m.xRight).toBeGreaterThan(m.iw - 20);
  expect(m.xTop).toBeLessThan(80);
  expect(Math.min(m.xW, m.xH)).toBeGreaterThanOrEqual(44);
  // BL-253 S7-24 REPLACE (flag on since S7-09): was "no camera mode toggle
  // while the camera flag is off" -- the toggle is present, keypad side on.
  await expect(page.locator(".m-tool__mode")).toHaveCount(1);
  await expect(page.locator('.m-tool__mode [aria-label="Keypad mode"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.locator(".m-tool__head [aria-label='Close keypad']").click();
  await expect(page).toHaveURL(/#\/vault\?q=vader$/);
  await expect(tool).toHaveCount(0);
  await expect(page.locator(".m-row")).toHaveCount(rows);
  await expect(page.locator(".m-nav")).toBeVisible();
});

test("s3-01-ignores-scope", async ({ page }) => {
  // Hyperspace scope on the Vault; the keypad's SOR 87 is the Standard
  // printing (the number's own), and Card details opens it unscoped.
  await openVault(page, "#/vault?finish=Hyperspace");
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  await typeNum(page, 87);
  await expect(page.locator(".m-ident__meta")).toHaveText("SOR 87 · Standard");
  await page.locator(".m-ident__details").click();
  await expect(page).toHaveURL(/#\/card\/814\?v=7221$/);
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  await expect(
    page.locator(".m-page:not(.m-page--ghost) .m-print.cp-rail__item--active")
  ).toHaveAttribute("data-variant", "7221");
  // The Vault scope itself stays engaged underneath.
  await page.locator(".m-hdr__close").click();
  await expect(page).toHaveURL(/#\/pad$/);
  await page.locator(".m-tool__head [aria-label='Close keypad']").click();
  await expect(page).toHaveURL(/finish=Hyperspace/);
  await expect(page.locator(".m-scopechip--on")).toBeVisible();
});

test("s3-01-direct-open", async ({ page }) => {
  // A deep link opens the layer over the Vault.
  await openPad(page);
  await expect(page.locator(".m-app__screen .m-vault")).toHaveCount(1);
});
