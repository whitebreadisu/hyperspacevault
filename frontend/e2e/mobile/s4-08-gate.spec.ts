import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import {
  NO_SESSION,
  ensureVerifiedUser,
  expectBackLeft,
  expectXTopRight,
  openImportExport,
  openMore,
  shellControls,
  signInVerified,
} from "./more-helpers";

// S4-08 / S4-09: Import & Export's route and gate (desktop App.tsx view
// forcing: anonymous and unverified are sent back; verified see the screen)
// and the three downloads (rev4 r4-9-layout-sections' Export section; the
// requests are desktop's, inventoryImportExport.ts).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone Import & Export");
});

test.describe("anonymous", () => {
  test.use({ storageState: NO_SESSION });

  test("s4-08-gate-anonymous", async ({ page }) => {
    // A deep link: forced back to More, with the sign-in prompt (the desktop's
    // anonymous Import / Export control routes to sign-in).
    await page.goto("/#/more/importexport");
    await expect(page.getByRole("dialog", { name: "Log In" })).toBeVisible();
    await expect(page).toHaveURL(/#\/more$/);
    await expect(page.locator(".m-ie")).toHaveCount(0);
    // ... and the More row (a teaser) does the same.
    await page
      .getByRole("dialog", { name: "Log In" })
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page.getByRole("dialog", { name: "Log In" })).toHaveCount(0);
    await page.locator('[data-more="importexport"]').click({ force: true });
    await expect(page.getByRole("dialog", { name: "Log In" })).toBeVisible();
    await expect(page).toHaveURL(/#\/more$/);
  });
});

test("s4-08-gate-unverified", async ({ page }) => {
  // The shared e2e account is signed in, email not verified: sent back to
  // More with no prompt (desktop: forced back to cards).
  await page.goto("/#/more/importexport");
  await expect(page.locator(".m-more")).toBeVisible();
  await expect(page).toHaveURL(/#\/more$/);
  await expect(page.locator(".m-ie")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Log In" })).toHaveCount(0);
});

test.describe("verified", () => {
  test.use({ storageState: NO_SESSION });

  test("s4-08-gate-verified", async ({ page, request }) => {
    await ensureVerifiedUser(request);
    await signInVerified(page);
    await openMore(page);
    const row = page.locator('[data-more="importexport"]');
    await expect(row).not.toHaveAttribute("aria-disabled", "true");
    await openImportExport(page);
    await expect(page.locator(".m-shell__title")).toHaveText("Import & Export");
    // From More: the back chevron (S4-05), which returns to More.
    expectBackLeft(await shellControls(page));
    await page.locator(".m-shell__head [aria-label='Back']").click();
    await expect(page).toHaveURL(/#\/more$/);
    // A fresh load straight onto the route stays (verified) and carries the X.
    await page.goto("/#/more/importexport");
    await page.reload();
    await expect(page.locator(".m-ie")).toBeVisible();
    await expect(page).toHaveURL(/#\/more\/importexport$/);
    expectXTopRight(await shellControls(page));
    await page.locator(".m-shell__head [aria-label='Close']").click();
    await expect(page).toHaveURL(/#\/vault$/);
  });

  test("s4-09-export-requests", async ({ page, request }) => {
    await ensureVerifiedUser(request);
    await signInVerified(page);
    const rec = recorderFor(page);
    await openImportExport(page);
    const sec = page.locator('[data-section="export"]');
    await expect(sec.locator(".ie-section__title")).toHaveText("Export");
    await expect(sec.locator(".ie-section__blurb")).toHaveText(
      "Download your Vault in the canonical format."
    );
    await expect(sec.locator(".ie-reference__title")).toHaveText("Catalog reference");
    await expect(sec.locator(".ie-reference__blurb")).toHaveText(
      "Every card printing with its IDs and a quantity column, in the [HSV] format — fill in your quantities and import it directly."
    );
    for (const [label, want] of [
      ["Download JSON", ["json"]],
      ["Download CSV", ["json", "csv"]],
      ["Download catalog (CSV)", ["json", "csv", "reference"]],
    ] as const) {
      const btn = sec.locator(".swu-btn", { hasText: label });
      const box = (await btn.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      await btn.click();
      await expect.poll(() => rec.exports).toEqual(want);
      await expect(btn).toContainText(label); // back from "Preparing…"
    }
  });
});
