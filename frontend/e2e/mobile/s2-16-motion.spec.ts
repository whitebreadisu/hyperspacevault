import { expect, measureEach, test } from "./helpers";
import {
  b1Motion,
  b1NoOverflow,
  b1Targets,
  BASE_SETS,
  FSHEET,
  openFilters,
  tapIn,
} from "./filters-helpers";

// S2-16: the motion rule, overflow and 44 px targets (rev4
// b1-motion-transform-only, b1-no-overflow, b1-targets-44,
// r4-3-fits-without-scroll's target / overflow clauses), at 390 and 430,
// at rest, with Gameplay open, with chips on every row and over the picker.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone filters");
});

const clean = { out: [], sideways: false, page: false };

test("s2-16-motion-and-overflow", async ({ page }) => {
  await openFilters(page);
  // At rest.
  expect(await page.evaluate(b1Motion)).toEqual([]);
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual(clean);

  // Gameplay open.
  await tapIn(page, ".m-fgame__head");
  await page.waitForTimeout(300);
  expect(await page.evaluate(b1Motion)).toEqual([]);
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual(clean);

  // Chips on every row (all base sets wrap, a scope, a rarity, a toggle).
  await tapIn(page, '[data-facet="rarity"] [data-fv="Legendary"]');
  await page.evaluate((codes) => {
    location.hash = "#/vault?sheet=filters&finish=Serialized%20Prestige&set=" + codes.join(",");
  }, BASE_SETS);
  await page.waitForTimeout(600);
  expect(await page.locator(`${FSHEET} .m-fsel`).count()).toBe(BASE_SETS.length + 1);
  expect(await page.evaluate(b1Motion)).toEqual([]);
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual(clean);

  // Over a picker (the facet picker layer), then back.
  // The chips cover the row's middle; the label column is the open target.
  await page.locator(`${FSHEET} [data-fpick="set"]`).click({ position: { x: 30, y: 20 } });
  await expect(page.locator(".m-sheet-layer--fpick-set")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(b1Motion)).toEqual([]);
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual({ ...clean, sideways: false });
  await page.locator(".m-sheet-layer--fpick-set .m-sheet__close").click();
  await expect(page.locator(".m-sheet-layer--fpick")).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(await page.evaluate(b1NoOverflow)).toEqual(clean);
});
