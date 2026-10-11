import { expect, measureEach, test } from "./helpers";
import {
  expectBackLeft,
  expectXTopRight,
  openMore,
  openVault,
  shellControls,
} from "./more-helpers";

// S5-04 (rev4 `account-settings`): the account menu's Settings / Change
// Password and More's rows reach the real screens (no ComingSoon); Delete is
// reachable only from Settings' Danger Zone (+ the deep link).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone account routes");
});

test("s5-04-routes-from-menu-and-more", async ({ page }) => {
  // Account menu -> Settings: the X top-right, closing back to the Vault.
  await openVault(page);
  await page.locator(".m-acct__hit").click();
  await page.locator(".m-acct__menu [role=menuitem]", { hasText: "Settings" }).click();
  await expect(page).toHaveURL(/#\/more\/settings$/);
  await expect(page.locator(".m-settings")).toBeVisible();
  await expect(page.locator(".m-soon")).toHaveCount(0);
  expectXTopRight(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Close']").click();
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.locator(".m-vault")).toBeVisible();

  // Account menu -> Change Password: a layer over the Vault, which stays put.
  await page.locator(".m-acct__hit").click();
  await page.locator(".m-acct__menu [role=menuitem]", { hasText: "Change Password" }).click();
  await expect(page).toHaveURL(/#\/more\/password$/);
  const dlg = page.getByRole("dialog", { name: "Change Password" });
  await expect(dlg).toBeVisible();
  await expect(page.locator(".m-vault")).toBeAttached();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page).toHaveURL(/#\/vault$/);

  // More rows: Settings (chevron back to More), Change Password (layer over More).
  await openMore(page);
  await page.locator('[data-more="settings"]').click();
  await expect(page).toHaveURL(/#\/more\/settings$/);
  await expect(page.locator(".m-settings")).toBeVisible();
  expectBackLeft(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Back']").click();
  await expect(page).toHaveURL(/#\/more$/);
  await expect(page.locator(".m-more")).toBeVisible();

  await page.locator('[data-more="password"]').click();
  await expect(page).toHaveURL(/#\/more\/password$/);
  await expect(dlg).toBeVisible();
  await expect(page.locator(".m-more")).toBeAttached();
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/#\/more$/);

  // Delete has no row or menu entry of its own.
  await expect(page.locator('[data-more="delete"]')).toHaveCount(0);
  await page.locator(".m-acct__hit").click();
  await expect(page.locator(".m-acct__menu [role=menuitem]")).toHaveText([
    "Settings",
    "Change Password",
    "About & Legal",
    "Log Out",
  ]);
});
