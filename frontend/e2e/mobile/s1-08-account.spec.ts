import { expect, measureEach, test } from "./helpers";

// S1-08: the header account slot (rev4 account-menu, account-signed-out,
// account-logout). The Google-only branch (no Change Password) is covered by
// vitest S1-08 -- the Auth emulator cannot mint a Google provider without OAuth.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone account slot");
});

test("s1-08-account-menu", async ({ page }) => {
  await page.goto("/#/vault");
  const hit = page.locator(".m-acct__hit");
  await expect(hit).toBeVisible();
  await expect(hit).toHaveText("E");
  await hit.click();
  const items = page.locator(".m-acct__menu [role=menuitem]");
  await expect(items).toHaveText(["Settings", "Change Password", "About & Legal", "Log Out"]);
  await expect(page.locator(".m-acct__email")).toHaveText("e2e@hsv.test");
  for (const b of await items.all()) {
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  // The menu stays on screen.
  const menu = (await page.locator(".m-acct__menu").boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  // Escape closes.
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-acct__menu")).toHaveCount(0);
  // A scrim tap closes (and does not reach the list below).
  await hit.click();
  await expect(page.locator(".m-acct__menu")).toBeVisible();
  await page.mouse.click(20, page.viewportSize()!.height - 200);
  await expect(page.locator(".m-acct__menu")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/vault$/);

  // Items route: Settings / Change Password / About & Legal (ComingSoon until S4/S5).
  for (const [label, hash] of [
    ["Settings", /#\/more\/settings$/],
    ["Change Password", /#\/more\/password$/],
    ["About & Legal", /#\/about$/],
  ] as const) {
    await page.goto("/#/vault");
    await page.locator(".m-acct__hit").click();
    await page.locator(".m-acct__menu [role=menuitem]", { hasText: label }).click();
    await expect(page).toHaveURL(hash);
    await expect(page.locator(".m-soon")).toBeVisible();
  }
});

test("s1-08-logout", async ({ page }) => {
  await page.goto("/#/vault");
  await page.locator(".m-acct__hit").click();
  await page.locator(".m-acct__menu [role=menuitem]", { hasText: "Log Out" }).click();
  await expect(page.locator(".m-acct .swu-btn")).toHaveText("Sign in", { timeout: 10000 });
  await expect(page.locator(".m-acct__hit")).toHaveCount(0);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("s1-08-signed-out", async ({ page }) => {
    await page.goto("/#/vault");
    const signIn = page.locator(".m-acct .swu-btn");
    await expect(signIn).toHaveText("Sign in");
    await expect(page.locator(".m-acct__hit")).toHaveCount(0);
    const box = (await signIn.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(Math.round((await signIn.locator("svg").first().boundingBox())!.height)).toBe(40);
    await signIn.click();
    await expect(page.getByRole("dialog", { name: "Log In" })).toBeVisible();
  });
});
