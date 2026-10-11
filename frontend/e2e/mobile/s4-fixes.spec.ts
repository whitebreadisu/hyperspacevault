import { expect, measureEach, test } from "./helpers";
import {
  NO_SESSION,
  ensureVerifiedUser,
  expectBackLeft,
  expectXTopRight,
  openImportExport,
  openMore,
  openVault,
  shellControls,
  signInVerified,
} from "./more-helpers";

// S4 fix run (review F1 / F2 / F3): Escape belongs to the top-most layer,
// the back chevron survives a history return, Leave Feedback from More gets
// the chevron.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone More sub-pages");
});

test.describe("verified", () => {
  test.use({ storageState: NO_SESSION });

  test("s4-f1-escape-single-layer", async ({ page, request }) => {
    await ensureVerifiedUser(request);
    await signInVerified(page);
    await openImportExport(page);
    await page.locator(".m-nav__center .swu-btn").click();
    await expect(page).toHaveURL(/#\/pad$/);
    await expect(page.locator(".m-tool")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".m-tool")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/more\/importexport$/);
    await expect(page.locator(".m-ie")).toBeVisible();
  });
});

test("s4-f2-chevron-survives-history-return", async ({ page }) => {
  await openMore(page);
  await page.locator('[data-more="updates"]').click();
  await expect(page.locator(".m-updates")).toBeVisible();
  expectBackLeft(await shellControls(page));
  await page.locator(".m-updates__chip--about").click();
  await expect(page).toHaveURL(/#\/about$/);
  expectXTopRight(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Close']").click();
  await expect(page).toHaveURL(/#\/more\/updates$/);
  await expect(page.locator(".m-updates")).toBeVisible();
  expectBackLeft(await shellControls(page));
});

test("s4-f3-feedback-chevron-from-more", async ({ page }) => {
  await openMore(page);
  await page.locator('[data-more="feedback"]').click();
  await expect(page).toHaveURL(/#\/more\/feedback$/);
  await expect(page.locator(".m-fb")).toBeVisible();
  await expect(page.locator(".m-fb__head [aria-label='Close']")).toHaveCount(0);
  await page.locator(".m-fb__head [aria-label='Back']").click();
  await expect(page).toHaveURL(/#\/more$/);
  // From the Vault header it keeps the X.
  await openVault(page);
  await page.locator(".m-vh__fb").click();
  await expect(page).toHaveURL(/#\/more\/feedback$/);
  await expect(page.locator(".m-fb__head [aria-label='Close']")).toBeVisible();
  await expect(page.locator(".m-fb__head [aria-label='Back']")).toHaveCount(0);
});
