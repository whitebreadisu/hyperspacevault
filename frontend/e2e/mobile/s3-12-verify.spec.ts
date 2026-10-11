import type { Page } from "@playwright/test";
import { expect, measureEach, test } from "./helpers";
import { addTimes, openPad, openVerify, raiseStandardLimit } from "./tool-helpers";

// S3-12 (R5-8): the Verify cards sheet -- desktop AddCardsVerification's two
// sections ("The following cards will be added to inventory" / "... will
// not be added") with their counts and desktop's columns (Card#, Name, Set,
// Finish, Inventory, Reason in the not-added section), one row per copy,
// a 44 px quick remove on each added row only, no Keep/Skip, no steppers.
// S3-13: a long batch with both sections pins the two headers as a two-way
// accordion; a batch that fits (or has one section) is a plain scroll.
// Seeded from rev4 r4-14-verify-sheet-rows (REPLACED: rows were folded per
// printing with Keep/Skip + steppers) and R5-8.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

const sheet = (page: Page) => page.locator(".m-sheet-layer--verify");
const section = (page: Page, kind: string) =>
  page.locator(`.m-sheet-layer--verify .m-vsec[data-section="${kind}"]`);

// SOR 87 Darth Vader (Standard) is owned 1 of 3; SOR 35 is owned 3 of 3.
test("s3-12-two-sections-desktop-columns", async ({ page }) => {
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 2);
  await addTimes(page, 35, 1);
  await openVerify(page);
  const s = sheet(page);
  await expect(s.locator(".m-sheet__title")).toHaveText("Verify cards");
  await expect(s.locator(".m-sheet__sub")).toHaveText("3 cards in this batch");
  // Desktop's section titles, in order, each with its count.
  await expect(s.locator(".m-vsec__title")).toHaveText([
    "The following cards will be added to inventory",
    "The following cards will not be added",
  ]);
  await expect(section(page, "add").locator(".ac-verify__count")).toHaveText("2 cards");
  await expect(section(page, "skip").locator(".ac-verify__count")).toHaveText("1 card");
  // Desktop's columns, verbatim; Reason only in the not-added section.
  const cols = (kind: string) =>
    section(page, kind).locator('[role="columnheader"]').allTextContents();
  expect((await cols("add")).sort()).toEqual(["Card#", "Finish", "Inventory", "Name", "Set"]);
  expect((await cols("skip")).sort()).toEqual([
    "Card#",
    "Finish",
    "Inventory",
    "Name",
    "Reason",
    "Set",
  ]);
  // Grouped by set under desktop's label.
  await expect(section(page, "add").locator(".m-vgroup")).toHaveText("SOR — Spark of Rebellion");
  // Added rows carry desktop's information, owned → after per copy.
  const added = section(page, "add").locator(".m-vfyrow");
  await expect(added).toHaveCount(2);
  await expect(added.first().locator('[data-col="Card#"]')).toHaveText("87");
  await expect(added.first().locator('[data-col="Name"]')).toContainText("Darth Vader");
  await expect(added.first().locator('[data-col="Finish"]')).toHaveText("Standard");
  await expect(added.first().locator('[data-col="Set"]')).not.toBeEmpty();
  await expect(added.locator('[data-col="Inventory"]')).toHaveText(["1 → 2", "1 → 3"]);
  // The blocked copy: desktop's reason, inventory unchanged, no remove.
  const skipped = section(page, "skip").locator(".m-vfyrow");
  await expect(skipped).toHaveCount(1);
  await expect(skipped.locator('[data-col="Card#"]')).toHaveText("35");
  await expect(skipped.locator('[data-col="Reason"]')).toHaveText(
    "Inventory limit already reached."
  );
  await expect(skipped.locator('[data-col="Inventory"]')).toHaveText("3 → 3");
  await expect(skipped.locator(".m-vfyrow__remove")).toHaveCount(0);
  await expect(added.locator(".m-vfyrow__remove")).toHaveCount(2);
  // No Keep/Skip toggles, no steppers.
  await expect(s.locator(".m-seg, .m-step__qty, .m-stepper")).toHaveCount(0);
  // Footer: desktop's hint, Discard batch, Add N cards to vault.
  await expect(s.locator(".m-d2-verify__hint")).toHaveText("2 of 3 cards will be added.");
  await expect(s.locator(".m-d2-verify__commit")).toContainText("Add 2 cards to vault");
  await expect(s.locator(".m-d2-verify__discard")).toHaveText("Discard batch");
  // Destructive = red (--color-danger), never the text button's grey.
  await expect(s.locator(".m-d2-verify__discard")).toHaveCSS("color", "rgb(248, 113, 113)");
  // Section title colours: desktop green / aggression red.
  const colors = await s
    .locator(".ac-verify__section-title")
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  expect(colors).toEqual(["rgb(23, 138, 58)", "rgb(192, 32, 46)"]);
});

test("s3-12-one-row-per-copy", async ({ page }) => {
  await openPad(page, "#/pad?set=SOR");
  // The same number three times = three rows (two fit the keep-limit).
  await addTimes(page, 87, 3);
  await expect(page.locator(".m-logbtn__n")).toHaveText("3");
  await openVerify(page);
  await expect(sheet(page).locator(".m-vfyrow")).toHaveCount(3);
  await expect(section(page, "add").locator(".m-vfyrow")).toHaveCount(2);
  await expect(section(page, "skip").locator(".m-vfyrow")).toHaveCount(1);
  await expect(section(page, "skip").locator('[data-col="Name"]')).toContainText("Darth Vader");
});

test("s3-12-quick-remove-one-copy", async ({ page }) => {
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 3);
  await openVerify(page);
  const rm = section(page, "add").locator(".m-vfyrow__remove");
  const box = (await rm.first().boundingBox())!;
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  await expect(rm.first()).toHaveAttribute("aria-label", /Remove one Darth Vader, SOR 87/);
  // One tap drops exactly one copy; the blocked copy is re-admitted.
  await rm.first().click();
  await expect(sheet(page).locator(".m-sheet__sub")).toHaveText("2 cards in this batch");
  await expect(section(page, "add").locator(".m-vfyrow")).toHaveCount(2);
  await expect(section(page, "skip")).toHaveCount(0);
  await expect(sheet(page).locator(".m-d2-verify__commit")).toContainText("Add 2 cards to vault");
  await rm.first().click();
  await expect(section(page, "add").locator(".m-vfyrow")).toHaveCount(1);
  await expect(page.locator(".m-logbtn__n")).toHaveText("1");
});

test("s3-13-pinned-accordion-long-batch", async ({ page }) => {
  // 40 rows: 38 copies of SOR 87 (Standard limit raised to 50 -> all added)
  // and 2 of SOR 25 Tarkintown (a base, owned 1 of 1 -> not added).
  await raiseStandardLimit(page, 50);
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 25, 2);
  await addTimes(page, 87, 38);
  await expect(page.locator(".m-logbtn__n")).toHaveText("40");
  await openVerify(page);
  const v = sheet(page).locator(".m-verify");
  await expect(v).toHaveAttribute("data-mode", "accordion");
  const addHead = section(page, "add").locator(".m-vsec__head--btn");
  const skipHead = section(page, "skip").locator(".m-vsec__head--btn");
  await expect(addHead).toHaveAttribute("aria-expanded", "true");
  await expect(skipHead).toHaveAttribute("aria-expanded", "false");
  await expect(skipHead.locator(".ac-verify__count")).toHaveText("2 cards");
  const geo = async () =>
    page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const body = r(".m-sheet-layer--verify .m-sheet__body");
      const add = r('.m-vsec[data-section="add"] .m-vsec__head');
      const skip = r('.m-vsec[data-section="skip"] .m-vsec__head');
      const list = document.querySelector<HTMLElement>(
        '.m-vsec[data-section="add"] .m-vsec__list'
      )!;
      return {
        bodyTop: body.top,
        bodyBottom: body.bottom,
        addTop: add.top,
        skipTop: skip.top,
        skipBottom: skip.bottom,
        skipH: skip.height,
        listScrolls: list.scrollHeight > list.clientHeight + 1,
        bodyScrolls:
          document.querySelector(".m-sheet-layer--verify .m-sheet__body")!.scrollHeight >
          document.querySelector(".m-sheet-layer--verify .m-sheet__body")!.clientHeight + 1,
      };
    });
  const g = await geo();
  // Added header pinned at the top, not-added header pinned at the bottom,
  // the added list scrolls inside the panel (the body itself does not).
  expect(g.addTop - g.bodyTop).toBeLessThan(12);
  expect(g.bodyBottom - g.skipBottom).toBeLessThan(16);
  expect(g.skipH).toBeGreaterThanOrEqual(44);
  expect(g.listScrolls).toBe(true);
  expect(g.bodyScrolls).toBe(false);
  // Scrolling the added list leaves both headers where they are.
  await section(page, "add")
    .locator(".m-vsec__list")
    .evaluate((el) => el.scrollBy(0, 600));
  const g2 = await geo();
  expect(Math.round(g2.addTop)).toBe(Math.round(g.addTop));
  expect(Math.round(g2.skipTop)).toBe(Math.round(g.skipTop));
  // Tapping the not-added header expands it and collapses the other.
  await skipHead.click();
  await expect(skipHead).toHaveAttribute("aria-expanded", "true");
  await expect(addHead).toHaveAttribute("aria-expanded", "false");
  const skipList = section(page, "skip").locator(".m-vsec__list");
  await expect(skipList.locator(".m-vfyrow")).toHaveCount(2);
  await expect(skipList.locator('[data-col="Reason"]').first()).toBeVisible();
  const anim = await skipList.evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe("m-vsec-in");
  const g3 = await geo();
  expect(Math.round(g3.addTop)).toBe(Math.round(g.addTop));
  // ... and back.
  await addHead.click();
  await expect(addHead).toHaveAttribute("aria-expanded", "true");
  await expect(skipHead).toHaveAttribute("aria-expanded", "false");
});

test("s3-13-plain-scroll-when-fits", async ({ page }) => {
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 1);
  await addTimes(page, 35, 1);
  await openVerify(page);
  // Both sections, everything fits: a plain sheet, no pinned headers.
  await expect(sheet(page).locator(".m-verify")).toHaveAttribute("data-mode", "plain");
  await expect(sheet(page).locator(".m-vsec__head--btn")).toHaveCount(0);
  await expect(sheet(page).locator(".m-vsec")).toHaveCount(2);
});

test("s3-13-plain-scroll-one-section-long", async ({ page }) => {
  // Long, but only one section exists: a plain scroll, no pinning.
  await raiseStandardLimit(page, 50);
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 30);
  await openVerify(page);
  await expect(sheet(page).locator(".m-verify")).toHaveAttribute("data-mode", "plain");
  await expect(sheet(page).locator(".m-vsec__head--btn")).toHaveCount(0);
  const scrolls = await page
    .locator(".m-sheet-layer--verify .m-sheet__body")
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(scrolls).toBe(true);
});
