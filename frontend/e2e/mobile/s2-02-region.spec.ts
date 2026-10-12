import { expect, layoutProbe, measureEach, pullDown, test } from "./helpers";
import type { Page } from "@playwright/test";
import { detailScroll, fin, openCard, scrollDetail } from "./card-helpers";

// S2-02: the collapsing art region (rev4 card-transform-only,
// card-unit-collapsed, card-collapsed-low, card-back-top-stays-collapsed,
// card-pull-expands, card-expand-tap, card-leader-full / -flipped /
// -collapsed, card-base / -collapsed).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

/** rev4 noLayoutTransitions over the region, its layers, the body, the header. */
const noLayoutTransitions = () => {
  const bad =
    /(^|,\s*)(height|padding[a-z-]*|grid-template-rows|max-height|top|left|right|bottom|width|margin[a-z-]*|all)(\s*,|$)/;
  const els = [
    ...document.querySelectorAll(
      ".m-dreg3, .m-dreg3 *, .m-detail__body, .m-detail__track, .m-hdr--detail-fixed"
    ),
  ];
  return els.every((e) => {
    const cs = getComputedStyle(e);
    return (
      !cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0) ||
      !bad.test(cs.transitionProperty)
    );
  });
};
const isCollapsed = (page: Page) =>
  page
    .locator(".m-dreg3--collapsed")
    .count()
    .then((n) => n > 0);

test("s2-02-collapse-transform-only", async ({ page }) => {
  await openCard(page, "ASH", 112);
  expect(await page.evaluate(noLayoutTransitions)).toBe(true);
  const box0 = await page.locator(".m-dreg3").evaluate((e) => (e as HTMLElement).offsetHeight);
  const hdr0 = await page.locator(".m-hdr--detail-fixed").boundingBox();
  const c = await layoutProbe(page, () => {
    document.querySelector(".m-detail__scroll")!.scrollTop = 300;
  });
  expect(await isCollapsed(page)).toBe(true);
  expect(c.layouts, JSON.stringify(c)).toBeLessThanOrEqual(4);
  expect(c.shifts).toBe(0);
  expect(await page.evaluate(noLayoutTransitions)).toBe(true);
  // The region's layout box never changes; the header never collapses.
  const box1 = await page.locator(".m-dreg3").evaluate((e) => (e as HTMLElement).offsetHeight);
  expect(box1).toBe(box0);
  expect(box0).toBe(100);
  expect(await page.locator(".m-hdr--detail-fixed").boundingBox()).toEqual(hdr0);
  // card-expand-tap: the collapsed art expands it.
  const e = await layoutProbe(page, () => {
    (document.querySelector(".m-dreg__btn") as HTMLElement).click();
  });
  expect(await isCollapsed(page)).toBe(false);
  expect(e.layouts, JSON.stringify(e)).toBeLessThanOrEqual(4);
  expect(e.shifts).toBe(0);
  console.log(
    `probe ${test.info().project.name}: collapse ${JSON.stringify(c)} expand ${JSON.stringify(e)}`
  );
});

test("s2-02-reduced-motion-snaps", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openCard(page, "ASH", 112);
  const durations = await page.evaluate(() =>
    [".m-dreg3__bg", ".m-dreg3__art", ".m-dreg3__own", ".m-dreg3__mini", ".m-detail__body"].map(
      (s) => getComputedStyle(document.querySelector(s)!).transitionDuration
    )
  );
  for (const d of durations) expect(d.split(",").every((x) => parseFloat(x) === 0)).toBe(true);
});

test("s2-02-collapsed-row", async ({ page }) => {
  const c = await openCard(page, "ASH", 112);
  const std = c.variants.find((v) => fin(v) === "Standard")!;
  await scrollDetail(page, 300);
  expect(await isCollapsed(page)).toBe(true);
  // card-unit-collapsed: the gallery plate (FR1-07), the selected printing's
  // price and Market / Low (FR1-09 covers the three-column arrangement).
  const mini = page.locator(".m-dreg3__mini");
  await expect(mini.locator(".gallery-plate .gallery-plate__total")).toBeVisible();
  await expect(mini.locator(".m-dreg__pval")).toHaveText(`$${std.price!.market!.toFixed(2)}`);
  await expect(mini.locator(".m-seg .m-seg__btn")).toHaveCount(2);
  // The 80 px thumbnail sits left of the row.
  const art = await page.locator(".m-dreg3__art").boundingBox();
  const row = await mini.boundingBox();
  expect(art!.x + art!.width).toBeLessThanOrEqual(row!.x + 0.5);
  expect(Math.round(art!.height)).toBe(80);
  // card-collapsed-low: the toggle is the shared, persisted price kind.
  await mini.locator(".m-seg__btn", { hasText: "Low" }).click();
  await expect(mini.locator(".m-dreg__pval")).toHaveText(`$${std.price!.low!.toFixed(2)}`);
  expect(await page.evaluate(() => localStorage.getItem("swu.cardsValue.kind"))).toBe("low");
  await expect(page.locator(".m-printings .m-seg__btn--on")).toHaveText("Low");
  await mini.locator(".m-seg__btn", { hasText: "Market" }).click();
  await expect(mini.locator(".m-dreg__pval")).toHaveText(`$${std.price!.market!.toFixed(2)}`);
});

type FlipWin = { __flip?: { cls: string; name: string } };

test("s2-02-leader-flip", async ({ page }) => {
  const c = await openCard(page, "SOR", 10);
  expect(c.type).toBe("Leader");
  // card-leader-full: the flip is visible at full size; the front is landscape.
  const flip = page.locator(".m-dreg__flip .m-flipbtn");
  await expect(flip).toBeVisible();
  const vis = await page.locator(".m-dreg__flip").evaluate((e) => getComputedStyle(e).visibility);
  expect(vis).toBe("visible");
  const front = await page.locator(".m-dreg3__art").boundingBox();
  expect(front!.width).toBeGreaterThan(front!.height);
  // card-leader-flipped: desktop's two-phase rotateY, then the portrait back.
  // Record the out phase from a MutationObserver armed before the click: a
  // single post-click read can land after the phase has ended under load.
  await page.locator(".m-dreg__btn").evaluate((e) => {
    const w = window as unknown as { __flip?: { cls: string; name: string } };
    const seen = () => {
      if (e.className.includes("cp-image-flip--out") && !w.__flip)
        w.__flip = { cls: e.className, name: getComputedStyle(e).animationName };
    };
    new MutationObserver(seen).observe(e, { attributes: true, attributeFilter: ["class"] });
    seen();
  });
  await flip.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as FlipWin).__flip?.cls ?? ""))
    .toContain("cp-image-flip--out");
  const anim = await page.evaluate(() => (window as unknown as FlipWin).__flip!);
  expect(anim.name).toBe("cp-flip-out");
  await page.waitForTimeout(700);
  await expect(page.locator(".m-dreg__img")).toHaveAttribute("alt", /\(back\)$/);
  await expect(flip).toHaveText(/Show front/);
  const backBox = await page.locator(".m-dreg3__art").boundingBox();
  expect(backBox!.height).toBeGreaterThan(backBox!.width);
  // card-leader-collapsed: flip hidden, price row present. A five-printing
  // page is too short to collapse by scrolling (useCollapse's short-content
  // rule), so it opens collapsed (?collapsed=1, rev4's review param).
  await page.goto("about:blank");
  await page.goto(`/#/card/${c.id}?collapsed=1`);
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await isCollapsed(page)).toBe(true);
  const vis2 = await page.locator(".m-dreg__flip").evaluate((e) => getComputedStyle(e).visibility);
  expect(vis2).toBe("hidden");
  await expect(page.locator(".m-dreg3__mini .m-dreg__price")).toBeVisible();
});

test("s2-02-base-rotated", async ({ page }) => {
  // card-base: a base's landscape front is laid out in a landscape box
  // (333 x 238 expanded, 112 x 80 collapsed), never squeezed into portrait.
  const c = await openCard(page, "ASH", 19);
  expect(c.type).toBe("Base");
  const full = await page.locator(".m-dreg3__art").boundingBox();
  expect(Math.round(full!.height)).toBe(238);
  expect(Math.round(full!.width)).toBe(333);
  // S2-07 REPLACE (2A-2): with the price-history section in the body a
  // two-printing base is long enough to collapse by scrolling at 390 (not at
  // 430 -- the short-content rule); whichever happens, a scroll-collapsed
  // base shows the landscape thumbnail, and card-base-collapsed opens it
  // collapsed by the review param.
  await scrollDetail(page, 300);
  if (await isCollapsed(page)) {
    const s = await page.locator(".m-dreg3__art").boundingBox();
    expect([Math.round(s!.width), Math.round(s!.height)]).toEqual([112, 80]);
  }
  await page.goto("about:blank");
  await page.goto(`/#/card/${c.id}?collapsed=1`);
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await isCollapsed(page)).toBe(true);
  const col = await page.locator(".m-dreg3__art").boundingBox();
  expect(Math.round(col!.height)).toBe(80);
  expect(Math.round(col!.width)).toBe(112);
});

test("s2-02-back-top-stays-collapsed", async ({ page }) => {
  await openCard(page, "ASH", 112);
  await scrollDetail(page, 300);
  expect(await isCollapsed(page)).toBe(true);
  await scrollDetail(page, -900);
  expect(await page.locator(detailScroll).evaluate((e) => e.scrollTop)).toBe(0);
  expect(await isCollapsed(page)).toBe(true);
});

test("s2-02-pull-expands", async ({ page }) => {
  await openCard(page, "ASH", 112);
  await scrollDetail(page, 300);
  await scrollDetail(page, -900);
  expect(await isCollapsed(page)).toBe(true);
  // A short pull stays collapsed; a deliberate pull (> 72 px) from the top opens.
  const b = await page.locator(".m-detail__body").boundingBox();
  const x = Math.round(b!.x + b!.width / 2);
  const y = Math.round(b!.y + 120);
  await pullDown(page, x, y, 40);
  expect(await isCollapsed(page)).toBe(true);
  await pullDown(page, x, y, 110);
  expect(await isCollapsed(page)).toBe(false);
});
