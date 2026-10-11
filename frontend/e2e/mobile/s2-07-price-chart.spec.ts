import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";
import { byNum, openCard } from "./card-helpers";
import { priceSeries, recorderFor } from "./mock-api";
import { formatAsOf, formatUsd, nearestIndex } from "../../src/mobile/card/priceChartModel";

// S2-07: price history for the selected printing -- desktop's data
// (getPriceHistory per range, 30D / 90D / 1Y / All, 90D default, line
// chart) at rev4 phone size, with the touch crosshair: a drag over the plot
// sets the readout to the nearest point and it stays where the finger
// lifts (rev4 card-price-pinned, dragChart helper).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const svg = ".m-chart__svg";

async function chartBox(page: Page) {
  await page.locator(svg).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  return (await page.locator(svg).boundingBox())!;
}

/** rev4 dragChart: a pointer press + 6 moves + release across the plot. */
async function dragChart(page: Page, from: number, to: number) {
  const b = await chartBox(page);
  const y = b.y + b.height * 0.5;
  await page.mouse.move(b.x + b.width * from, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++)
    await page.mouse.move(b.x + b.width * (from + ((to - from) * i) / 6), y);
  await page.mouse.up();
  return b;
}

const readout = (page: Page) =>
  page.evaluate(() => ({
    date: document.querySelector(".m-chart__date")!.textContent,
    price: document.querySelector(".m-chart__price")!.textContent,
    idx: Number(document.querySelector(".m-chart__svg g[data-idx]")?.getAttribute("data-idx")),
  }));

test("s2-07-chart-touch-crosshair", async ({ page }) => {
  const c = await openCard(page, "ASH", 52); // card-price-pinned
  const hs = c.variants.find((v) => v.variant_id === 8598)!; // the Hyperspace printing owned 3
  await expect(page.locator(".m-print.cp-rail__item--active")).toHaveAttribute(
    "data-variant",
    String(c.variants.find((v) => v.finish === "Standard")!.variant_id)
  );
  const std = c.variants.find((v) => v.finish === "Standard")!;
  const series = priceSeries(std.price!.market, "90d");
  // Unpinned: the latest point (= the printing's market price).
  await expect(page.locator(".m-chart__price")).toHaveText(formatUsd(std.price!.market));
  await expect(page.locator(".m-chart__date")).toHaveText(formatAsOf(series[89].as_of));

  // Pointer drag 0.85 -> 0.42 (rev4 card-price-pinned): nearest point to 0.42.
  const b = await dragChart(page, 0.85, 0.42);
  const want = nearestIndex(b.x + b.width * 0.42, b.x, b.width, series.length);
  await page.waitForTimeout(150);
  let r = await readout(page);
  expect(r.idx).toBe(want);
  expect(r.price).toBe(formatUsd(series[want].market));
  expect(r.date).toBe(formatAsOf(series[want].as_of));

  // Finger drag (CDP touch) 0.2 -> 0.7: the reading follows the finger and
  // stays where it lifts; the card does not swipe.
  const before = await page.evaluate(() => location.hash);
  const cdp = await page.context().newCDPSession(page);
  const bb = await chartBox(page);
  const y = bb.y + bb.height * 0.5;
  const at = (f: number) => bb.x + bb.width * f;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: at(0.2), y }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: at(0.2 + (0.5 * i) / 8), y }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
  const want2 = nearestIndex(at(0.7), bb.x, bb.width, series.length);
  r = await readout(page);
  expect(r.idx).toBe(want2);
  expect(r.price).toBe(formatUsd(series[want2].market));
  expect(await page.evaluate(() => location.hash)).toBe(before);
  expect(await page.locator(".m-page--ghost").count()).toBe(0);

  // Mono numerals and axis (skill: prices + chart axes in --font-mono).
  const fonts = await page.evaluate(() => ({
    price: getComputedStyle(document.querySelector(".m-chart__price")!).fontFamily,
    axis: getComputedStyle(document.querySelector(".m-chart__axis")!).fontFamily,
  }));
  expect(fonts.price).toMatch(/monospace/);
  expect(fonts.axis).toMatch(/monospace/);

  // The chart follows the selected printing (and the aside names it).
  await page.locator(`.m-print[data-variant="${hs.variant_id}"] .m-print__main`).click();
  await expect(page.locator(".m-history .m-sec__aside")).toContainText("ASH 316");
  await expect(page.locator(".m-chart__price")).toHaveText(formatUsd(hs.price!.market));
  const rec = recorderFor(page);
  expect(rec.priceHistory.at(-1)).toEqual({
    baseCardId: c.id,
    variantId: hs.variant_id,
    range: "90d",
  });
});

test("s2-07-ranges-as-desktop", async ({ page }) => {
  const c = await openCard(page, "ASH", 112);
  await page.locator(".m-chart").scrollIntoViewIfNeeded();
  const btns = page.locator(".m-chart__ranges .m-seg__btn");
  await expect(btns).toHaveText(["30D", "90D", "1Y", "All"]);
  await expect(btns.nth(1)).toHaveAttribute("aria-pressed", "true");
  const rec = recorderFor(page);
  for (const [label, range] of [
    ["30D", "30d"],
    ["1Y", "1y"],
    ["All", "all"],
  ] as const) {
    await page.locator(".m-chart__ranges .m-seg__btn", { hasText: label }).click();
    await expect(page.locator(".m-chart__ranges .m-seg__btn--on")).toHaveText(label);
    await expect.poll(() => rec.priceHistory.at(-1)?.range).toBe(range);
  }
  expect(rec.priceHistory.every((q) => q.baseCardId === c.id)).toBe(true);
  // Drawn 34, tapped 44 (the detail's segment rule).
  const seg = await btns.first().boundingBox();
  expect(Math.round(seg!.height)).toBeGreaterThanOrEqual(44);
  expect(Math.round(seg!.width)).toBeGreaterThanOrEqual(44);
  // A printing with no market price: desktop's empty state, em dash.
  const ser = byNum("ASH", 112).variants.find((v) => v.finish === "Serialized Prestige")!;
  await page.locator(`.m-print[data-variant="${ser.variant_id}"] .m-print__main`).click();
  await expect(page.locator(".m-chart .php-empty__title")).toHaveText(
    "No price data for this printing"
  );
  await expect(page.locator(".m-chart__price")).toHaveText("—");
});
