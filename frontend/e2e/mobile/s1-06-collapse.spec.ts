import {
  center,
  expect,
  layoutProbe,
  measureEach,
  pullDown,
  scrollBy,
  test,
  wheel,
} from "./helpers";
import type { Page } from "@playwright/test";

// S1-06: header collapse / expand, re-expressed from the rev4 check steps
// collapse-transform-only, r4-5-no-layout-props, vault-back-top-stays-collapsed,
// vault-wheel-to-top-stays, vault-reexpanded-tap, vault-pull-expands,
// vault-short-pull-stays, vault-pull-midway, r4-5-starfield-static,
// r3-6-reduced-motion, r3-13-list-bottom-edge, r3-13-collapse-cut-once and the
// vault collapse / expand layout probes.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone header");
});

const SCROLL = ".m-vault__scroll";
const isCollapsed = (p: Page) => p.evaluate(() => !!document.querySelector(".m-vh--collapsed"));

async function openVault(page: Page) {
  await page.goto("/#/vault");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function collapse(page: Page) {
  await scrollBy(page, SCROLL, 420);
  expect(await isCollapsed(page)).toBe(true);
}

async function toTopCollapsed(page: Page) {
  await collapse(page);
  await scrollBy(page, SCROLL, -900);
}

/** Every element in the header / below layers whose transition has a
 * duration animates only transform / opacity / visibility / clip-path (the
 * sky's), never a layout property. */
const noLayoutTransitions = () => {
  const bad =
    /(^|,\s*)(height|padding[a-z-]*|grid-template-rows|max-height|top|left|right|bottom|width|margin[a-z-]*|all)(\s*,|$)/;
  const els = [...document.querySelectorAll(".m-vh, .m-vh *, .m-vault__below")];
  const hits = els.filter((e) => {
    const cs = getComputedStyle(e);
    return (
      cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0) &&
      bad.test(cs.transitionProperty)
    );
  });
  const clipOnSkyOnly = els.every((e) => {
    const tp = getComputedStyle(e).transitionProperty;
    return !/clip-path/.test(tp) || e.classList.contains("m-vh__sky");
  });
  return hits.length === 0 && clipOnSkyOnly;
};

test("s1-06-collapse-transform-only", async ({ page }) => {
  await openVault(page);
  expect(await page.evaluate(noLayoutTransitions)).toBe(true);
  const sky0 = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".m-vh__sky")!);
    const b = getComputedStyle(document.querySelector(".m-vh > .m-vh__bg")!);
    return { tp: s.transitionProperty, tf: s.transform, bgImg: b.backgroundImage };
  });
  expect(sky0).toEqual({ tp: "clip-path", tf: "none", bgImg: "none" });

  // Layout probe: collapse <= 4 layouts, 0 layout shifts.
  const c = await layoutProbe(page, () => {
    document.querySelector(".m-vault__scroll")!.scrollTop = 60;
  });
  expect(await isCollapsed(page)).toBe(true);
  expect(c.layouts, JSON.stringify(c)).toBeLessThanOrEqual(4);
  expect(c.shifts).toBe(0);
  expect(await page.evaluate(noLayoutTransitions)).toBe(true);
  const sky1 = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".m-vh__sky")!);
    const d = parseFloat(
      getComputedStyle(document.querySelector(".m-vault")!).getPropertyValue("--vh-delta")
    );
    return { tf: s.transform, clip: s.clipPath, d };
  });
  expect(sky1.d).toBeGreaterThan(60);
  expect(sky1.tf).toBe("none");
  expect(sky1.clip).toMatch(new RegExp("^inset\\(0px 0px " + sky1.d + "px"));

  // Expand probe (tap on the strip).
  const e = await layoutProbe(page, () => {
    (document.querySelector(".m-vh__readout") as HTMLElement).click();
  });
  expect(await isCollapsed(page)).toBe(false);
  expect(e.layouts, JSON.stringify(e)).toBeLessThanOrEqual(4);
  expect(e.shifts).toBe(0);
  console.log(
    `probe ${test.info().project.name}: collapse ${JSON.stringify(c)} expand ${JSON.stringify(e)}`
  );
});

test("s1-06-back-top-stays-collapsed", async ({ page }) => {
  await openVault(page);
  await toTopCollapsed(page);
  expect(await isCollapsed(page)).toBe(true);
  expect(await page.locator(SCROLL).evaluate((e) => e.scrollTop)).toBe(0);

  // vault-wheel-to-top-stays: a continuous wheel scroll to the top stays collapsed.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await openVault(page);
  await collapse(page);
  await wheel(page, SCROLL, Array(12).fill(-80), 40);
  expect(await isCollapsed(page)).toBe(true);
  expect(await page.locator(SCROLL).evaluate((e) => e.scrollTop)).toBe(0);
});

test("s1-06-tap-reexpands", async ({ page }) => {
  await openVault(page);
  await collapse(page);
  await expect(page.locator(".m-vh__strip")).toBeVisible();
  await expect(page.locator(".m-vh__brand")).toBeHidden();
  await page.locator(".m-vh__readout").click();
  await page.waitForTimeout(420);
  expect(await isCollapsed(page)).toBe(false);
  await expect(page.locator(".m-vh__brand")).toBeVisible();
});

test("s1-06-pull-expands", async ({ page }) => {
  await openVault(page);
  // vault-short-pull-stays: a 40 px pull does not open.
  await toTopCollapsed(page);
  let c = await center(page, SCROLL);
  await pullDown(page, c.x, c.y, 40);
  expect(await isCollapsed(page)).toBe(true);
  // vault-pull-midway: the resistance cue shows mid-pull; the bar fills.
  c = await center(page, SCROLL);
  await pullDown(page, c.x, c.y, 46, false);
  const mid = await page.evaluate(() => ({
    pulling: !!document.querySelector(".m-pulling"),
    collapsed: !!document.querySelector(".m-vh--collapsed"),
    bar: document.querySelector(".m-pullbar")!.getBoundingClientRect().width,
    op: getComputedStyle(document.querySelector(".m-pullbar")!).opacity,
  }));
  expect(mid.pulling).toBe(true);
  expect(mid.collapsed).toBe(true);
  expect(mid.bar).toBeGreaterThan(0);
  expect(mid.op).toBe("0.9");
  // vault-pull-expands: a deliberate pull from the top opens the header.
  c = await center(page, SCROLL);
  await pullDown(page, c.x, c.y, 110);
  expect(await isCollapsed(page)).toBe(false);
});

test("s1-06-starfield-static", async ({ page }) => {
  await openVault(page);
  // Only the sky is sampled: content layers at opacity 0. Three points inside
  // the collapsed strip's band, read from real screenshots before and after.
  await page.addStyleTag({
    content: ".m-vh__top, .m-vh__panel, .m-pullbar, .m-vh__seam { opacity: 0 !important; }",
  });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const pts = await page.evaluate(() => {
    const h = document.querySelector(".m-vh")!.getBoundingClientRect();
    const min = parseFloat(
      getComputedStyle(document.querySelector(".m-vault")!).getPropertyValue("--vh-min")
    );
    return [0.18, 0.5, 0.82].map((fx, i) => ({
      x: Math.round(h.left + h.width * fx),
      y: Math.round(h.top + min * [0.3, 0.55, 0.8][i]),
    }));
  });
  const sample = async () => {
    const b64 = (await page.screenshot()).toString("base64");
    return page.evaluate(
      async ([b64, pts]) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const k = img.naturalWidth / innerWidth;
        return pts.map(({ x, y }) => [
          ...g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3),
        ]);
      },
      [b64, pts] as const
    );
  };
  const before = await sample();
  await page.evaluate(() => {
    document.querySelector(".m-vault__scroll")!.scrollTop = 60;
  });
  await page.waitForTimeout(700);
  expect(await isCollapsed(page)).toBe(true);
  const after = await sample();
  const diff = Math.max(...before.flatMap((c, i) => c.map((v, j) => Math.abs(v - after[i][j]))));
  const lit = before.some((c) => c.some((v) => v > 12));
  expect(lit, "the starfield paints").toBe(true);
  expect(diff, JSON.stringify({ before, after })).toBeLessThanOrEqual(6);
});

test("s1-06-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openVault(page);
  // Under reduced motion the collapse lands in one frame: the list is at its
  // collapsed offset, the surface is up by --vh-delta, the panel is gone.
  const r = await page.evaluate(
    () =>
      new Promise<Record<string, { ty: number; op: number; dur: string }> | null>((res) => {
        const t0 = performance.now();
        const sc = document.querySelector(".m-vault__scroll")!;
        sc.scrollTop = 200;
        sc.dispatchEvent(new Event("scroll"));
        const sels = [".m-vault__below", ".m-vh > .m-vh__bg", ".m-vh > .m-vh__panel"];
        const wait = () => {
          if (document.querySelector(".m-vh--collapsed"))
            requestAnimationFrame(() =>
              res(
                Object.fromEntries(
                  sels.map((s) => {
                    const cs = getComputedStyle(document.querySelector(s)!);
                    const m = new DOMMatrixReadOnly(
                      cs.transform === "none" ? undefined : cs.transform
                    );
                    return [
                      s,
                      {
                        ty: Math.round(m.m42 * 10) / 10,
                        op: +cs.opacity,
                        dur: cs.transitionDuration,
                      },
                    ];
                  })
                )
              )
            );
          else if (performance.now() - t0 < 1500) requestAnimationFrame(wait);
          else res(null);
        };
        requestAnimationFrame(wait);
      })
  );
  const delta = await page.evaluate(
    () =>
      parseFloat(
        getComputedStyle(document.querySelector(".m-vault")!).getPropertyValue("--vh-delta")
      ) || 0
  );
  expect(r).not.toBeNull();
  expect(r![".m-vault__below"].ty).toBe(0);
  expect(Math.abs(r![".m-vh > .m-vh__bg"].ty + delta)).toBeLessThanOrEqual(1);
  expect(r![".m-vh > .m-vh__panel"].op).toBe(0);
  for (const x of Object.values(r!))
    expect(x.dur.split(",").every((d) => parseFloat(d) <= 0.001)).toBe(true);
});

test("s1-06-list-bottom-edge", async ({ page }) => {
  await openVault(page);
  const edge = () =>
    page.evaluate(() => {
      const s = document.querySelector(".m-vault__scroll")!.getBoundingClientRect();
      const b = document.querySelector(".m-nav")!.getBoundingClientRect();
      return { list: Math.round(s.bottom * 10) / 10, bar: Math.round(b.top * 10) / 10 };
    });
  const rest = await edge();

  // r3-13-collapse-cut-once: on collapse the list's cut changes exactly once
  // (--vh-delta -> 0).
  const r = await page.evaluate(
    () =>
      new Promise<{ start: string; delta: string; seen: [number, string][]; collapsed: boolean }>(
        (res) => {
          const root = document.querySelector(".m-vault")!;
          const below = document.querySelector(".m-vault__below")!;
          const sc = document.querySelector(".m-vault__scroll")!;
          const mb = () => getComputedStyle(below).marginBottom;
          const start = mb();
          const delta = getComputedStyle(root).getPropertyValue("--vh-delta").trim();
          const seen: [number, string][] = [];
          let last = start;
          const t0 = performance.now();
          const tick = () => {
            const v = mb();
            if (v !== last) {
              seen.push([Math.round(performance.now() - t0), v]);
              last = v;
            }
            if (performance.now() - t0 < 700) requestAnimationFrame(tick);
            else
              res({ start, delta, seen, collapsed: !!document.querySelector(".m-vh--collapsed") });
          };
          requestAnimationFrame(tick);
          for (let i = 1; i <= 4; i++)
            setTimeout(() => {
              sc.scrollTop = 60 * i;
              sc.dispatchEvent(new Event("scroll"));
            }, 16 * i);
        }
      )
  );
  expect(r.collapsed).toBe(true);
  expect(r.start, JSON.stringify(r)).toBe(r.delta);
  expect(r.seen, JSON.stringify(r)).toEqual([[expect.any(Number), "0px"]]);
  await page.waitForTimeout(300);
  const col = await edge();

  await page.locator(".m-vh__readout").click();
  await page.waitForTimeout(500);
  expect(await isCollapsed(page)).toBe(false);
  const re = await edge();
  for (const e of [rest, col, re])
    expect(Math.abs(e.list - e.bar), JSON.stringify({ rest, col, re })).toBeLessThanOrEqual(1);

  // The last row scrolls clear of the bar.
  await page.locator(SCROLL).evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  // (The jump to the end collapses the header again; let its 0.24 s settle.)
  await page.waitForTimeout(600);
  const clear = await page.evaluate(() => {
    const rows = document.querySelectorAll(".m-row");
    return (
      rows[rows.length - 1].getBoundingClientRect().bottom <=
      document.querySelector(".m-nav")!.getBoundingClientRect().top + 1
    );
  });
  expect(clear).toBe(true);
});
