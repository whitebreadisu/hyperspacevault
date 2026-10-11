import { expect, layoutProbe, measureEach, scrollBy, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-07 (R5-2): the title / [HSV] badge opens the chooser (replaces rev4
// r4-10-wordmark-opens-about); the unread cue is an opacity-only layer on the
// title / badge (from d2-0-cue-opacity-only) and must not cost the collapse
// its layout bound while it runs (d2-0-probe-with-cue-animating).
test.afterEach(measureEach);

test.beforeEach(async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone header");
  // A fresh visitor: nothing seen, so the newest release note is unread.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("swu.releaseNotes.lastSeen");
    } catch {
      /* ignore */
    }
  });
});

async function openVault(page: Page) {
  await page.goto("/#/vault");
  await expect(page.locator(".m-interim__row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectChooser(page: Page) {
  const dlg = page.locator(".m-chooser [role=dialog]");
  await expect(dlg).toBeVisible();
  const btns = dlg.locator(".swu-btn");
  await expect(btns).toHaveText(["About & Legal", "[HSV] Updates"]);
  const m = await page.evaluate(() => {
    const card = document.querySelector(".m-chooser__card")!.getBoundingClientRect();
    const x = document.querySelector(".m-chooser__x")!.getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector(".m-chooser__card")!);
    const bar = getComputedStyle(document.querySelector(".m-chooser__card")!, "::before");
    return {
      x: { w: x.width, h: x.height, right: x.right, top: x.top },
      card: { right: card.right, top: card.top, left: card.left },
      radius: cs.borderRadius,
      clip: cs.clipPath,
      bar: { bg: bar.backgroundColor, h: bar.height },
      iw: innerWidth,
    };
  });
  // X top-right, 44 px; transactional family (blue 3 px top bar, 4 px radius, no steel cut).
  expect(m.x.w).toBeGreaterThanOrEqual(44);
  expect(m.x.h).toBeGreaterThanOrEqual(44);
  expect(m.card.right - m.x.right).toBeLessThanOrEqual(4);
  expect(m.x.top - m.card.top).toBeLessThanOrEqual(6);
  expect(m.radius).toBe("4px");
  expect(m.clip).toBe("none");
  expect(m.bar).toEqual({ bg: "rgb(37, 99, 235)", h: "3px" });
  expect(m.card.left).toBeGreaterThanOrEqual(16);
  expect(m.card.right).toBeLessThanOrEqual(m.iw - 16);
}

test("s1-07-title-chooser", async ({ page }) => {
  await openVault(page);
  await page.locator(".m-vh__brandtext").click();
  await expectChooser(page);
  // X closes; nothing navigated; opening the chooser alone keeps the cue.
  await page.locator(".m-chooser__x").click();
  await expect(page.locator(".m-chooser")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.locator(".m-vh__word.m-cue")).toHaveCount(1);

  // Collapsed: the badge opens the same chooser and does not expand the strip.
  await scrollBy(page, ".m-vault__scroll", 420);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  await page.locator(".m-vh__hsv").click();
  await expectChooser(page);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-chooser")).toHaveCount(0);

  // About & Legal navigates to #/about (ComingSoon until S4).
  await page.locator(".m-vh__hsv").click();
  await page.locator(".m-chooser .swu-btn", { hasText: "About & Legal" }).click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator(".m-chooser")).toHaveCount(0);
});

/** Running animations: every keyframe property is opacity / transform. */
const anims = () => {
  const bad: string[] = [];
  const all = document.getAnimations();
  for (const a of all) {
    const kf = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
    const props = new Set<string>();
    kf.forEach((k) =>
      Object.keys(k).forEach((x) => {
        if (!["offset", "computedOffset", "easing", "composite"].includes(x)) props.add(x);
      })
    );
    if ([...props].some((x) => x !== "opacity" && x !== "transform"))
      bad.push(((a as CSSAnimation).animationName ?? "?") + ":" + [...props].join("/"));
  }
  const cue = all.filter(
    (a) => (a as CSSAnimation).animationName === "d2-cue-glow" && a.playState === "running"
  );
  return { cue: cue.length, bad };
};

test("s1-07-cue-opacity-only-on-title", async ({ page }) => {
  await openVault(page);
  const r = await page.evaluate(anims);
  expect(r.bad).toEqual([]);
  expect(r.cue).toBeGreaterThanOrEqual(1);
  const own = await page.evaluate(() => {
    const w = document.querySelector(".m-vh__word")!;
    const after = getComputedStyle(w, "::after");
    const more = document.querySelector(".m-nav .m-tab:last-child")!;
    return {
      wordAnim: getComputedStyle(w).animationName,
      afterAnim: after.animationName,
      afterPos: after.position,
      moreAnims: [more, ...more.querySelectorAll("*")].flatMap((e) => [
        getComputedStyle(e).animationName,
        getComputedStyle(e, "::before").animationName,
        getComputedStyle(e, "::after").animationName,
      ]),
    };
  });
  // The glyphs are not animated; a separate absolutely positioned layer is.
  expect(own.wordAnim).toBe("none");
  expect(own.afterAnim).toBe("d2-cue-glow");
  expect(own.afterPos).toBe("absolute");
  // The More tab never glows.
  expect(own.moreAnims.every((a) => a === "none")).toBe(true);

  // The chooser's Updates button carries the pulse; opening the chooser alone does not clear.
  await page.locator(".m-vh__brandtext").click();
  await expect(page.locator(".m-chooser__btn--cue .m-cue")).toHaveCount(1);
  // Updates navigation clears the cue for the session (and in storage).
  await page.locator(".m-chooser .swu-btn", { hasText: "[HSV] Updates" }).click();
  await expect(page).toHaveURL(/#\/more\/updates$/);
  await page.locator(".m-nav .m-tab", { hasText: "Vault" }).click();
  await expect(page.locator(".m-vh__word")).toBeVisible();
  await expect(page.locator(".m-cue")).toHaveCount(0);
  await page.waitForTimeout(300); // let the tab's 0.15 s colour transition finish
  expect(await page.evaluate(anims)).toEqual({ cue: 0, bad: [] });
  expect(
    await page.evaluate(() => localStorage.getItem("swu.releaseNotes.lastSeen"))
  ).not.toBeNull();

  // Reduced motion: a steady glow, no pulse.
  await page.evaluate(() => localStorage.removeItem("swu.releaseNotes.lastSeen"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  // (Settle first: a reload aborts in-flight third-party pixels, which the
  // health check would record as failed requests.)
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.locator(".m-vh__word.m-cue")).toHaveCount(1);
  const rm = await page.evaluate(() => {
    const a = getComputedStyle(document.querySelector(".m-vh__word")!, "::after");
    return { name: a.animationName, op: +a.opacity };
  });
  expect(rm.name).toBe("none");
  expect(rm.op).toBeCloseTo(0.85, 2);
});

test("s1-07-probe-with-cue-animating", async ({ page }) => {
  await openVault(page);
  const cue = () => {
    const a = document
      .getAnimations()
      .filter((x) => (x as CSSAnimation).animationName === "d2-cue-glow");
    return {
      running: a.filter((x) => x.playState === "running").length,
      t: a.map((x) => Math.round(Number(x.currentTime ?? 0))),
    };
  };
  const before = await page.evaluate(cue);
  const probe = await layoutProbe(page, () => {
    document.querySelector(".m-vault__scroll")!.scrollTop = 60;
  });
  const after = await page.evaluate(cue);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  expect(before.running).toBeGreaterThanOrEqual(1);
  expect(after.running).toBe(before.running);
  after.t.forEach((t, i) => expect(t).toBeGreaterThan(before.t[i] + 300));
  expect(probe.layouts, JSON.stringify(probe)).toBeLessThanOrEqual(4);
  expect(probe.shifts).toBe(0);
  console.log(`probe-with-cue ${test.info().project.name}: ${JSON.stringify(probe)}`);
});
