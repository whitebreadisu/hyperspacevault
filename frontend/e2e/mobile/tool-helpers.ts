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

/** Heights of a key and the number field, and whether the deck is shrunk. */
export async function deckMetrics(page: Page) {
  return page.evaluate(() => {
    const k = document.querySelector(".m-key")!;
    return {
      key: Math.round(k.getBoundingClientRect().height),
      num: Math.round(document.querySelector(".m-padnum")!.getBoundingClientRect().height),
      deck: Math.round(document.querySelector(".m-pad__deck")!.getBoundingClientRect().height),
      result: !!document.querySelector(".m-pad--result"),
      tr: getComputedStyle(k).transitionProperty,
    };
  });
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
