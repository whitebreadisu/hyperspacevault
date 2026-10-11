import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera } from "./scan-helpers";

// S7-11: the drawn guide equals Spec 24.3 + the tuned -2.2 / +2.1 mm (the
// spike's layoutGuideV2 at this stage size and the 1080 x 1920 stream); the
// two +/-4 mm sliders live in the "Guide alignment" sheet (X top-right),
// re-lay the box out live, persist in hsv.scan.v1, reset to 0, and survive a
// reload. The outline never moves; the box (and the OCR crop) do.
test.afterEach(measureEach);

async function geometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const st = document.querySelector(".m-cam__view")!.getBoundingClientRect();
    const box = document.querySelector(".m-guide__box")!.getBoundingClientRect();
    const card = document.querySelector(".m-guide__card")!.getBoundingClientRect();
    const v = document.querySelector<HTMLVideoElement>(".m-cam__video")!;
    return {
      W: st.width,
      H: st.height,
      vw: v.videoWidth,
      vh: v.videoHeight,
      box: [box.left - st.left, box.top - st.top, box.width, box.height],
      card: [card.left - st.left, card.top - st.top, card.width, card.height],
    };
  });
}

/** The spike's formula (app.js:321-342), for the expected rects. */
function spike(W: number, H: number, vw: number, vh: number, oh = 0, ov = 0) {
  const k = Math.max(W / vw, H / vh);
  const mm = (45 / 1.54) * k;
  const gx0 = W / 2;
  const gy0 = 0.62 * H;
  const cx = gx0 + (13.4 / 2 + 3.7) * mm;
  const cy = gy0 + 3.6 * mm;
  const gy = gy0 - (2.1 + ov) * mm;
  const gx = gx0 + (-2.2 + oh) * mm;
  const dw = 13.4 * mm * 1.3;
  const dh = 4.0 * mm * 1.3;
  return {
    mm,
    box: [gx - dw / 2, gy - dh / 2, dw, dh],
    card: [cx - 63 * mm, cy - 88 * mm, 63 * mm, 88 * mm],
  };
}

const near = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) <= 1);

test("s7-11-guide-and-sliders", async ({ page }) => {
  await installFakeScanner(page);
  await openScanCamera(page);
  await expect.poll(async () => (await geometry(page)).vw).toBe(1080);
  const g0 = await geometry(page);
  const want = spike(g0.W, g0.H, g0.vw, g0.vh);
  expect(near(g0.box, want.box), JSON.stringify({ got: g0.box, want: want.box })).toBe(true);
  expect(near(g0.card, want.card)).toBe(true);

  // The Guide alignment sheet: two sliders, X top-right.
  await page.locator(".m-cam__align[aria-label='Guide alignment']").click();
  const sheet = page.locator(".m-sheet-layer");
  await expect(sheet).toContainText("Guide alignment");
  const x = await sheet.locator("[aria-label='Close']").first().boundingBox();
  expect(x!.x + x!.width).toBeGreaterThan(390 - 24);
  const sliders = sheet.locator("input[type=range]");
  await expect(sliders).toHaveCount(2);
  for (const attr of [
    ["min", "-4"],
    ["max", "4"],
    ["step", "0.1"],
  ])
    await expect(sliders.first()).toHaveAttribute(attr[0], attr[1]);
  await sliders.nth(0).fill("1.5");
  await sliders.nth(1).fill("-0.5");
  const g1 = await geometry(page);
  const want1 = spike(g1.W, g1.H, g1.vw, g1.vh, 1.5, -0.5);
  expect(near(g1.box, want1.box)).toBe(true);
  expect(near(g1.card, g0.card)).toBe(true); // the outline stays
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("hsv.scan.v1") ?? "{}"));
  expect([stored.boxOffsetMm, stored.boxOffsetVMm]).toEqual([1.5, -0.5]);

  // Persisted across a reload (the sheet closed).
  await page.reload();
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live");
  await expect.poll(async () => (await geometry(page)).vw).toBe(1080);
  expect(near((await geometry(page)).box, want1.box)).toBe(true);

  // Reset to 0.
  await page.locator(".m-cam__align").click();
  await page.locator(".m-sheet-layer .m-textbtn", { hasText: "Reset to 0" }).click();
  expect(near((await geometry(page)).box, want.box)).toBe(true);
  const reset = await page.evaluate(() => JSON.parse(localStorage.getItem("hsv.scan.v1") ?? "{}"));
  expect([reset.boxOffsetMm, reset.boxOffsetVMm]).toEqual([0, 0]);
});
