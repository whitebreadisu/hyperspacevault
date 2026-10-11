import type { Page } from "@playwright/test";
import { openVault } from "./card-helpers";
import { expect, measureEach, test } from "./helpers";
import { addTimes, openVerify } from "./tool-helpers";

// S3-14: the tool's X with a non-empty batch opens desktop's close-guard
// confirm (AddCardsModal.tsx:738-775 copy verbatim; steel ring; X top-right);
// Discard & Close empties the batch and closes, Return to Batch keeps both;
// "Discard batch" in Verify cards asks the same question. F-2: Discard &
// Close renders the destructive fill #c0202e on its own polygons (resting
// and hovered); Return to Batch keeps the resting navy. Seeded from rev4
// r4-14-verify-guard and f-2-discard-red-rendered.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

const confirm = (page: Page) => page.locator('.m-d2-confirm-layer[role="alertdialog"]');
const toolX = (page: Page) => page.locator(".m-tool__head [aria-label='Close keypad']");

async function openToolFromBar(page: Page) {
  await openVault(page);
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  await page.waitForTimeout(150);
}

async function chooseSOR(page: Page) {
  await page.locator(".m-pad__entry .m-padset").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-set"]').click();
  await page.locator('.m-setpick__row[data-code="SOR"]').click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
}

test("s3-14-close-guard", async ({ page }) => {
  await openToolFromBar(page);
  // Empty batch: the X closes at once.
  await toolX(page).click();
  await expect(page.locator(".m-tool")).toHaveCount(0);
  await expect(confirm(page)).toHaveCount(0);
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  await chooseSOR(page);
  await addTimes(page, 87, 1);
  await toolX(page).click();
  const c = confirm(page);
  await expect(c).toBeVisible();
  await expect(c.locator(".m-d2-confirm__title")).toHaveText("Discard this batch?");
  await expect(c.locator(".m-d2-confirm__body")).toHaveText(
    "None of the cards you have entered will be added to inventory if you close now."
  );
  await expect(c.locator(".swu-btn")).toHaveText(["Discard & Close", "Return to Batch"]);
  await expect(page.locator(".m-tool")).toHaveCount(1);
  // X top-right of the confirm, 44 px.
  const geo = await page.evaluate(() => {
    const box = document.querySelector(".m-d2-confirm")!.getBoundingClientRect();
    const x = document.querySelector(".m-d2-confirm__x")!.getBoundingClientRect();
    return { right: box.right - x.right, top: x.top - box.top, w: x.width, h: x.height };
  });
  expect(geo.right).toBeLessThan(16);
  expect(geo.top).toBeLessThan(16);
  expect(Math.min(geo.w, geo.h)).toBeGreaterThanOrEqual(44);
  // Return to Batch keeps the batch and the keypad.
  await c.locator(".swu-btn", { hasText: "Return to Batch" }).click();
  await expect(c).toHaveCount(0);
  await expect(page.locator(".m-tool")).toHaveCount(1);
  await expect(page.locator(".m-logbtn__n")).toHaveText("1");
  // Escape returns too.
  await toolX(page).click();
  await expect(c).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(c).toHaveCount(0);
  await expect(page.locator(".m-tool")).toHaveCount(1);
  // Discard batch inside Verify cards asks the same question, over the sheet.
  await openVerify(page);
  await page.locator(".m-d2-verify__discard").click();
  await expect(c).toBeVisible();
  await expect(c.locator(".m-d2-confirm__title")).toHaveText("Discard this batch?");
  await c.locator(".swu-btn", { hasText: "Return to Batch" }).click();
  await expect(c).toHaveCount(0);
  await expect(page.locator(".m-sheet-layer--verify")).toBeVisible();
  await page.locator(".m-sheet-layer--verify .m-sheet__close").click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
  // Discard & Close empties the batch and leaves the keypad.
  await toolX(page).click();
  await c.locator(".swu-btn", { hasText: "Discard & Close" }).click();
  await expect(page.locator(".m-tool")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/vault/);
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page.locator(".m-pad__entry .m-logbtn--empty")).toHaveCount(1);
});

test("s3-14-discard-batch-from-verify", async ({ page }) => {
  await openToolFromBar(page);
  await chooseSOR(page);
  await addTimes(page, 87, 2);
  await openVerify(page);
  await page.locator(".m-d2-verify__discard").click();
  await confirm(page).locator(".swu-btn", { hasText: "Discard & Close" }).click();
  // The batch is gone and the sheet closed; the keypad stays.
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
  await expect(page.locator(".m-tool")).toHaveCount(1);
  await expect(page.locator(".m-pad__entry .m-logbtn--empty")).toHaveCount(1);
});

test("s3-14-discard-red-rendered", async ({ page }) => {
  await openToolFromBar(page);
  await chooseSOR(page);
  await addTimes(page, 87, 1);
  await toolX(page).click();
  await expect(confirm(page)).toBeVisible();
  await page.waitForTimeout(300);
  const fills = () =>
    page.evaluate(() => {
      const btn = (t: string) =>
        [...document.querySelectorAll(".m-d2-confirm .swu-btn")].find(
          (b) => b.textContent?.trim() === t
        )!;
      const f = (b: Element) =>
        [...b.querySelectorAll("polygon, rect")].map((x) => getComputedStyle(x).fill);
      return { dz: f(btn("Discard & Close")), rt: f(btn("Return to Batch")) };
    });
  const r = await fills();
  // Every polygon of Discard & Close (and the centre fill) computes #c0202e.
  expect(r.dz.length).toBeGreaterThanOrEqual(3);
  expect(new Set(r.dz)).toEqual(new Set(["rgb(192, 32, 46)"]));
  // Return to Batch keeps the resting navy.
  expect(new Set(r.rt)).toEqual(new Set(["rgb(30, 58, 138)"]));
  // Hovered, it stays red (never wakes to app blue).
  await confirm(page).locator(".swu-btn", { hasText: "Discard & Close" }).hover();
  await page.waitForTimeout(400);
  const h = await fills();
  expect(new Set(h.dz)).toEqual(new Set(["rgb(192, 32, 46)"]));
});
