import type { Page } from "@playwright/test";
import { expect } from "./helpers";

// BL-249 stage 3a: shared helpers for the tool / keypad specs (s3-0x),
// ports of the rev4 check script's `key` / `typeNum` (mobile-check-rev4.mjs:
// 182-185) against the real app.

/** Open the keypad layer (directly, or through a review hash) and wait. */
export async function openPad(page: Page, hash = "#/pad") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** Tap one key by its accessible name ("1", "Delete digit", "Clear number"). */
export async function key(page: Page, name: string) {
  await page.locator(`.m-keys .m-key[aria-label="${name}"]`).click();
}

export async function typeNum(page: Page, n: number | string) {
  for (const d of String(n)) await key(page, d);
}

/** Heights of a key and the number field, whether the deck is shrunk
 * (BL-270: only by the user, with the fold tab) and whether the tab shows. */
export async function deckMetrics(page: Page) {
  return page.evaluate(() => {
    const k = document.querySelector(".m-key")!;
    return {
      key: Math.round(k.getBoundingClientRect().height),
      num: Math.round(document.querySelector(".m-padnum")!.getBoundingClientRect().height),
      deck: Math.round(document.querySelector(".m-pad__deck")!.getBoundingClientRect().height),
      compact: !!document.querySelector(".m-pad--compact"),
      tab: !!document.querySelector(".m-padfold__tab"),
      tr: getComputedStyle(k).transitionProperty,
    };
  });
}

/** BL-270: the fold tab ("Shrink keypad" / "Restore keypad"). */
export function foldTab(page: Page) {
  return page.locator(".m-padfold__tab");
}

/** Choose a set through the "Choose a set" sheet (opens the Set chooser,
 * switches to Show all sets when asked). */
export async function pickSet(page: Page, code: string, all = false) {
  await page.locator(".m-pad__entry .m-padset").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-set"]').click();
  if (all && (await page.locator(".m-setpick").getAttribute("data-view")) !== "all")
    await page.locator(".m-setpick__all").click();
  await page.locator(`.m-setpick__row[data-code="${code}"]`).click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
}

// ── BL-249 stage 3c: batch + Verify cards helpers ─────────────────────────

/** Type a number and add it to the batch `times` times (Add to batch, then
 * the "Add another" button the panel shows after an add). */
export async function addTimes(page: Page, n: number | string, times = 1) {
  await key(page, "Clear number");
  await typeNum(page, n);
  const add = page.locator(".m-ident__add .swu-btn");
  await expect(add).toContainText("Add to batch");
  for (let i = 0; i < times; i++) {
    await add.click();
    await expect(add).toContainText("Add another");
  }
}

/** Open the Verify cards sheet from the entry row's Verify button. */
export async function openVerify(page: Page) {
  await page.locator(".m-pad__entry .m-logbtn").click();
  await expect(page.locator(".m-sheet-layer--verify")).toBeVisible();
  await page.waitForTimeout(250);
}

/** Hard-cap limits with the non-singleton Standard bucket raised to `max`
 * (a long batch of one printing then stays admitted). */
export async function raiseStandardLimit(page: Page, max: number) {
  const { readFileSync } = await import("node:fs");
  const limits = JSON.parse(readFileSync("e2e/mobile/fixtures/limits.json", "utf8")) as {
    limits: { type_category: string; limit_bucket: string; max_quantity: number }[];
  };
  for (const l of limits.limits)
    if (l.type_category === "standard" && l.limit_bucket === "Standard") l.max_quantity = max;
  await page.route(
    (u) => u.pathname === "/api/settings/limits",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(limits) })
  );
}
