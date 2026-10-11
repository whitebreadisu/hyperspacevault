import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-17: the icon-only Sort and its sheet (rev4 vault-sort-sheet,
// r4-1-sort-icon-only, b2-row-sort-scoped, b2-sort-scoped-across-sets).
test.afterEach(measureEach);

test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone sort");
});

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

const names = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll(".m-row .m-row__name")].map((e) => e.textContent!)
  );

test("s1-17-sort-sheet", async ({ page }) => {
  await openVault(page);
  await page.locator(".m-sortbtn").click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".m-sheet-layer--sort .m-choice__row")];
    return {
      title: document.querySelector(".m-sheet-layer--sort .m-sheet__title")!.textContent,
      labels: rows.map((b) => b.querySelector("span")!.textContent),
      on: rows.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent),
      minH: Math.min(...rows.map((b) => b.getBoundingClientRect().height)),
    };
  });
  expect(r.title).toBe("Sort");
  // Desktop's sortable columns, named as its table headers.
  expect(r.labels).toEqual([
    "#",
    "Name",
    "Variants",
    "Playset",
    "Value",
    "Rarity",
    "Cost",
    "Power",
    "HP",
    "Set",
  ]);
  expect(r.on).toEqual(["#"]);
  expect(r.minH).toBeGreaterThanOrEqual(44);
});

test("s1-17-sort-icon-only", async ({ page }) => {
  await openVault(page, "#/vault?size=none");
  const b = await page.evaluate(() => {
    const e = document.querySelector(".m-vault__status .m-sortbtn")!;
    const r = e.getBoundingClientRect();
    return {
      text: e.textContent!.trim(),
      svg: !!e.querySelector("svg"),
      label: e.getAttribute("aria-label"),
      w: r.width,
      h: r.height,
    };
  });
  expect(b).toEqual({ text: "", svg: true, label: "Sort: #, ascending", w: 44, h: 44 });
  // A new column lands ascending (nextSortState) and the sheet closes.
  await page.locator(".m-sortbtn").click();
  await page.waitForTimeout(300);
  await page.locator('.m-choice__row[data-sort="name"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator(".m-sheet-layer").count()).toBe(0);
  expect(await page.locator(".m-sortbtn").getAttribute("aria-label")).toBe("Sort: Name, ascending");
  expect((await page.locator(".m-sortbtn").textContent())!.trim()).toBe("");
  const asc = await names(page);
  expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
  // The active column flips direction.
  await page.locator(".m-sortbtn").click();
  await page.waitForTimeout(300);
  await page.locator('.m-choice__row[data-sort="name"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator(".m-sortbtn").getAttribute("aria-label")).toBe(
    "Sort: Name, descending"
  );
  const desc = await names(page);
  expect(desc[0].localeCompare(desc[desc.length - 1])).toBeGreaterThan(0);
});

test("s1-17-sort-scoped", async ({ page }) => {
  // b2-row-sort-scoped: default order = scoped-number order within the set.
  await openVault(page, "#/vault?finish=Hyperspace&set=SOR&size=none");
  const one = await page.evaluate(() => {
    const nums = [...document.querySelectorAll(".m-row .m-row__num")].map((e) => e.textContent!);
    return { nums, scoped: document.querySelectorAll(".m-row__num--scoped").length };
  });
  const n = one.nums.map((s) => parseInt(s.split(" ").pop()!, 10));
  expect(n.length).toBeGreaterThan(2);
  expect(n.every((x, i) => i === 0 || x >= n[i - 1])).toBe(true);
  expect(one.scoped).toBe(n.length);

  // b2-sort-scoped-across-sets: contiguous set groups, ordered inside each.
  await openVault(page, "#/vault?finish=Hyperspace&set=SOR,ASH&size=none");
  const r = await page.evaluate(() =>
    [...document.querySelectorAll(".m-row")].map((row) => {
      // Group by the card's set (a SORP printing still belongs to SOR's group).
      const e = row.querySelector(".m-row__num")!;
      const num = e.textContent!.trim().split(" ").pop()!;
      return {
        set: (row as HTMLElement).dataset.set!,
        n: parseInt(num, 10),
        scoped: e.classList.contains("m-row__num--scoped"),
      };
    })
  );
  const groups: { set: string; ns: number[] }[] = [];
  for (const x of r) {
    if (!groups.length || groups[groups.length - 1].set !== x.set)
      groups.push({ set: x.set, ns: [] });
    groups[groups.length - 1].ns.push(x.n);
  }
  expect(groups.length).toBeGreaterThanOrEqual(2);
  expect(new Set(groups.map((g) => g.set)).size).toBe(groups.length);
  for (const g of groups) expect(g.ns.every((x, i) => i === 0 || x >= g.ns[i - 1])).toBe(true);
  expect(r.every((x) => x.scoped)).toBe(true);
});
