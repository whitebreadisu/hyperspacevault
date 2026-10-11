import { expect, measureEach, test } from "./helpers";

test.afterEach(measureEach);

// S1-02: the frame never scrolls sideways, fills the dynamic viewport, and its
// pinned bottom edge meets the viewport bottom minus the safe-area inset (0 in
// headless chromium).
test("s1-02-frame-no-overflow", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone frame");
  await page.goto("/");
  await expect(page.locator(".m-app")).toBeVisible();
  const m = await page.evaluate(() => {
    const app = document.querySelector(".m-app")!;
    const box = app.getBoundingClientRect();
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.append(probe);
    const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    return {
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
      iw: innerWidth,
      ih: innerHeight,
      appBottom: box.bottom,
      appW: box.width,
      inset,
      tile: getComputedStyle(app).backgroundSize,
    };
  });
  expect(m.docW).toBe(m.iw);
  expect(m.docH).toBeLessThanOrEqual(m.ih);
  expect(m.appW).toBe(m.iw);
  expect(Math.round(m.appBottom)).toBe(m.ih - m.inset);
  expect(m.tile).toContain("1400px");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/
  );
});
