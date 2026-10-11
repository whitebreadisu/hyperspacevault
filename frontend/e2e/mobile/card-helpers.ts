import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect } from "./helpers";

// BL-248 stage 2A-1: shared helpers for the card-detail specs (s2-01 ..).

export interface FxVariant {
  variant_id: number;
  variant_type: string;
  finish: string | null;
  source_set_code: string;
  card_number: string;
  front_image_url: string | null;
  back_image_url: string | null;
  price: { market: number | null; low: number | null } | null;
}
export interface FxCard {
  id: number;
  set_code: string;
  base_card_number: string;
  name: string;
  type: string;
  variants: FxVariant[];
}
export const CARDS = JSON.parse(
  readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")
) as FxCard[];
export const QTY = new Map(
  (
    JSON.parse(readFileSync("e2e/mobile/fixtures/quantities.json", "utf8")) as {
      variant_id: number;
      quantity: number;
    }[]
  ).map((q) => [q.variant_id, q.quantity])
);
export const byNum = (set: string, n: string | number) =>
  CARDS.find((c) => c.set_code === set && c.base_card_number === String(n))!;
export const fin = (v: FxVariant) => v.finish ?? v.variant_type;

export const detailScroll = ".m-detail__scroll";

/** Open the Vault and wait for rows. */
export async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** Scroll the virtualised list until the card's row is rendered; tap it. */
export async function tapRow(page: Page, id: number) {
  const sel = `.m-row[data-card="${id}"]`;
  for (let i = 0; i < 80 && !(await page.locator(sel).count()); i++) {
    await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop += 240));
    await page.waitForTimeout(60);
  }
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.locator(sel).click();
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  await page.waitForTimeout(250);
}

/** Open a card's detail straight from the Vault (row tap). */
export async function openCard(page: Page, set: string, n: string | number, vaultHash = "#/vault") {
  await openVault(page, vaultHash);
  const c = byNum(set, n);
  await tapRow(page, c.id);
  return c;
}

/** The detail's scroll container, scrolled in finger-like steps. */
export async function scrollDetail(page: Page, total: number) {
  for (let i = 1; i <= 6; i++) {
    await page
      .locator(detailScroll)
      .first()
      .evaluate((e, d) => void (e.scrollTop += d), total / 6);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(420);
}
