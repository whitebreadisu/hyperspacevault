import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";
import { byNum, fin, openCard, openVault, QTY, scrollDetail } from "./card-helpers";

// S2-10 (R5-1): Owned by finish -- opened from the Vault row's price +
// playset cluster and from the card detail's plate. Head = the card's
// count chip + pips as the Vault row (unscoped); one row per printing,
// owned or not, each with its own neutral chip + pips sized to the playset
// (0 = zero chip + empty grey pips; short = amber filled; at a playset =
// green pips inside the amber plate); words line + Open card stay; the
// "other printings not owned" footer is gone. Literals = cards.css (the
// s2-03 table).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const T = {
  text: "rgb(230, 230, 230)",
  surf: "rgb(15, 21, 40)",
  border: "rgb(30, 39, 72)",
  muted: "rgb(107, 122, 153)",
  green: "rgb(23, 138, 58)",
  amber: "rgb(217, 154, 31)",
  amberLine: "rgba(217, 154, 31, 0.6)",
  amberWash: "rgba(217, 154, 31, 0.08)",
  none: "rgba(0, 0, 0, 0)",
};

async function findRow(page: Page, id: number) {
  const sel = `.m-row[data-card="${id}"]`;
  // PORT (BL-258): start from the top -- newest-first puts ASH above SOR.
  await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop = 0));
  await page.waitForTimeout(100);
  for (let i = 0; i < 80 && !(await page.locator(sel).count()); i++) {
    await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop += 240));
    await page.waitForTimeout(60);
  }
  await page.locator(sel).scrollIntoViewIfNeeded();
  return page.locator(sel);
}

const readSheet = (page: Page) =>
  page.evaluate(() => {
    const read = (el: Element) => {
      const chip = el.querySelector(".playset-chip")!;
      const cs = getComputedStyle(chip);
      const box = getComputedStyle(el.querySelector(".playset__pips")!);
      return {
        chip: chip.textContent,
        chipColor: cs.color,
        chipBorder: cs.borderTopColor,
        chipBg: cs.backgroundColor,
        plate: [box.borderTopColor, box.backgroundColor],
        pips: [...el.querySelectorAll(".playset__pip")].map((p) => {
          const ps = getComputedStyle(p);
          return [ps.width, ps.backgroundColor, ps.borderTopColor];
        }),
      };
    };
    const layer = document.querySelector(".m-sheet-layer--finish")!;
    return {
      title: layer.querySelector(".m-sheet__title")!.textContent,
      label: layer.querySelector(".m-dossier__label")!.textContent,
      head: read(layer.querySelector(".m-dossier__head .playset")!),
      rows: [...layer.querySelectorAll(".m-dossier__row")].map((r) => ({
        id: Number((r as HTMLElement).dataset.variant),
        finish: r.querySelector(".m-dossier__finish")!.textContent,
        num: r.querySelector(".m-dossier__num")!.textContent,
        h: r.getBoundingClientRect().height,
        ...read(r.querySelector(".playset")!),
      })),
      foot: layer.querySelector(".m-dossier__foot")?.textContent ?? null,
      text: (layer as HTMLElement).innerText,
      open: !!layer.querySelector(".m-dossier__open .swu-btn"),
    };
  });

type Row = Awaited<ReturnType<typeof readSheet>>["rows"][number];
function expectRow(r: Row, q: number) {
  // The printing's own chip: neutral white at every count.
  expect(r.chip).toBe(String(q));
  expect(r.chipColor).toBe(T.text);
  expect(r.chipBorder).toBe(T.border);
  expect(r.chipBg).toBe(T.surf);
  const complete = q >= 3;
  // The amber-outlined plate only at a playset (playset__pips--scoped-complete).
  expect(r.plate[0] === T.amberLine && r.plate[1] === T.amberWash).toBe(complete);
  expect(r.pips).toHaveLength(3);
  r.pips.forEach(([w, fill, line], i) => {
    const on = i < Math.min(q, 3);
    expect(w).toBe("10px");
    const want = !on ? T.none : complete ? T.green : T.amber;
    expect(fill).toBe(want);
    expect(line).toBe(on ? want : q === 0 ? T.border : T.muted);
  });
}

test("s2-10-owned-by-finish-rows", async ({ page }) => {
  await openVault(page);
  for (const [set, n, total, words] of [
    ["SOR", 87, 2, "1 short of a playset"],
    ["ASH", 52, 3, "Playset complete"],
  ] as const) {
    const c = byNum(set, n);
    const row = await findRow(page, c.id);
    await row.locator(".m-row__own").click();
    await expect(page.locator(".m-sheet-layer--finish")).toBeVisible();
    await page.waitForTimeout(250);
    const s = await readSheet(page);
    expect(s.title).toBe(c.name);
    expect(s.label).toBe("Owned by finish");
    // Head = the Vault row's chip + pips, unscoped (all-printings total).
    expect(s.head.chip).toBe(String(total));
    expect(s.head.chipColor).toBe(total >= 3 ? T.green : T.text);
    // Every printing, owned or not, in desktop's rail order.
    expect(s.rows.map((r) => r.id).sort()).toEqual(c.variants.map((v) => v.variant_id).sort());
    expect(s.rows[0].finish).toBe("Standard");
    for (const r of s.rows) {
      const v = c.variants.find((x) => x.variant_id === r.id)!;
      expect(r.num).toBe(`${v.source_set_code} ${v.card_number}`);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expectRow(r, QTY.get(v.variant_id) ?? 0);
    }
    expect(s.foot).toBe(words);
    expect(s.text).not.toMatch(/not owned/i);
    expect(s.text).not.toMatch(/\d\s*\/\s*\d/);
    expect(s.open).toBe(true);
    await page.locator(".m-sheet-layer--finish .m-sheet__close").click();
    await expect(page.locator(".m-sheet-layer--finish")).toHaveCount(0);
  }
});

test("s2-10-opens-from-row-and-plate", async ({ page }) => {
  // From the row: Open card opens the detail on the row's printing.
  await openVault(page, "#/vault?finish=Hyperspace");
  const c = byNum("SOR", 87);
  const row = await findRow(page, c.id);
  await row.locator(".m-row__own").click();
  await expect(page.locator(".m-sheet-layer--finish")).toBeVisible();
  await page.locator(".m-dossier__open .swu-btn").click();
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  await expect(page.locator(".m-sheet-layer--finish")).toHaveCount(0);
  const hs = c.variants.find((v) => fin(v) === "Hyperspace")!;
  await expect(page.locator(".m-print.cp-rail__item--active")).toHaveAttribute(
    "data-variant",
    String(hs.variant_id)
  );
  // From the plate (expanded, then collapsed): the same sheet, no Open card
  // (the card is already open); a stepper change shows at once.
  await page.locator(".m-dreg3__own .m-plate-hit--btn").click();
  await expect(page.locator(".m-sheet-layer--finish")).toBeVisible();
  expect(await page.locator(".m-dossier__open").count()).toBe(0);
  await expect(page.locator(".m-sheet-layer--finish .m-sheet__title")).toHaveText(c.name);
  await page.locator(".m-sheet-layer--finish .m-sheet__close").click();
  await expect(page.locator(".m-sheet-layer--finish")).toHaveCount(0);
  await scrollDetail(page, 300);
  await expect(page.locator(".m-dreg3--collapsed")).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator(".m-dreg3__mini .m-plate-hit--btn").click();
  await expect(page.locator(".m-sheet-layer--finish")).toBeVisible();
  const s = await readSheet(page);
  expect(s.rows).toHaveLength(c.variants.length);
});

test("s2-10-x-top-right", async ({ page }) => {
  await openCard(page, "ASH", 52);
  await page.locator(".m-dreg3__own .m-plate-hit--btn").click();
  const layer = page.locator(".m-sheet-layer--finish");
  await expect(layer).toBeVisible();
  const x = await layer.locator(".m-sheet__close").boundingBox();
  const iw = await page.evaluate(() => innerWidth);
  expect(x!.x + x!.width).toBeGreaterThan(iw - 30);
  expect(Math.round(x!.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(x!.height)).toBeGreaterThanOrEqual(44);
  await layer.locator(".m-sheet__close").click();
  await expect(layer).toHaveCount(0);
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
});
