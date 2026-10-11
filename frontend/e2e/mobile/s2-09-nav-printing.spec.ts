import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";
import { CARDS, fin } from "./card-helpers";

// S2-09: prev / next open the neighbour on ITS entry printing as the list
// it came from would show it (rev4 M.navEntry; desktop BL-193 / BL-201):
// from scoped rows the scoped printing (rev4 b2-detail-next-scoped), from a
// gallery the printing the neighbour's cell displays.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const activeVariant = (page: Page) =>
  page.locator(".m-print.cp-rail__item--active").getAttribute("data-variant").then(Number);
const currentCard = (page: Page) =>
  page.evaluate(() => Number(location.hash.split("/")[2].split("?")[0]));

test("s2-09-next-opens-matching-printing", async ({ page }) => {
  // Rows, scoped Hyperspace, SOR only (b2-detail-next-scoped).
  await page.goto("/#/vault?finish=Hyperspace&set=SOR");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.waitForTimeout(200);
  await page.locator(".m-row .m-row__main").first().click();
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  await expect(page.locator(".m-hdr__pos")).toHaveText(/^1 of /);
  await page.evaluate(() =>
    (document.querySelector('[aria-label="Next card"]') as HTMLButtonElement).click()
  );
  await expect(page.locator(".m-hdr__pos")).toHaveText(/^2 of /);
  await page.waitForTimeout(200);
  let id = await currentCard(page);
  let c = CARDS.find((x) => x.id === id)!;
  const act = await activeVariant(page);
  expect(fin(c.variants.find((x) => x.variant_id === act)!)).toBe("Hyperspace");
  // The first Hyperspace printing (desktop scopedVariant), no "?v=" needed.
  expect(act).toBe(c.variants.find((x) => fin(x) === "Hyperspace")!.variant_id);
  expect(await page.evaluate(() => location.hash)).not.toContain("?v=");
  // Back to the first: again on its Hyperspace printing.
  await page.evaluate(() =>
    (document.querySelector('[aria-label="Previous card"]') as HTMLButtonElement).click()
  );
  await expect(page.locator(".m-hdr__pos")).toHaveText(/^1 of /);
  await page.waitForTimeout(200);
  id = await currentCard(page);
  c = CARDS.find((x) => x.id === id)!;
  const back = await activeVariant(page);
  expect(fin(c.variants.find((x) => x.variant_id === back)!)).toBe("Hyperspace");
});

test("s2-09-gallery-next-opens-displayed-printing", async ({ page }) => {
  // Gallery, Finish facet Hyperspace (written by the scope): each cell shows
  // the lowest-numbered Hyperspace printing; Next lands on the printing the
  // neighbour's cell displays.
  await page.goto("/#/vault?view=gallery&finish=Hyperspace&set=SOR");
  await expect(page.locator(".m-cell").first()).toBeVisible();
  await page.waitForTimeout(200);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll(".m-cell")].slice(0, 3).map((e) => ({
      card: Number((e as HTMLElement).dataset.card),
      shown: Number((e as HTMLElement).dataset.shown),
    }))
  );
  await page.locator(".m-cell").first().click();
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  expect(await activeVariant(page)).toBe(shown[0].shown);
  for (const k of [1, 2]) {
    await page.evaluate(() =>
      (document.querySelector('[aria-label="Next card"]') as HTMLButtonElement).click()
    );
    await expect(page.locator(".m-hdr__pos")).toHaveText(new RegExp(`^${k + 1} of `));
    await page.waitForTimeout(200);
    expect(await currentCard(page)).toBe(shown[k].card);
    expect(await activeVariant(page)).toBe(shown[k].shown);
  }
});
