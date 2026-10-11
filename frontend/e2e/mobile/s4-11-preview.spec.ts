import { QTY } from "./card-helpers";
import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import {
  NO_SESSION,
  configureImport,
  ensureVerifiedUser,
  openImportExport,
  signInVerified,
} from "./more-helpers";

// S4-11: dry-run -> preview report (a phone list) -> Confirm -> commit under
// the busy overlay -> refresh -> done. Desktop ImportExportPage /
// ImportPreviewReport semantics; the mock answers dry_run / commit from the
// fixture catalogue (mock-api.ts), so the report is real data.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone Import & Export");
});
test.use({ storageState: NO_SESSION });

test.beforeEach(async ({ page, request }) => {
  await ensureVerifiedUser(request);
  await signInVerified(page);
  await openImportExport(page);
});

const preview = (page: import("@playwright/test").Page) =>
  page.locator(".swu-btn", { hasText: "Preview import" });

test("s4-11-preview-report", async ({ page }) => {
  const rec = recorderFor(page);
  await configureImport(page, "Merge (add)", "Trim to my keep-limits");
  await preview(page).click();
  await expect(page.locator('[data-section="import"] .ie-section__title')).toHaveText(
    "Import preview"
  );
  expect(rec.imports).toHaveLength(1);
  expect([rec.imports[0].mode, rec.imports[0].capHandling, rec.imports[0].stage]).toEqual([
    "merge_add",
    "trim",
    "dry_run",
  ]);
  // The Export section is gone on the preview (desktop BL-202 round 3).
  await expect(page.locator('[data-section="export"]')).toHaveCount(0);

  // Totals, then the report as a list -- no table.
  const totals = page.locator(".ie-totals__cell");
  await expect(totals.locator("dt")).toHaveText([
    "Rows",
    "Cards",
    "Resolved",
    "Unresolved",
    "Ambiguous",
    "Trimmed",
    "Duplicates merged",
  ]);
  await expect(totals.locator("dd")).toHaveText(["2", "2", "1", "1", "0", "0", "0"]);
  await expect(page.locator("table")).toHaveCount(0);

  // Problem rows lead when there are any: error, then the recommendation.
  const tabs = page.locator("[role=tab]");
  await expect(tabs).toHaveText(["Problem rows (1)", "Resolved rows (1)"]);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  const prob = page.locator(".m-ie-row--problem");
  await expect(prob).toHaveCount(1);
  await expect(prob.locator(".m-ie-row__card")).toHaveText("SOR 999 (Standard)");
  await expect(prob.locator(".ie-table__error")).toHaveText(
    "No card in the catalog matches that set, number, and printing."
  );
  await expect(prob.locator(".ie-table__recommendation")).toHaveText(
    "Recommendation: Double-check the row against the catalog reference sheet — it's usually a number or printing-type typo."
  );
  await tabs.nth(1).click();
  const res = page.locator(".m-ie-list .m-ie-row");
  await expect(res).toHaveCount(1);
  await expect(res.locator(".m-ie-row__card")).toHaveText("SOR 87 (Standard)");
  await expect(res.locator(".m-ie-row__qty")).toHaveText("1 → 3");
  // The problem-rows download and the two actions are 44 px targets.
  for (const label of ["Download problem rows (CSV)", "Cancel", "Confirm import"]) {
    const b = (await page.locator(".swu-btn", { hasText: label }).boundingBox())!;
    expect(b.height, label).toBeGreaterThanOrEqual(44);
  }
  // No Replace All confirmation for Merge.
  await expect(page.locator("[role=checkbox]")).toHaveCount(0);
  // Cancel returns to the form with the picks and the file intact.
  await page.locator(".swu-btn", { hasText: "Cancel" }).click();
  await expect(page.locator("#ie-file-input")).toBeAttached();
  await expect(page.locator(".ie-file-name")).toHaveText("vault.json");
  await expect(page.locator('[role=radio][data-group="mode"]').nth(0)).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(preview(page)).not.toHaveAttribute("aria-disabled", "true");
});

test("s4-11-replace-all-confirmation-gates-commit", async ({ page }) => {
  const rec = recorderFor(page);
  await configureImport(page, "Replace All", "Trim to my keep-limits");
  // Desktop parity: not on the configure step.
  await expect(page.locator("[role=checkbox]")).toHaveCount(0);
  await preview(page).click();
  await expect(page.locator("[role=tab]").first()).toBeVisible();
  // Owned rows the file does not list are the removals.
  const sor87 = 7221;
  const removals = [...QTY].filter(([vid, q]) => q > 0 && vid !== sor87).length;
  const box = page.locator("[role=checkbox]");
  await expect(box).toHaveText(
    `I understand this will permanently remove ${removals} cards not in this file.`
  );
  await expect(page.locator(".ie-report-section--danger")).toContainText(
    `Will be removed (${removals}) — not present in the file`
  );
  await expect(page.locator(".ie-totals__cell dt", { hasText: "Removed" })).toBeVisible();
  const confirm = page.locator(".swu-btn", { hasText: "Confirm import" });
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await confirm.click({ force: true }); // aria-disabled stays tappable
  expect(rec.imports.map((i) => i.stage)).toEqual(["dry_run"]); // gated
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  expect(
    await box.locator(".m-check__box").evaluate((e) => getComputedStyle(e).backgroundColor)
  ).toBe("rgb(248, 113, 113)");
  await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
  await confirm.click();
  await expect(page.locator(".ie-success")).toHaveText("Import complete — 1 row written.");
  expect(rec.imports.map((i) => [i.mode, i.stage])).toEqual([
    ["replace_all", "dry_run"],
    ["replace_all", "commit"],
  ]);
});

test("s4-11-commit-refreshes", async ({ page }) => {
  const rec = recorderFor(page);
  // Hold the commit open so the busy overlay can be read.
  await page.route(
    (u) => u.pathname === "/api/inventory/import",
    async (route) => {
      if ((route.request().postData() ?? "").includes("commit"))
        await new Promise((r) => setTimeout(r, 900));
      await route.fallback();
    }
  );
  let quantityReads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/inventory/quantities") quantityReads++;
  });
  await configureImport(page, "Merge (add)", "Add everything");
  await preview(page).click();
  await expect(page.locator("[role=tab]").first()).toBeVisible();
  const before = quantityReads;
  await page.locator(".swu-btn", { hasText: "Confirm import" }).click();
  // The commit runs under the blocking busy overlay with desktop's stage text.
  await expect(page.locator(".busy-overlay__message")).toHaveText("Applying 2 cards…");
  await expect(page.locator(".busy-overlay")).toBeVisible();
  await expect(page.locator(".ie-success")).toHaveText("Import complete — 1 row written.", {
    timeout: 8000,
  });
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  expect(rec.imports.map((i) => [i.mode, i.capHandling, i.stage])).toEqual([
    ["merge_add", "add_above", "dry_run"],
    ["merge_add", "add_above", "commit"],
  ]);
  // The same file went both times.
  expect(rec.imports[1].file).toEqual(rec.imports[0].file);
  // The Vault's quantities were refetched after the commit ...
  expect(quantityReads).toBeGreaterThan(before);
  // ... and the done state offers desktop's two exits.
  await expect(page.locator(".m-ie__link")).toHaveText("Import another file");
  await page.locator(".swu-btn", { hasText: "Back to Vault" }).click();
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.locator(".m-row").first()).toBeVisible();
});
