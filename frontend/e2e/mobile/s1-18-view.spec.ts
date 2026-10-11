import { expect, measureEach, scrollBy, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-18: the two-position view toggle and its in-place size pickers (rev4
// rows-sizes-open, gallery-sizes-open, gallery-gsize-param-1/3,
// rows-none-one-line, rows-size-lg-scrolled).
test.afterEach(measureEach);

test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone view toggle");
});

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row, .m-cell").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

const statusShows = (p: Page) =>
  p.evaluate(() => {
    const vis = (s: string) => {
      const e = document.querySelector(s);
      return !!e && getComputedStyle(e).display !== "none";
    };
    return {
      count: vis(".m-count"),
      chip: vis(".m-scopechip"),
      sort: vis(".m-sortbtn"),
      label: getComputedStyle(document.querySelector(".m-vault__sizelabel")!).opacity,
      labelText: document.querySelector(".m-vault__sizelabel")!.textContent,
    };
  });

test("s1-18-rows-sizes-open", async ({ page }) => {
  await openVault(page, "#/vault?view=rows");
  await page.locator(".m-viewseg__list").click();
  await page.waitForTimeout(200);
  expect(await page.locator(".m-viewseg--open-rows").count()).toBe(1);
  expect(await page.locator(".m-viewseg__sizes--rows .m-viewseg__size").count()).toBe(4);
  expect(await statusShows(page)).toEqual({
    count: false,
    chip: false,
    sort: false,
    label: "1",
    labelText: "Row size",
  });
  for (const [key, label] of [
    ["none", "No image"],
    ["sm", "Small"],
    ["md", "Medium"],
    ["lg", "Large"],
  ]) {
    if (!(await page.locator(".m-viewseg--open-rows").count()))
      await page.locator(".m-viewseg__list").click();
    await page.locator(`.m-viewseg__size[aria-label^="Rows: ${label}"]`).click();
    await page.waitForTimeout(250);
    expect(await page.locator(`.m-row--t-${key}`).count()).toBeGreaterThan(0);
    expect(await page.locator(".m-viewseg--open-rows").count()).toBe(0);
  }
  expect((await statusShows(page)).count).toBe(true);
});

test("s1-18-gallery-sizes-open", async ({ page }) => {
  await openVault(page, "#/vault?view=gallery");
  await page.locator(".m-viewseg__gal").click();
  await page.waitForTimeout(200);
  expect(await page.locator(".m-viewseg--open-gal").count()).toBe(1);
  expect(await page.locator(".m-viewseg--open-rows").count()).toBe(0);
  expect((await statusShows(page)).labelText).toBe("Cards across");
  for (const n of [1, 2, 3]) {
    if (!(await page.locator(".m-viewseg--open-gal").count()))
      await page.locator(".m-viewseg__gal").click();
    await page
      .locator(`.m-viewseg__gsize[aria-label^="Gallery: ${{ 1: "One", 2: "Two", 3: "Three" }[n]}"]`)
      .click();
    await page.waitForTimeout(300);
    expect(await page.locator(`.m-grid--g${n}`).count()).toBe(1);
    expect(await page.locator(".m-viewseg--open-gal").count()).toBe(0);
    const cols = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".m-gline")!).gridTemplateColumns.split(" ").length
    );
    expect(cols).toBe(n);
  }
});

for (const n of [1, 3]) {
  test(`s1-18-gallery-gsize-${n}`, async ({ page }) => {
    await openVault(page, `#/vault?view=gallery&gsize=${n}`);
    const r = await page.evaluate(() => ({
      grid: document.querySelector(".m-grid")!.className,
      first: document.querySelector(".m-gline")!.querySelectorAll(".m-cell").length,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(r.grid).toContain(`m-grid--g${n}`);
    expect(r.first).toBe(n);
    expect(r.overflow).toBe(false);
  });
}

test("s1-18-rows-none-one-line", async ({ page }) => {
  await openVault(page, "#/vault?view=rows&size=none");
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".m-row--line")].slice(0, 12);
    return {
      n: rows.length,
      maxH: Math.max(...rows.map((e) => e.getBoundingClientRect().height)),
      thumb: !!document.querySelector(".m-row--line .m-row__thumb"),
      // One line: the name and the price share a vertical band.
      sameLine: rows.every((e) => {
        const a = e.querySelector(".m-row__name")!.getBoundingClientRect();
        const b = e.querySelector(".m-row__price")!.getBoundingClientRect();
        return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 6;
      }),
    };
  });
  expect(r.n).toBe(12);
  expect(r.maxH).toBeLessThanOrEqual(50);
  expect(r.thumb).toBe(false);
  expect(r.sameLine).toBe(true);
});

test("s1-18-rows-size-lg-scrolled", async ({ page }) => {
  await openVault(page, "#/vault?view=rows&size=lg");
  await scrollBy(page, ".m-vault__scroll", 700);
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".m-row--t-lg")];
    const thumbs = rows.map((e) => e.querySelector(".m-row__thumb")!.getBoundingClientRect());
    return {
      n: rows.length,
      thumbW: Math.round(thumbs[0].width),
      thumbH: Math.round(thumbs[0].height),
      collapsed: !!document.querySelector(".m-vh--collapsed"),
      overlap: rows.some(
        (e, i) =>
          i > 0 && e.getBoundingClientRect().top < rows[i - 1].getBoundingClientRect().bottom - 0.5
      ),
    };
  });
  expect(r.n).toBeGreaterThan(3);
  expect([r.thumbW, r.thumbH]).toEqual([92, 129]);
  expect(r.collapsed).toBe(true);
  expect(r.overlap).toBe(false);
});

test("s1-18-toggle-targets-44", async ({ page }) => {
  await openVault(page);
  const closed = await page.evaluate(() =>
    [...document.querySelectorAll(".m-viewseg button")]
      .filter((b) => getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0)
      .map((b) => [
        Math.round(b.getBoundingClientRect().width),
        Math.round(b.getBoundingClientRect().height),
      ])
  );
  expect(closed).toHaveLength(2);
  for (const [w, h] of closed) expect(w >= 44 && h >= 44).toBe(true);
  await page.locator(".m-viewseg__list").click();
  await page.waitForTimeout(200);
  const open = await page.evaluate(() =>
    [...document.querySelectorAll(".m-viewseg button")]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => b.getBoundingClientRect())
      .map((r) => [r.width, r.height, r.right])
  );
  expect(open).toHaveLength(6);
  for (const [w, h, right] of open) {
    expect(w).toBeGreaterThanOrEqual(44);
    expect(h).toBeGreaterThanOrEqual(44);
    expect(right).toBeLessThanOrEqual(page.viewportSize()!.width - 15.5);
  }
  // View + size are remembered for the session (a reload keeps them).
  await page.locator('.m-viewseg__size[aria-label^="Rows: Large"]').click();
  await page.locator(".m-viewseg__gal").click();
  await page.waitForTimeout(200);
  await page.reload();
  await expect(page.locator(".m-cell").first()).toBeVisible();
  await page.locator(".m-viewseg__list").click();
  await page.waitForTimeout(250);
  expect(await page.locator(".m-row--t-lg").count()).toBeGreaterThan(0);
});
