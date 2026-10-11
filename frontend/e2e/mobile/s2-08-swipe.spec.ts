import { expect, measureEach, swipe, test } from "./helpers";
import type { Page } from "@playwright/test";
import { openCard, scrollDetail } from "./card-helpers";

// S2-08 (R5 switch swipe=body): the header stays fixed; the region and
// everything below slide as one page with the neighbour's page one width
// aside; release past 70 px (or a flick) commits -- 0.2 s, transform only
// -- and the route changes when the motion ends; short of that it snaps
// back; at the first / last card the drag is dampened and snaps back; the
// chevrons run the same slide. Seeds: rev4 r3-12-body-slides,
// card-swiped-next, card-swipe-snapback, card-swipe-route-after-motion,
// card-arrow-slides, card-swipe-first-edge, r3-12-body-transform-only,
// r3-12-body-collapse-intact.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const rect = (page: Page, s: string) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top)];
  }, s);
const posNum = async (page: Page) =>
  Number((await page.locator(".m-hdr__pos").textContent())!.split(" of ")[0]);

async function touchHold(page: Page, fromX: number, dx: number, y = 300) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fromX, y }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: fromX + (dx * i) / 8, y }],
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  return () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const FIXED = [".m-hdr__titles", ".m-hdr__setlogo", ".m-hdr--detail", ".m-detail__bar"];
const MOVING = [
  ".m-page:not(.m-page--ghost) .m-dreg3__own",
  ".m-page:not(.m-page--ghost) .m-detail__body",
];

test("s2-08-swipe-body-slides", async ({ page }) => {
  await openCard(page, "ASH", 112);
  const before: Record<string, number[] | null> = {};
  for (const s of [...FIXED, ...MOVING]) before[s] = await rect(page, s);
  const hash0 = await page.evaluate(() => location.hash);
  const n0 = await posNum(page);
  // Mid-drag: the neighbour's page is in view beside this one; the header
  // (titles, logo, starfield) and the bar have not moved; the route has not.
  const release = await touchHold(page, 320, -144);
  const mid = await page.evaluate(() => ({
    ghost: !!document.querySelector(".m-page--ghost.m-page--next"),
    track: (document.querySelector(".m-detail__track") as HTMLElement).style.transform,
    headerInTrack: !!document.querySelector(".m-detail__track .m-hdr--detail"),
    hash: location.hash,
  }));
  expect(mid.ghost).toBe(true);
  expect(mid.track).toMatch(/^translate3d\(-1\d\dpx/);
  expect(mid.headerInTrack).toBe(false);
  expect(mid.hash).toBe(hash0);
  for (const s of FIXED) expect(await rect(page, s), s).toEqual(before[s]);
  for (const s of MOVING) expect((await rect(page, s))![0], s).toBeLessThan(before[s]![0] - 60);
  // The neighbour sits one page width to the right of the current page.
  const ghostLeft = await rect(page, ".m-page--ghost .m-detail__body");
  const iw = await page.evaluate(() => innerWidth);
  expect(Math.abs(ghostLeft![0] - (await rect(page, MOVING[1]))![0] - iw)).toBeLessThanOrEqual(1);
  await release();
  // card-swiped-next: committed -> the next card, no ghost left.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => location.hash)).not.toBe(hash0);
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/card\/\d+$/);
  expect(await posNum(page)).toBe(n0 + 1);
  expect(await page.locator(".m-page--ghost").count()).toBe(0);
});

test("s2-08-snapback", async ({ page }) => {
  await openCard(page, "ASH", 112);
  const hash0 = await page.evaluate(() => location.hash);
  await swipe(page, 320, 270, 300);
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => location.hash)).toBe(hash0);
  const st = await page.evaluate(() => ({
    track: (document.querySelector(".m-detail__track") as HTMLElement).style.transform,
    ghost: document.querySelectorAll(".m-page--ghost").length,
  }));
  expect(st.track).toMatch(/^translate3d\(0px/);
  expect(st.ghost).toBe(0);
  // card-swipe-route-after-motion: a committing swipe changes the route only
  // when the 0.2 s slide has finished.
  await swipe(page, 320, 120, 300);
  expect(await page.evaluate(() => location.hash)).toBe(hash0);
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => location.hash)).not.toBe(hash0);
});

test("s2-08-first-edge", async ({ page }) => {
  // card-swipe-first-edge: the first card of the list -- a right swipe is
  // dampened (a quarter of the finger) and always snaps back.
  await openCard(page, "SOR", 10);
  await page.locator('[aria-label="Previous card"]').isVisible();
  for (let i = 0; i < 60 && (await posNum(page)) > 1; i++) {
    await page.evaluate(() =>
      (document.querySelector('[aria-label="Previous card"]') as HTMLButtonElement).click()
    );
    await page.waitForTimeout(330);
  }
  expect(await posNum(page)).toBe(1);
  await expect(page.locator('[aria-label="Previous card"]')).toBeDisabled();
  const hash0 = await page.evaluate(() => location.hash);
  const release = await touchHold(page, 60, 240);
  const tr = await page.evaluate(
    () => (document.querySelector(".m-detail__track") as HTMLElement).style.transform
  );
  expect(Number(/translate3d\(([\d.]+)px/.exec(tr)![1])).toBeCloseTo(60, 0);
  expect(await page.locator(".m-page--ghost").count()).toBe(0);
  await release();
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => location.hash)).toBe(hash0);
});

interface MidSample {
  bad: string[];
  same: boolean;
  ghost: boolean;
  ghostEmpty: boolean;
  dupIds: string[];
  track: string;
  trackTransition: string;
  xfade: string;
  xout: string;
}

test("s2-08-transform-only", async ({ page }) => {
  await openCard(page, "ASH", 112);
  const hash0 = await page.evaluate(() => location.hash);
  // card-arrow-slides: the chevron mounts the neighbour and slides first.
  // Wait for the slide itself to be under way (not a fixed delay), then
  // sample within its 200 ms.
  // Hardened (S4 4b full-green flake): sample inside the poll itself, on the
  // first frame the slide is under way AND both header layers exist -- a
  // separate waitForFunction + evaluate round trip could land after the
  // 200 ms slide had ended under load.
  type Handle = Awaited<ReturnType<typeof page.waitForFunction>>;
  let midHandle!: Handle;
  // A chevron tap before the card layer has its neighbour list is a no-op, so
  // retry the tap (only while no slide has happened) until a slide starts.
  await expect(async () => {
    expect(await page.evaluate(() => location.hash)).toBe(hash0);
    await page.evaluate(() =>
      (document.querySelector('[aria-label="Next card"]') as HTMLButtonElement).click()
    );
    midHandle = await page.waitForFunction(
      (h) => {
        const tr = (document.querySelector(".m-detail__track") as HTMLElement).style.transform;
        if (
          !/^translate3d\(-/.test(tr) ||
          !document.querySelector(".m-hdr__titles.m-xfade--in") ||
          !document.querySelector(".m-hdr__titles:not(.m-xfade--in)")
        )
          return null;

        const bad: string[] = [];
        for (const e of document.querySelectorAll(".m-detail *")) {
          const cs = getComputedStyle(e);
          if (!cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) continue;
          if (e.closest(".m-detail__bar, .swu-btn, .m-seg")) continue;
          const props = cs.transitionProperty.split(",").map((s) => s.trim());
          const ok = [
            "transform",
            "opacity",
            "visibility",
            "background",
            "background-color",
            "color",
            "border-color",
            "box-shadow",
          ];
          if (props.some((x) => !ok.includes(x))) out(e, cs.transitionProperty);
          const kf = cs.animationName;
          if (
            kf &&
            kf !== "none" &&
            kf !== "m-xin" &&
            kf !== "m-xout" &&
            !/cp-image-flip|m-layer/.test(kf)
          )
            out(e, kf);
        }
        function out(e: Element, what: string) {
          bad.push(String(e.className).slice(0, 40) + " :: " + what);
        }
        const t = document.querySelector(".m-detail__track") as HTMLElement;
        return {
          bad,
          same: location.hash === h,
          ghost: !!document.querySelector(".m-page--ghost.m-page--next"),
          // F2: the neighbour's chart is not live -- it must not claim "no data".
          ghostEmpty: /No price data/.test(
            document.querySelector(".m-page--ghost")?.textContent ?? ""
          ),
          // F8: the section ids are unique while two pages are mounted.
          dupIds: [...document.querySelectorAll('.m-detail [id^="sec-"]')]
            .map((e) => e.id)
            .filter((id, i, a) => a.indexOf(id) !== i),
          track: t.style.transform,
          trackTransition: t.style.transition,
          xfade: getComputedStyle(document.querySelector(".m-hdr__titles.m-xfade--in")!)
            .animationName,
          xout: getComputedStyle(document.querySelector(".m-hdr__titles:not(.m-xfade--in)")!)
            .animationName,
        };
      },
      hash0,
      { polling: "raf", timeout: 2500 }
    );
  }).toPass({ timeout: 25000 });
  const mid = (await midHandle.jsonValue()) as MidSample;
  expect(mid.bad).toEqual([]);
  expect(mid.same).toBe(true);
  expect(mid.ghost).toBe(true);
  expect(mid.ghostEmpty).toBe(false);
  expect(mid.dupIds).toEqual([]);
  expect(mid.track).toMatch(/^translate3d\(-/);
  expect(mid.trackTransition).toMatch(/^transform 200ms/);
  // The header's titles cross-dissolve (opacity only) to the neighbour's.
  expect([mid.xout, mid.xfade]).toEqual(["m-xout", "m-xin"]);
  await page.waitForTimeout(450);
  const hash1 = await page.evaluate(() => location.hash);
  expect(hash1).not.toBe(hash0);
  // Nothing fades after the move; the chevron runs the same slide back.
  const end = await page.evaluate(() => ({
    layers: document.querySelectorAll(".m-xfade--in, .m-page--ghost").length,
    op: getComputedStyle(document.querySelector(".m-hdr__titles")!).opacity,
  }));
  expect(end).toEqual({ layers: 0, op: "1" });
  // Hardened: a chevron tap while the card layer is still settling from the
  // first slide is a no-op, so retry it (only while no slide has started).
  await expect(async () => {
    await page.evaluate(() =>
      (document.querySelector('[aria-label="Previous card"]') as HTMLButtonElement).click()
    );
    await expect(page.locator(".m-page--ghost.m-page--prev")).toHaveCount(1, { timeout: 1500 });
  }).toPass({ timeout: 20000 });
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => location.hash)).toBe(hash0);
});

test("s2-08-collapse-carries", async ({ page }) => {
  // r3-12-body-collapse-intact: a swipe from a collapsed card lands on the
  // next card still collapsed (R3-6), and a tap still re-expands it.
  await openCard(page, "ASH", 112);
  await scrollDetail(page, 300);
  await expect(page.locator(".m-dreg3--collapsed")).toHaveCount(1);
  const n0 = await posNum(page);
  await swipe(page, 320, 100, 500);
  await page.waitForTimeout(500);
  expect(await posNum(page)).toBe(n0 + 1);
  await expect(page.locator(".m-dreg3--collapsed")).toHaveCount(1);
  await page.locator(".m-dreg__btn").click();
  await page.waitForTimeout(400);
  await expect(page.locator(".m-dreg3--collapsed")).toHaveCount(0);
});

test("s2-08-close-mid-slide", async ({ page }) => {
  // F1: closing while the chevron's slide is still running leaves the Vault
  // on screen -- the slide's pending finish must not route to the neighbour.
  await openCard(page, "ASH", 112);
  await page.evaluate(() => {
    (document.querySelector('[aria-label="Next card"]') as HTMLButtonElement).click();
    setTimeout(() => (document.querySelector(".m-hdr__close") as HTMLButtonElement).click(), 60);
  });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => location.hash)).toBe("#/vault");
  expect(await page.locator(".m-detail").count()).toBe(0);
  // Router depth is consistent: opening a card again and closing returns to
  // the Vault, not somewhere else.
  await page.locator(".m-row[data-card]").first().click();
  await expect(page.locator(".m-detail")).toHaveCount(1);
  await page.locator(".m-hdr__close").click();
  await expect(page.locator(".m-detail")).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe("#/vault");
});
