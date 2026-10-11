import { expect, measureEach, test } from "./helpers";

// S1-01: phone projects render the mobile app, the desktop project the
// desktop tree.
test.afterEach(measureEach);

test("s1-01-phone-gate", async ({ page }, info) => {
  await page.goto("/");
  if (info.project.name.startsWith("phone")) {
    await expect(page.locator(".m-app")).toBeVisible();
    await expect(page.locator(".app-layout")).toHaveCount(0);
  } else {
    await expect(page.locator(".app-layout")).toBeVisible();
    await expect(page.locator(".m-app")).toHaveCount(0);
  }
});
