import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-14: the Vault status area, two rows (R5-3). rev4 r4-1-no-third-line-
// unfiltered / r4-1-no-overflow-narrowed-scoped / r4-1-row-order and
// vault-count-* / vault-clear-amber re-expressed for the two rows.
test.afterEach(measureEach);

test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone status rows");
});

const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
  set_code: string;
  variants: { source_set_code: string }[];
}[];
const ASH = CARDS.filter(
  (c) => c.set_code === "ASH" || c.variants.some((v) => v.source_set_code === "ASH")
).length;

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** Geometry of the two rows: every item's box, the rows' boxes. */
const rows = (p: Page) =>
  p.evaluate(() => {
    const box = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
    };
    const one = document.querySelector(".m-vault__searchrow")!;
    const two = document.querySelector(".m-vault__status")!;
    return {
      iw: innerWidth,
      one: box(one)!,
      two: box(two)!,
      oneKids: [...one.children].map((e) => e.classList[0]),
      twoKids: [...two.children]
        .filter((e) => !e.classList.contains("m-vault__sizelabel"))
        .map((e) => e.classList[0]),
      search: box(one.querySelector(".m-search"))!,
      clear: box(one.querySelector(".m-clearbtn")),
      filters: box(one.querySelector(".m-filterbtn"))!,
      count: box(two.querySelector(".m-count"))!,
      chip: box(two.querySelector(".m-scopechip"))!,
      sort: box(two.querySelector(".m-sortbtn"))!,
      toggle: box(two.querySelector(".m-viewseg"))!,
      chipFull: (() => {
        const t = two.querySelector(".m-scopechip__t") as HTMLElement;
        return t.scrollWidth <= t.clientWidth + 1;
      })(),
      chipText: two.querySelector(".m-scopechip__t")!.textContent,
    };
  });

type Rows = Awaited<ReturnType<typeof rows>>;

function expectFits(g: Rows) {
  // Row two: one line, every item inside the row and the viewport, no overlap.
  const items = [g.count, g.chip, g.sort, g.toggle];
  for (const it of items) {
    expect(it.t).toBeGreaterThanOrEqual(g.two.t - 0.5);
    expect(it.b).toBeLessThanOrEqual(g.two.b + 0.5);
    expect(it.r).toBeLessThanOrEqual(g.iw - 15.5);
    expect(it.l).toBeGreaterThanOrEqual(15.5);
  }
  for (let i = 1; i < items.length; i++)
    expect(items[i - 1].r).toBeLessThanOrEqual(items[i].l + 0.5);
  expect(g.two.h).toBeLessThanOrEqual(46.5);
  // Row one above row two, everything on one line.
  expect(g.one.b).toBeLessThanOrEqual(g.two.t + 0.5);
  for (const it of [g.search, g.filters, ...(g.clear ? [g.clear] : [])]) {
    expect(it.r).toBeLessThanOrEqual(g.iw - 15.5);
    expect(it.t).toBeGreaterThanOrEqual(g.one.t - 0.5);
    expect(it.b).toBeLessThanOrEqual(g.one.b + 0.5);
  }
  expect(g.chipFull).toBe(true);
}

for (const vw of [390, 430]) {
  test(`s1-14-two-rows-fit-${vw}`, async ({ page }, info) => {
    test.skip(info.project.name !== `phone-${vw}`, `${vw} only`);
    await openVault(page);
    const g = await rows(page);
    expect(g.iw).toBe(vw);
    expect(g.chipText).toBe("All finishes");
    expect(g.clear).toBeNull();
    expectFits(g);
  });
}

test("s1-14-no-overflow-narrowed-scoped", async ({ page }) => {
  await openVault(page, "#/vault?finish=Serialized%20Prestige&set=LAW");
  const g = await rows(page);
  expect(g.chipText).toBe("Ser. Prestige");
  expect(g.clear).not.toBeNull();
  expect(g.clear!.w).toBeGreaterThanOrEqual(44);
  expect(g.clear!.h).toBeGreaterThanOrEqual(44);
  expectFits(g);
  // The search box narrowed to make room for Clear (its slot is not reserved).
  expect(g.search.r).toBeLessThanOrEqual(g.clear!.l + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("s1-14-clear-only-when-narrowed", async ({ page }) => {
  // vault-count-unfiltered: the full count, not amber, no Clear.
  await openVault(page);
  const plain = await page.evaluate(() => {
    const c = document.querySelector(".m-count")!;
    return {
      text: c.textContent!.trim(),
      color: getComputedStyle(c).color,
      clear: !!document.querySelector(".m-clearbtn"),
    };
  });
  expect(plain).toEqual({
    text: `${CARDS.length} cards`,
    color: "rgb(159, 176, 204)",
    clear: false,
  });

  // vault-count-filtered + vault-clear-amber: the filtered count only, amber.
  await openVault(page, "#/vault?set=ASH");
  const f = await page.evaluate(() => {
    const c = document.querySelector(".m-count")!;
    const b = document.querySelector(".m-clearbtn")!;
    const r = b.getBoundingClientRect();
    const be = getComputedStyle(b, "::before");
    return {
      text: c.textContent!.trim(),
      color: getComputedStyle(c).color,
      clear: {
        w: r.width,
        h: r.height,
        line: be.borderTopColor,
        wash: be.backgroundColor,
        text: getComputedStyle(b).color,
      },
      badge: document.querySelector(".m-filterbtn__n")?.textContent,
      filtersOn: document.querySelector(".m-filterbtn")!.classList.contains("m-filterbtn--on"),
    };
  });
  expect(f.text).toBe(`${ASH} cards`);
  expect(f.text).not.toMatch(/of/i);
  expect(f.color).toBe("rgb(242, 193, 78)");
  expect(f.clear.w).toBeGreaterThanOrEqual(44);
  expect(f.clear.h).toBeGreaterThanOrEqual(44);
  expect(f.clear.line).toBe("rgba(217, 154, 31, 0.4)");
  expect(f.clear.wash).toBe("rgba(217, 154, 31, 0.16)");
  expect(f.clear.text).toBe("rgb(242, 193, 78)");
  expect(f.badge).toBe("1");
  expect(f.filtersOn).toBe(true);

  // Clear resets filters, search and scope.
  await openVault(page, "#/vault?set=ASH&finish=Hyperspace&q=luke");
  expect(await page.locator(".m-filterbtn__n").textContent()).toBe("3");
  await page.locator(".m-clearbtn").click();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    clear: !!document.querySelector(".m-clearbtn"),
    badge: !!document.querySelector(".m-filterbtn__n"),
    q: (document.querySelector(".m-search__input") as HTMLInputElement).value,
    chip: document.querySelector(".m-scopechip__t")!.textContent,
    scoped: document.querySelector(".m-scopechip")!.classList.contains("m-scopechip--on"),
    count: document.querySelector(".m-count")!.textContent!.trim(),
  }));
  expect(after).toEqual({
    clear: false,
    badge: false,
    q: "",
    chip: "All finishes",
    scoped: false,
    count: `${CARDS.length} cards`,
  });
});

test("s1-14-row-order", async ({ page }) => {
  await openVault(page, "#/vault?set=ASH");
  const g = await rows(page);
  expect(g.oneKids).toEqual(["m-search", "m-clearbtn", "m-filterbtn"]);
  expect(g.twoKids).toEqual(["m-count", "m-scopechip", "m-sortbtn", "m-seg"]);
  expect(g.search.r).toBeLessThanOrEqual(g.clear!.l + 0.5);
  expect(g.clear!.r).toBeLessThanOrEqual(g.filters.l + 0.5);
  expect(g.count.r).toBeLessThanOrEqual(g.chip.l + 0.5);
  expect(g.chip.r).toBeLessThanOrEqual(g.sort.l + 0.5);
  expect(g.sort.r).toBeLessThanOrEqual(g.toggle.l + 0.5);
  // The count is left-most; the toggle keeps the right edge.
  expect(Math.abs(g.count.l - 16)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.toggle.r - (g.iw - 16))).toBeLessThanOrEqual(1);
  // Search input is 16 px (no iOS zoom).
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".m-search__input")!).fontSize
    )
  ).toBe("16px");
});
