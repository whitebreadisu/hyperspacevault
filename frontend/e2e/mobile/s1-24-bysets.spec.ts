import { buildSetBreakdown } from "../../src/utils/completion";
import { applyFilters, DEFAULT_FILTERS } from "../../src/utils/filters";
import type { BaseCard } from "../../src/utils/catalog";
import type { InventoryCard } from "../../src/utils/inventory";
import { inventoryCards, ORDERED_BASE_SETS, whole } from "./fixture-cards";
import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-24: Completion by set (rev4 vault-sets-sheet, vault-sets-sheet-low,
// r4-11-byset-seg-34, vault-set-from-bysets, b2-byset-narrows). Rows =
// desktop buildSetBreakdown over every narrowing except the Set facet.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone by-set sheet");
});

const ALL = inventoryCards();

async function open(page: Page, hash: string) {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}

const rowsShown = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll(".m-setrow--r2")].map((r) => ({
      set: (r as HTMLElement).dataset.set,
      vals: [...r.querySelectorAll(".m-bys__v")].map((v) => v.textContent!.trim()),
    }))
  );

function expectedRows(cards: InventoryCard[], mode: "market" | "low" = "market") {
  return buildSetBreakdown(cards, ORDERED_BASE_SETS, mode).map((r) => ({
    set: r.code,
    vals: [`${r.playsetPct}%`, r.totalCopies.toLocaleString("en-US"), whole(r.value)],
  }));
}

test("s1-24-sets-sheet", async ({ page }) => {
  await open(page, "#/vault?sheet=sets");
  await expect(page.locator(".m-sheet")).toBeVisible();
  await expect(page.locator("#sheet-sets")).toHaveText("Completion by set");
  const rows = await rowsShown(page);
  expect(rows.length).toBeGreaterThanOrEqual(5);
  expect(rows).toEqual(expectedRows(ALL));
  await expect(page.locator(".m-bysets__note")).toHaveText("Your whole collection");
  await expect(page.locator(".m-bysets__top .m-seg")).toHaveCount(1);
  const text = await page.locator(".m-sheet").innerText();
  expect(text).not.toMatch(/playsets complete| of \d+ playsets|\d+\/\d+/i);
  // Set images: one per row, the desktop asset path.
  const srcs = await page
    .locator(".m-setrow__logo")
    .evaluateAll((els) => els.map((e) => (e as HTMLImageElement).getAttribute("src")));
  expect(srcs).toEqual(rows.map((r) => `/images/set_${r.set}.png`));
});

test("s1-24-sets-sheet-low", async ({ page }) => {
  await open(page, "#/vault?sheet=sets");
  const market = expectedRows(ALL);
  const low = expectedRows(ALL, "low");
  expect(low).not.toEqual(market);
  await page.locator(".m-bysets__top .m-seg__btn", { hasText: "Low" }).click();
  await page.waitForTimeout(200);
  expect(await rowsShown(page)).toEqual(low);
  // The sheet drives the one shared price kind (the header follows).
  expect(await page.evaluate(() => localStorage.getItem("swu.cardsValue.kind"))).toBe("low");
  await expect(page.locator(".m-summary__head .m-priceseg .m-seg__btn--on")).toHaveText("Low");
});

test("s1-24-byset-seg-34", async ({ page }) => {
  // Narrowed, so the header shows its amber Totals switch; the sheet's
  // segment stays neutral.
  await open(page, "#/vault?set=ASH&sheet=sets");
  const r = await page.evaluate(() => {
    const seg = document.querySelector(".m-bysets__top .m-seg")!;
    const head = document.querySelector(".m-summary__head .m-priceseg")!;
    const drawn = (s: Element) => {
      const b = getComputedStyle(s, "::before");
      return Math.round(
        s.getBoundingClientRect().height - parseFloat(b.top) - parseFloat(b.bottom)
      );
    };
    const sizes = (s: Element) =>
      [...s.querySelectorAll(".m-seg__btn")].map((b) => {
        const x = b.getBoundingClientRect();
        return [Math.round(x.width), Math.round(x.height)];
      });
    return {
      drawn: drawn(seg),
      head: drawn(head),
      border: getComputedStyle(seg).borderTopWidth,
      btns: sizes(seg),
      hbtns: sizes(head),
      on: getComputedStyle(seg.querySelector(".m-seg__btn--on")!, "::before").backgroundColor,
      outline: getComputedStyle(seg, "::before").borderTopColor,
      amber: seg.classList.contains("m-seg--amber"),
    };
  });
  expect(r.drawn).toBe(34);
  expect(r.head).toBe(34);
  expect(r.border).toBe("0px");
  for (const [w, h] of r.btns) {
    expect(w).toBeGreaterThanOrEqual(44);
    expect(h).toBeGreaterThanOrEqual(44);
  }
  expect(r.btns).toEqual(r.hbtns);
  expect(r.on).toBe("rgba(37, 99, 235, 0.35)");
  expect(r.outline).toBe("rgba(30, 39, 72, 0.9)");
  expect(r.amber).toBe(false);
});

test("s1-24-set-from-bysets", async ({ page }) => {
  // vault-set-from-bysets: the panel opens the sheet; a row writes the Set
  // facet, closes the sheet and narrows the Vault.
  await open(page, "#/vault");
  await page.locator(".m-summary__body").click();
  await expect(page.locator(".m-sheet")).toBeVisible();
  const first = ORDERED_BASE_SETS[0].code;
  await page.locator(".m-setrow").first().click();
  await expect(page.locator(".m-sheet")).toHaveCount(0);
  const n = ALL.filter((c) => c.set_code === first).length;
  await expect(page.locator(".m-count")).toHaveText(`${n} cards`);
  await expect(page.locator(".m-count")).toHaveCSS("color", "rgb(242, 193, 78)");
  await expect(page.locator(".m-filterbtn__n")).toHaveText("1");
  await expect(page.locator(".m-clearbtn")).toBeVisible();
  // Reopened, the picked set reads selected.
  await page.locator(".m-summary__body").click();
  await expect(page.locator(`.m-setrow[data-set="${first}"]`)).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("s1-24-byset-narrows", async ({ page }) => {
  // b2-byset-narrows: the rows follow every filter except Set, so the scope
  // narrows them; a row tap writes the Set facet and keeps the scope.
  await open(page, "#/vault?finish=Hyperspace&sheet=sets");
  const universe = applyFilters(ALL as BaseCard[], {
    ...DEFAULT_FILTERS,
    finish: new Set(["Hyperspace"]),
  }) as InventoryCard[];
  expect(universe.length).toBeLessThan(ALL.length);
  await expect(page.locator(".m-bysets__note")).toHaveText("Rows follow your other filters");
  expect(await rowsShown(page)).toEqual(expectedRows(universe));
  await page.locator(".m-setrow").first().click();
  await expect(page.locator(".m-sheet")).toHaveCount(0);
  await expect(page.locator(".m-scopechip")).toHaveClass(/m-scopechip--on/);
  await expect(page.locator(".m-filterbtn__n")).toHaveText("2");
});

test("s1-24-sheet-param-hashchange", async ({ page }) => {
  // ?sheet=sets reached by an in-app hash change (no remount) opens it too.
  await open(page, "#/vault?set=ASH");
  await page.evaluate(() => (location.hash = "#/vault?set=ASH&sheet=sets"));
  await expect(page.locator(".m-sheet #sheet-sets")).toBeVisible();
});
