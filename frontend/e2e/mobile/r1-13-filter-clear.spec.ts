import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";

// BL-341 R1-13: on desktop, switching between the Vault's Collection and its
// Stashes page, either way, clears the filters (one CardsPage serves both,
// App.tsx `vaultPage`). A visit to another pane (Deck Check) and back keeps
// them, as before.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop filters");
});
test.use({
  storageState: "e2e/.auth/phone.json",
  stashSeed: {
    stashes: [{ id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" }],
    stashItems: [{ stash_id: 1, variant_id: 17, quantity: 1 }],
  },
});
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
});

const search = (page: Page) => page.locator(".ifp-search input");
const pod = (page: Page) => page.getByTestId("nav-pod");

async function openFilters(page: Page) {
  const tab = page.locator(".ifp-sidebar-tab");
  if (await tab.isVisible()) await tab.click();
  await expect(search(page)).toBeVisible();
}

test("r1-13-collection-to-stashes-clears", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  await openFilters(page);
  await search(page).fill("luke");
  await expect(search(page)).toHaveValue("luke");
  await pod(page).locator('[data-sub="stashes"]').click();
  await expect(page.locator(".sp-page")).toBeVisible();
  await openFilters(page);
  await expect(search(page)).toHaveValue("");
});

test("r1-13-stashes-to-collection-clears", async ({ page }) => {
  await page.goto("/");
  await pod(page).locator('[data-sub="stashes"]').click();
  await expect(page.locator(".sp-page")).toBeVisible();
  await openFilters(page);
  await search(page).fill("vader");
  await expect(search(page)).toHaveValue("vader");
  await pod(page).locator('[data-sub="collection"]').click();
  await expect(page.locator(".sp-page")).toHaveCount(0);
  await openFilters(page);
  await expect(search(page)).toHaveValue("");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
});

test("r1-13-other-pane-visit-keeps-filters", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  await openFilters(page);
  await search(page).fill("luke");
  await pod(page).locator('[data-top="decks"]').click();
  await expect(pod(page).locator('[data-sub="deck-check"]')).toHaveAttribute(
    "aria-current",
    "page"
  );
  await pod(page).locator('[data-top="vault"]').click();
  await openFilters(page);
  await expect(search(page)).toHaveValue("luke");
});
