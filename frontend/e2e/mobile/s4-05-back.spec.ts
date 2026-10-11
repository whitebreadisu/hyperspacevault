import { expect, measureEach, test } from "./helpers";
import {
  expectBackLeft,
  expectXTopRight,
  openMore,
  openVault,
  shellControls,
} from "./more-helpers";

// S4-05: More's sub-pages reached from More carry a LEFT back chevron and
// return to #/more (skill, round 2); the same screens reached from the title
// chooser / account menu carry the X top-right only (rev4 D1).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone back");
});

test("s4-05-back-chevron-from-more", async ({ page }) => {
  for (const [id, hash, sel] of [
    ["about", /#\/more\/about$/, ".m-about"],
    ["updates", /#\/more\/updates$/, ".m-updates"],
  ] as const) {
    await openMore(page);
    await page.locator(`[data-more="${id}"]`).click();
    await expect(page).toHaveURL(hash);
    await expect(page.locator(sel)).toBeVisible();
    expectBackLeft(await shellControls(page));
    await page.locator(".m-shell__head [aria-label='Back']").click();
    await expect(page).toHaveURL(/#\/more$/);
    await expect(page.locator(".m-more")).toBeVisible();
  }
  // About's own Close also returns to More when More opened it.
  await page.locator('[data-more="about"]').click();
  await page.locator(".about-submit").click();
  await expect(page).toHaveURL(/#\/more$/);
  // A deep link straight to #/more/about has nothing to go back through:
  // the X (not a chevron), which falls back to the Vault.
  await page.goto("/#/more/about");
  await page.reload(); // a fresh load, not an in-app hash change
  await expect(page.locator(".m-about")).toBeVisible();
  expectXTopRight(await shellControls(page));
});

test("s4-05-x-from-chooser", async ({ page }) => {
  await openVault(page);
  await page.locator(".m-vh__brandtext").click();
  await page.locator(".m-chooser .swu-btn", { hasText: "[HSV] Updates" }).click();
  await expect(page).toHaveURL(/#\/more\/updates$/);
  await expect(page.locator(".m-updates")).toBeVisible();
  expectXTopRight(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Close']").click();
  await expect(page).toHaveURL(/#\/vault$/);

  await page.locator(".m-acct__hit").click();
  await page.locator(".m-acct__menu [role=menuitem]", { hasText: "About & Legal" }).click();
  await expect(page).toHaveURL(/#\/about$/);
  expectXTopRight(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Close']").click();
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.locator(".m-vault")).toBeVisible();
});
