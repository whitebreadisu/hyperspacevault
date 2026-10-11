import { expect, measureEach, test } from "./helpers";

// S1-26: what the phone Vault must NOT have (rev4 no-why-tab-at-phone-width,
// no-quick-filters, no-camera-in-search) plus the A6 prototype-only
// machinery: no WHY tab / rationale sheet, no quick-filter row (Missing /
// New), no camera button in the search field, no "Prototype:" fine print.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone absences");
});

test("s1-26-absences", async ({ page }) => {
  for (const hash of ["#/vault", "#/vault?set=ASH", "#/more/feedback"]) {
    await page.goto("/" + hash);
    await expect(page.locator(".m-app")).toBeVisible();
    if (hash.startsWith("#/vault")) await expect(page.locator(".m-row").first()).toBeVisible();
    const r = await page.evaluate(() => ({
      why: document.querySelectorAll(".m-whytab, .m-sheet-layer--why, [data-why]").length,
      quick: document.querySelectorAll(".m-quick, .m-qchip, .m-quick__new").length,
      cam: document.querySelectorAll(".m-search__cam, .m-search [aria-label*='amera' i]").length,
      text: document.querySelector(".m-app")!.textContent ?? "",
    }));
    expect(r.why, hash).toBe(0);
    expect(r.quick, hash).toBe(0);
    expect(r.cam, hash).toBe(0);
    expect(r.text, hash).not.toMatch(/Prototype:|\bWHY\b|Missing|Nothing is sent/);
  }
  // The search row holds exactly the field, Clear (when narrowed) and Filters.
  await page.goto("/#/vault");
  await expect(page.locator(".m-row").first()).toBeVisible();
  const searchButtons = await page
    .locator(".m-search button")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent));
  expect(searchButtons.every((l) => !/camera|scan/i.test(l ?? ""))).toBe(true);
});
