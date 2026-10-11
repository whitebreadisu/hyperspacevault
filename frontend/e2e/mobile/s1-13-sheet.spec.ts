import { expect, measureEach, pullDown, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-13: the sheet primitive (rev4 MSheet.jsx; b1-motion-transform-only,
// b0-q3-sheet-leave-scrim-swipe, b1-close-x) -- exercised on the Filters
// sheet (a ComingSoon sheet until S2) and the scope sheet.
test.afterEach(measureEach);

test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone sheet");
});

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const isOpen = (p: Page) => p.evaluate(() => !!document.querySelector(".m-sheet-layer"));

/** Every running animation inside the sheet layer, as its animated properties. */
const sheetAnimProps = (p: Page) =>
  p.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return !!t && !!t.closest(".m-sheet-layer");
      })
      .map((a) => {
        const ef = a.effect as KeyframeEffect;
        const props = new Set<string>();
        for (const k of ef.getKeyframes())
          for (const key of Object.keys(k))
            if (!["offset", "computedOffset", "easing", "composite"].includes(key)) props.add(key);
        if (a instanceof CSSTransition) props.add(a.transitionProperty);
        return [...props].join("+");
      })
  );

test("s1-13-sheet-motion-transform-only", async ({ page }) => {
  await openVault(page);
  await page.locator(".m-filterbtn").click();
  const opening = await sheetAnimProps(page);
  expect(opening.length).toBeGreaterThan(0);
  for (const p of opening)
    expect(p.split("+").every((x) => /^(transform|opacity)$/.test(x))).toBe(true);
  // Height = content (one sentence), never the 86 % cap.
  const fit = await page.evaluate(() => {
    const s = document.querySelector(".m-sheet")!.getBoundingClientRect();
    return {
      h: s.height,
      cap: innerHeight * 0.86,
      max: getComputedStyle(document.querySelector(".m-sheet")!).maxHeight,
    };
  });
  expect(fit.h).toBeLessThan(fit.cap);
  expect(fit.max).toBe("86%");
  await page.waitForTimeout(300);
  await page.locator(".m-sheet__close").click();
  const leaving = await sheetAnimProps(page);
  expect(leaving.length).toBeGreaterThan(0);
  for (const p of leaving)
    expect(p.split("+").every((x) => /^(transform|opacity)$/.test(x))).toBe(true);
  await page.waitForTimeout(400);
  expect(await isOpen(page)).toBe(false);
});

test("s1-13-sheet-leave-scrim-swipe", async ({ page }) => {
  await openVault(page);
  await page.locator(".m-filterbtn").click();
  await page.waitForTimeout(300);
  const top = await page.evaluate(
    () => document.querySelector(".m-sheet")!.getBoundingClientRect().top
  );
  expect(top).toBeGreaterThan(20);
  const w = page.viewportSize()!.width;
  await page.touchscreen.tap(Math.round(w / 2), Math.round(top / 2));
  await page.waitForTimeout(400);
  expect(await isOpen(page), "scrim tap closes").toBe(false);

  await page.locator(".m-filterbtn").click();
  await page.waitForTimeout(300);
  expect(await isOpen(page)).toBe(true);
  const g = await page.evaluate(() => {
    const r = document.querySelector(".m-sheet__grip")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 + 4 };
  });
  await pullDown(page, Math.round(g.x), Math.round(g.y), 180);
  await page.waitForTimeout(200);
  expect(await isOpen(page), "swipe down on the head closes").toBe(false);

  // A short drag springs back and stays open.
  await page.locator(".m-filterbtn").click();
  await page.waitForTimeout(300);
  await pullDown(page, Math.round(g.x), Math.round(g.y), 40);
  expect(await isOpen(page), "a short drag stays open").toBe(true);
});

test("s1-13-sheet-x-top-right", async ({ page }) => {
  await openVault(page, "#/vault?sheet=scope");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const layer = document.querySelector(".m-sheet-layer")!;
    const sheet = document.querySelector(".m-sheet")!.getBoundingClientRect();
    const x = document.querySelector(".m-sheet__close")!.getBoundingClientRect();
    const title = document.getElementById(layer.getAttribute("aria-labelledby")!);
    return {
      role: layer.getAttribute("role"),
      modal: layer.getAttribute("aria-modal"),
      title: title?.textContent,
      x: { r: x.right, t: x.top, w: x.width, h: x.height },
      sheet: { r: sheet.right, t: sheet.top },
      focusIn: layer.contains(document.activeElement),
      iw: innerWidth,
    };
  });
  expect(r.role).toBe("dialog");
  expect(r.modal).toBe("true");
  expect(r.title).toBe("Finish scope");
  expect(r.x.w).toBeGreaterThanOrEqual(44);
  expect(r.x.h).toBeGreaterThanOrEqual(44);
  expect(r.x.r).toBeGreaterThan(r.iw - 24);
  expect(r.x.t - r.sheet.t).toBeLessThan(24);
  expect(r.focusIn).toBe(true);
  // Escape closes; focus returns to the opener.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  expect(await isOpen(page)).toBe(false);
  await page.locator(".m-scopechip").click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.activeElement?.classList.contains("m-scopechip"))).toBe(
    true
  );
});
