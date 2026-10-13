import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installApiMocks, recorderFor } from "./mock-api";
import type { CardsFixture, Recorder } from "./mock-api";

// BL-247 S1-10: shared e2e helpers -- ports of the rev4 check script's
// (.ds-sync/mobile-check-rev4.mjs) swipe / pullDown / scrollBy / wheel /
// layoutProbe / expectFn / measure, expressed against the real app.

/** The Auth emulator SDK pins a "Running in emulator mode" banner over the
 * bottom of the page (connectAuthEmulator without disableWarnings); it would
 * sit on top of the bottom bar. Hidden in the harness only. */
export function hideEmulatorBanner() {
  const add = () => {
    const st = document.createElement("style");
    st.textContent = ".firebase-emulator-warning{display:none!important}";
    document.head.append(st);
  };
  if (document.head) add();
  else document.addEventListener("DOMContentLoaded", add);
}

/** `test` with the API mocks installed on every page; pick the catalogue with
 * `test.use({ cardsFixture: "base-cards-600" })`. */
export const test = base.extend<{ cardsFixture: CardsFixture }>({
  cardsFixture: ["base-cards", { option: true }],
  page: async ({ page, cardsFixture }, provide) => {
    await installApiMocks(page, { fixture: cardsFixture });
    await page.addInitScript(hideEmulatorBanner);
    await provide(page);
  },
});
export { expect };

/** Finger swipe along x at height y (CDP touch events). */
export async function swipe(page: Page, fromX: number, toX: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fromX, y }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: fromX + ((toX - fromX) * i) / 8, y }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Vertical finger pull of `dist` px from (x, y); end=false leaves the finger down. */
export async function pullDown(page: Page, x: number, y: number, dist: number, end = true) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (dist * i) / 10 }],
    });
    await page.waitForTimeout(16);
  }
  if (end) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(380);
}

/** Scroll a container in small steps so scroll events fire like a finger drag. */
export async function scrollBy(page: Page, sel: string, total: number) {
  for (let i = 1; i <= 6; i++) {
    await page
      .locator(sel)
      .first()
      .evaluate((e, d) => void (e.scrollTop += d), total / 6);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(420);
}

/** Synthetic wheel events (deltaY) on a container, `gap` ms apart. */
export async function wheel(page: Page, sel: string, deltas: number[], gap: number) {
  for (const d of deltas) {
    await page
      .locator(sel)
      .first()
      .evaluate((e, dy) => {
        e.scrollTop += dy;
        e.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, bubbles: true }));
      }, d);
    await page.waitForTimeout(gap);
  }
  await page.waitForTimeout(400);
}

/** Assert a page-side predicate holds (after a short settle). */
export async function expectFn<A>(
  page: Page,
  fn: (arg: A) => boolean,
  arg: A,
  label: string
): Promise<void> {
  await page.waitForTimeout(250);
  const ok = await page.evaluate(fn, arg);
  expect(ok, `STATE CHECK FAILED: ${label}`).toBe(true);
}

type ProbeWindow = { __ls: number; __frames: number; __counting: boolean };

/** R3-6 layout probe: Blink's own LayoutCount / RecalcStyleCount over one
 * trigger, plus layout-shift entries and frames counted with rAF. */
export async function layoutProbe(page: Page, trigger: () => void, waitMs = 420) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.evaluate(() =>
    document
      .querySelectorAll('img[loading="lazy"]')
      .forEach((i) => ((i as HTMLImageElement).loading = "eager"))
  );
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    const w = window as unknown as ProbeWindow;
    w.__ls = 0;
    w.__frames = 0;
    w.__counting = false;
    try {
      new PerformanceObserver((l) => {
        if (w.__counting) w.__ls += l.getEntries().length;
      }).observe({ type: "layout-shift" });
    } catch {
      /* layout-shift unsupported */
    }
    const tick = () => {
      if (w.__counting) w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(500);
  const get = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])
    ) as Record<string, number>;
  const m0 = await get();
  await page.evaluate(() => void ((window as unknown as ProbeWindow).__counting = true));
  await page.evaluate(trigger);
  await page.waitForTimeout(waitMs);
  await page.evaluate(() => void ((window as unknown as ProbeWindow).__counting = false));
  const m1 = await get();
  const extra = await page.evaluate(() => {
    const w = window as unknown as ProbeWindow;
    return { shifts: w.__ls, frames: w.__frames };
  });
  await cdp.send("Performance.disable");
  return {
    layouts: m1.LayoutCount - m0.LayoutCount,
    styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount,
    ...extra,
  };
}

/** The per-test health check (S1-10 e): every visible interactive control in
 * `.m-app` is >= 44 x 44 (except `data-hit="overhang"` and the starfield
 * strip's ticks), no horizontal page overflow, and nothing erred since the
 * test started (pageerror / console error / failed request). */
export async function measure(page: Page): Promise<void> {
  const rec: Recorder = recorderFor(page);
  const r = await page.evaluate(() => {
    const small: string[] = [];
    const sel = ".m-app button, .m-app a, .m-app input, .m-app [role=button]";
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if ((el as HTMLElement).dataset.hit === "overhang") continue;
      if (el.closest(".m-vh__ticks")) continue;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!b.width || !b.height || cs.visibility === "hidden" || cs.display === "none") continue;
      if (b.width < 43.5 || b.height < 43.5) {
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24);
        small.push(
          `${Math.round(b.width)}x${Math.round(b.height)} ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${label}`
        );
      }
    }
    return {
      small,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    };
  });
  expect(r.small, "controls under 44x44").toEqual([]);
  expect(r.overflow, `horizontal overflow (scrollWidth ${r.sw} > ${r.iw})`).toBe(false);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
}

/** `test.afterEach(measureEach)` -- the form the brief's "every spec ends with
 * afterEach(measure)" takes (afterEach hands a fixtures object, not a page). */
export async function measureEach({ page }: { page: Page }): Promise<void> {
  await measure(page);
}

/** The whole-pixel text condition (PR #226 CI fix run). Linux Chromium -- the
 * CI runner -- snaps every glyph advance to a whole CSS px, where Windows,
 * macOS and iOS position glyphs at fractions. With the same web fonts loaded,
 * Barlow (body) nets out level, but Barlow Condensed labels draw 0.43 to
 * 0.67 px per glyph wider (measured: FILTERS 14 px 39.5 -> 44, CLEAR 13 px
 * 29.9 -> 32, "Whole box · 2 decks" 11 px 112.1 -> 120.3), which is what
 * turned 3 to 8 px text fits into cuts on CI only.
 *
 * On a browser with sub-pixel text this widens every Barlow Condensed text
 * now in `.m-app` by 0.7 px per glyph (the top of the measured range) and
 * returns true. Where the browser already snaps it does nothing and returns
 * false: that run IS the condition. One shot -- call it again after the app
 * re-renders the elements under test. A text fit asserted before and after
 * this call holds on both kinds of platform, whichever one runs the suite. */
export async function wideText(page: Page, root = ".m-app"): Promise<boolean> {
  // `root`: FR5-06's rotate screen is a <body> child beside `.m-app`.
  return page.evaluate((root) => {
    const c = document.createElement("canvas").getContext("2d")!;
    const snapped = [13, 14, 15, 17].every((px) => {
      c.font = `600 ${px}px "Barlow Condensed"`;
      return Number.isInteger(c.measureText("Whole box 2 decks").width);
    });
    if (snapped) return false;
    for (const el of document.querySelectorAll<HTMLElement>(root + " *")) {
      if (el.dataset.wideText) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      const cs = getComputedStyle(el);
      if (!own || !cs.fontFamily.includes("Barlow Condensed")) continue;
      const now = parseFloat(cs.letterSpacing) || 0;
      el.style.setProperty("letter-spacing", `${now + 0.7}px`, "important");
      el.dataset.wideText = "1";
    }
    return true;
  }, root);
}

/** Rendered colours [r, g, b] at viewport points given in CSS px (FR5-02).
 * One viewport screenshot at the device scale, decoded on a blank page of the
 * same context (the page under test may forbid data: images), each point read
 * from the device pixel that contains it. */
export async function samplePixels(
  page: Page,
  points: { x: number; y: number }[]
): Promise<[number, number, number][]> {
  const png = (await page.screenshot({ type: "png", scale: "device" })).toString("base64");
  const css = await page.evaluate(() => innerWidth);
  const pad = await page.context().newPage();
  try {
    return await pad.evaluate(
      async ({ png, points, css }) => {
        const img = new Image();
        img.src = "data:image/png;base64," + png;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const k = img.naturalWidth / css;
        return points.map((p) => {
          const d = g.getImageData(Math.floor(p.x * k), Math.floor(p.y * k), 1, 1).data;
          return [d[0], d[1], d[2]] as [number, number, number];
        });
      },
      { png, points, css }
    );
  } finally {
    await pad.close();
  }
}

/** Centre of the first element matching `sel` (rev4 check script `center`). */
export async function center(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}
