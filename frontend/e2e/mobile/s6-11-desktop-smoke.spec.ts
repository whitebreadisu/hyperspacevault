import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";

// BL-252 stage 6b S6-11: the desktop regression smoke. The phone work shares
// the repo (the S1 gate in App.tsx, the isolated-document auth in firebase.ts,
// additive analytics values); this spec proves the desktop tree at 1440 still
// renders and opens its main surfaces, and that the main document stays
// outside the scan document's cross-origin isolation.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop smoke");
});
test.use({ storageState: "e2e/.auth/phone.json" });

// The phone health check (controls >= 44 px) does not apply to the dense
// desktop tree; the same page-error / console-error / failed-request checks do.
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

test("s6-11-desktop-smoke-vault-renders", async ({ page }) => {
  const res = await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();
  await expect(page.locator(".m-app")).toHaveCount(0);
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  // The main document is never cross-origin isolated (the Google sign-in
  // popup keeps window.opener): no COOP / COEP on `/`.
  const h = res!.headers();
  expect(h["cross-origin-opener-policy"]).toBeUndefined();
  expect(h["cross-origin-embedder-policy"]).toBeUndefined();
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
});

test("s6-11-desktop-smoke-filters-panel-opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  // Closed rail first (the tab is shown, the panel is not), then open, then
  // collapsed again: the test proves the toggle, not just the title text.
  const tab = page.locator(".ifp-sidebar-tab");
  const title = page.locator(".ifp-sidebar__title");
  await expect(tab).toBeVisible();
  await expect(title).toHaveCount(0);
  await tab.click();
  await expect(title).toHaveText("Filters");
  await expect(tab).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse filters" }).click();
  await expect(title).toHaveCount(0);
  await expect(tab).toBeVisible();
});

test("s6-11-desktop-smoke-card-popup-opens", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("tbody tr:not([aria-hidden])").first();
  await expect(row).toBeVisible();
  await row.locator("td").nth(1).click();
  await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
});

test("s6-11-desktop-smoke-add-cards-opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  await page.getByRole("button", { name: "Add Cards", exact: true }).click();
  await expect(page.locator(".ac-modal[role=dialog]")).toBeVisible();
});

test("s6-11-desktop-smoke-shared-page-renders", async ({ page }) => {
  await page.goto("/shared/tok-1");
  await expect(page.locator(".app-layout")).toBeVisible();
  await expect(page.locator(".m-app")).toHaveCount(0);
  await expect(page.locator(".nav-tab--active")).toContainText("Rowan");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
});
