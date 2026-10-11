import { expect, measureEach, test } from "./helpers";
import { b1NoOverflow, b1Targets, CARDS, FSHEET, openFilters, tapIn } from "./filters-helpers";

// S2-17: the Set picker over Filters (rev4 r4-3-set-picker, b1-set-base-chips,
// b1-set-show-all; desktop FilterPanel Set facet + its "Show all sets /
// Base sets only" menubar, allSetsGroups order). Also the stacked-sheet
// Escape rule carried from 2B-1: Escape closes the top sheet only.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone filters");
});

const PICK = ".m-sheet-layer--fpick-set";
const BASE_ORDER = "SOR,SHD,TWI,JTL,LOF,SEC,LAW,ASH,IBH,TS26";
const WEEKLY = "SORP,SHDP,TWIP,JTLP,LOFP,SECP,LAWP,ASHP";
const EXCLUSIVES = "C24,C25,C26,J24,J25,P25,P26,G25,MV26,GG";
const inSets = (codes: string[]) =>
  CARDS.filter(
    (c) => codes.includes(c.set_code) || c.variants.some((v) => codes.includes(v.source_set_code))
  ).length;
const showN = (n: number) => (n === 1 ? "Show 1 card" : `Show ${n} cards`);

test("s2-17-set-picker", async ({ page }) => {
  await openFilters(page);
  await tapIn(page, '[data-fpick="set"]');
  const layer = page.locator(PICK);
  await expect(layer).toBeVisible();
  await page.waitForTimeout(300);
  const r = await layer.evaluate((L) => {
    const x = L.querySelector(".m-sheet__close")!.getBoundingClientRect();
    const s = L.querySelector(".m-sheet")!.getBoundingClientRect();
    const bar = L.querySelector(".m-fpick__bar")!;
    const chips = [...L.querySelectorAll(".m-setfacet__chip")] as HTMLElement[];
    return {
      title: L.querySelector(".m-sheet__title")!.textContent,
      xTopRight: x.right > innerWidth - 30 && x.top - s.top < 40,
      done: !!L.querySelector(".m-fpick__foot .m-picker__done"),
      base: chips.map((c) => c.dataset.fv).join(","),
      logos: chips.every((c) => !!c.querySelector("img.m-chip__logo")),
      tail: L.querySelectorAll(".m-setrow-tail").length,
      allInBar: bar.contains(L.querySelector(".m-setfacet__all")),
      barAbove: bar.getBoundingClientRect().top < chips[0].getBoundingClientRect().top,
      allText: L.querySelector(".m-setfacet__all")!.textContent,
      clearOff: (bar.querySelectorAll(".m-flink")[1] as HTMLButtonElement).disabled,
    };
  });
  expect(r).toEqual({
    title: "Set",
    xTopRight: true,
    done: true,
    base: BASE_ORDER,
    logos: true,
    tail: 0,
    allInBar: true,
    barAbove: true,
    allText: "Show all sets",
    clearOff: true,
  });
  // The Filters sheet stays underneath.
  await expect(page.locator(FSHEET)).toBeVisible();

  // Show all sets: Weekly Play containers, a divider, the Exclusives.
  await layer.locator(".m-setfacet__all").click();
  const tail = await layer.evaluate((L) => ({
    weekly: [...L.querySelectorAll('[data-tail="weekly"] .m-setrow-tail')]
      .map((e) => (e as HTMLElement).dataset.fv)
      .join(","),
    ex: [...L.querySelectorAll('[data-tail="exclusives"] .m-setrow-tail')]
      .map((e) => (e as HTMLElement).dataset.fv)
      .join(","),
    divider: !!L.querySelector('[data-facet="set"] .m-fdivider'),
    allText: L.querySelector(".m-setfacet__all")!.textContent,
  }));
  expect(tail).toEqual({
    weekly: WEEKLY,
    ex: EXCLUSIVES,
    divider: true,
    allText: "Base sets only",
  });

  // Picks write the shared Set facet, live.
  await layer.locator('.m-setfacet__chip[data-fv="ASH"]').click();
  await layer.locator('.m-setrow-tail[data-fv="LAWP"]').click();
  await expect(layer.locator(".m-sheet__sub")).toHaveText("2 selected");
  await expect(page.locator(`${FSHEET} .m-filterfoot__show`)).toHaveText(
    showN(inSets(["ASH", "LAWP"]))
  );
  await expect(layer.locator('.m-setfacet__chip[data-fv="ASH"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual({ out: [], sideways: false, page: false });

  // Back to base sets only: the selected long-tail set stays visible.
  await layer.locator(".m-setfacet__all").click();
  await expect(layer.locator(".m-setrow-tail")).toHaveCount(1);
  await expect(layer.locator('.m-setrow-tail[data-fv="LAWP"]')).toHaveAttribute(
    "aria-checked",
    "true"
  );

  // Done returns to Filters; the row shows the picks.
  await layer.locator(".m-picker__done").click();
  await expect(layer).toHaveCount(0);
  await expect(page.locator(FSHEET)).toBeVisible();
  const chips = await page
    .locator(`${FSHEET} [data-facet="set"] .m-fsel`)
    .evaluateAll((es) => es.map((e) => (e as HTMLElement).dataset.fv).join(","));
  expect(chips).toBe("ASH,LAWP");

  // Clear in the top bar empties the facet (the row is tapped on its label:
  // the chips on top remove values).
  await page.locator(`${FSHEET} [data-fpick="set"]`).click({ position: { x: 30, y: 20 } });
  await layer.locator(".m-fpick__bar .m-flink", { hasText: "Clear" }).click();
  await expect(layer.locator(".m-sheet__sub")).toHaveCount(0);
  await expect(page.locator(`${FSHEET} .m-filterfoot__show`)).toHaveText(showN(CARDS.length));
});

test("s2-17-escape-closes-top-only", async ({ page }) => {
  await openFilters(page);
  await tapIn(page, '[data-fpick="set"]');
  await expect(page.locator(PICK)).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(page.locator(PICK)).toHaveCount(0);
  await expect(page.locator(FSHEET)).toBeVisible();
  // A second Escape closes Filters itself.
  await page.keyboard.press("Escape");
  await expect(page.locator(FSHEET)).toHaveCount(0);
});
