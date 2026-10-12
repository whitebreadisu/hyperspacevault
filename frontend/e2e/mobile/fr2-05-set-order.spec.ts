import { expect, measureEach, test } from "./helpers";
import { openFilters, tapIn } from "./filters-helpers";
import { openPad } from "./tool-helpers";

// FR2-05 (BL-258): the phone set pickers list the main block newest first.
// The e2e fixture carries HMW/HMWP (hand-added), so HMW is observable first.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone pickers");
});

test("fr2-05 Filters Set picker: HMW is the first logo chip, IBH and TS26 last", async ({
  page,
}) => {
  await openFilters(page);
  await tapIn(page, '[data-fpick="set"]');
  const layer = page.locator(".m-sheet-layer--fpick-set");
  await expect(layer).toBeVisible();
  const chips = layer.locator(".m-setfacet__chip");
  await expect(chips.first()).toHaveAttribute("data-fv", "HMW");
  await expect(chips.last()).toHaveAttribute("data-fv", "TS26");
  await expect(chips.nth(9)).toHaveAttribute("data-fv", "IBH");
});

test("fr2-05 keypad Set chooser: HMW is the first row in both views", async ({ page }) => {
  await openPad(page);
  await page.locator(".m-pad__entry .m-padset").click();
  const sheet = page.locator(".m-sheet-layer--setpick");
  await page.locator('.m-setchooser[aria-controls="m-setchooser-set"]').click();
  const rows = sheet.locator(".m-setpick__row");
  await expect(rows.first()).toHaveAttribute("data-code", "HMW");
  await expect(rows.last()).toHaveAttribute("data-code", "TS26");
  await page.locator(".m-setpick__all").click();
  await expect(sheet.locator(".m-setpick__rgroup").first()).toHaveAttribute("data-base", "HMW");
  await expect(sheet.locator(".m-setpick__row").first()).toHaveAttribute("data-code", "HMW");
  await expect(sheet.locator(".m-setpick__row--sub").first()).toHaveAttribute("data-code", "HMWP");
});
