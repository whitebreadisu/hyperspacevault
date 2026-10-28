import { expect, test } from "@playwright/test";

// BL-279 WS-3 W3-06 placeholder (W3-08 deletes it): the verification session
// restored from storageState shows the signed-in account control on both
// layouts: the phone account slot's avatar, the desktop header's avatar menu.
test("j0 a signed-in user sees the vault", async ({ page }, info) => {
  await page.goto("/");
  if (info.project.name === "desktop-1440") {
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 20000,
    });
  } else {
    await expect(page.locator(".m-acct__hit")).toBeVisible({ timeout: 20000 });
  }
});
