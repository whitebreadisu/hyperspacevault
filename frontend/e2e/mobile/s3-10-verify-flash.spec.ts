import { expect, measureEach, test } from "./helpers";
import { openPad, typeNum } from "./tool-helpers";

// S3-10 (R4-14.3, verify=1 always): the Verify button's count badge carries
// the amber ring (the button stays blue), the keypad's button reads "Add to
// batch", the add flash reads "In batch", and the readout's "After add" =
// owned + batch + 1. The Verify button sits in the keypad's entry row
// (rev4; orchestrator ruling 2026-10-11 supersedes the brief's "tool
// header"). Seeded from rev4 r4-14-verify-batches.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

test("s3-10-verify-count-and-flash", async ({ page }) => {
  await openPad(page, "#/pad?set=SOR");
  // Verify lives in the entry row, never in the tool header; empty = dimmed.
  await expect(page.locator(".m-tool__head .m-logbtn")).toHaveCount(0);
  await expect(page.locator(".m-pad__entry .m-logbtn--empty[aria-disabled=true]")).toHaveCount(1);
  await typeNum(page, 87);
  const addBtn = page.locator(".m-ident__add .swu-btn");
  await expect(addBtn).toContainText("Add to batch");
  await addBtn.click();
  const btn = page.locator(".m-pad__entry .m-logbtn");
  const badge = btn.locator(".m-logbtn__n");
  await expect(badge).toHaveText("1");
  await expect(btn).toHaveAttribute("aria-label", "Verify cards, 1 in batch");
  await expect(btn).toHaveClass(/m-logbtn--verify/);
  const css = await page.evaluate(() => {
    const b = document.querySelector(".m-pad__entry .m-logbtn")!;
    const n = b.querySelector(".m-logbtn__n")!;
    const bs = getComputedStyle(b);
    return {
      ring: getComputedStyle(n).boxShadow,
      btn: bs.backgroundColor + "|" + bs.borderTopColor + "|" + bs.boxShadow,
    };
  });
  // Amber ring on the count badge only; the button itself stays off amber.
  expect(css.ring).toContain("217, 154, 31");
  expect(css.btn).not.toContain("217, 154, 31");
  // The add flash reads "In batch" (the vault is untouched), the pad cleared.
  await expect(page.locator(".m-ident__added")).toHaveText(/In batch/);
  await expect(page.locator(".m-padnum__val")).toHaveText("000");
  // After add = owned + batch + 1: SOR 87 is owned 1, one in the batch -> 3/3.
  await typeNum(page, 87);
  await expect(page.locator(".m-readout")).toContainText("In vault 1/3");
  await expect(page.locator(".m-readout")).toContainText("After add 3/3");
  // Add again: the badge counts the second copy (one row per copy).
  await addBtn.click();
  await expect(badge).toHaveText("2");
});
