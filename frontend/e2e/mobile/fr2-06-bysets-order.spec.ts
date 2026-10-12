import { expect, measureEach, test } from "./helpers";

// FR2-06 (BL-258): the phone "Completion by set" sheet lists the base sets
// newest first -- literal first and last rows (s1-24 derives its expectation
// from orderSetCodes, so it follows the order by itself).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone by-set sheet");
});

test("fr2-06 Completion by set: HMW first, IBH then TS26 last", async ({ page }) => {
  await page.goto("/#/vault?sheet=sets");
  await expect(page.locator(".m-sheet")).toBeVisible();
  const rows = page.locator(".m-setrow--r2");
  await expect(rows.first()).toHaveAttribute("data-set", "HMW");
  await expect(rows.last()).toHaveAttribute("data-set", "TS26");
  await expect(rows.nth(-2)).toHaveAttribute("data-set", "IBH");
  await expect(rows.nth(-3)).toHaveAttribute("data-set", "SOR");
});
