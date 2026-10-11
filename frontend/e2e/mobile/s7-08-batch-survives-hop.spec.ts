import { expect, measureEach, test } from "./helpers";
import { openVerify, typeNum } from "./tool-helpers";

// S7-08: the batch survives the hop between the main document and the isolated
// /scan/ document (a full navigation each way) -- one keypad copy added on /,
// still counted on /scan/, one more added there, both still there back on /.
test.afterEach(measureEach);

test("s7-08-batch-survives-hop", async ({ page }) => {
  const badge = page.locator(".m-pad__entry .m-logbtn .m-logbtn__n");
  const addBtn = page.locator(".m-ident__add .swu-btn");

  await page.goto("/#/pad?set=SOR");
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  await typeNum(page, 87);
  await addBtn.click();
  await expect(badge).toHaveText("1");

  // Hop to the isolated document: a different document, the same batch.
  await page.goto("/scan/#/pad?set=SOR");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  await expect(badge).toHaveText("1");
  await typeNum(page, 87);
  await addBtn.click();
  await expect(badge).toHaveText("2");

  // And back: Verify counts both copies.
  await page.goto("/#/pad?set=SOR");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
  await expect(badge).toHaveText("2");
  await openVerify(page);
  await expect(page.locator(".m-sheet-layer--verify")).toContainText("2");

  // A reload in the same tab keeps it too (the mirror is the tab's session).
  await page.reload();
  await expect(badge).toHaveText("2");
});
