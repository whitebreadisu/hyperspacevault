import { expect, measureEach, test } from "./helpers";

// S7-01: /scan/ is a second Vite entry (scan.html): the same app bundle family
// and the same signed-in session (Firebase's IndexedDB persistence is
// origin-wide), served at /scan and /scan/ by the dev server exactly as
// Firebase's rewrite does in prod.
test.afterEach(measureEach);

test("s7-01-scan-document-boots", async ({ page }) => {
  await page.goto("/scan/");
  await expect(page.locator(".m-app")).toBeVisible();
  // Signed in through the shared storage state: the avatar bubble shows.
  await expect(page.locator(".m-acct__hit")).toBeVisible();
  const doc = await page.evaluate(() => ({
    path: location.pathname,
    scan: typeof (window as unknown as { __scan?: unknown }).__scan,
    title: document.title,
  }));
  expect(doc.path).toBe("/scan/");
  expect(doc.scan).toBe("object");
  expect(doc.title).toContain("HyperspaceVault");
  // The no-slash form reaches the same document.
  const r = await page.goto("/scan");
  expect(r?.status()).toBe(200);
  await expect(page.locator(".m-app")).toBeVisible();
  // The main document is a different document: no scanner machinery.
  await page.goto("/");
  await expect(page.locator(".m-app")).toBeVisible();
  expect(await page.evaluate(() => typeof (window as unknown as { __scan?: unknown }).__scan)).toBe(
    "undefined"
  );
});
