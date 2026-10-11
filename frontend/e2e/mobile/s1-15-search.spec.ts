import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-15: search mode (R5-4). Focus collapses the app header, the collection
// panel, the status row and the bottom bar to nothing (separators stay);
// blur restores; clearing the query does not. Headless checks cannot raise
// the iOS keyboard (R5-4 note): the visualViewport wiring is exercised by
// the frame tests, the feel is judged on the device.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone search");
});

const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
  name: string;
  subtitle: string | null;
}[];
const LUKE = CARDS.filter((c) => /luke/i.test(`${c.name} ${c.subtitle ?? ""}`)).length;
const INPUT = ".m-search__input";

async function openVault(page: Page) {
  await page.goto("/#/vault");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

const state = (p: Page) =>
  p.evaluate(() => {
    const box = (s: string) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return { t: r.top, b: r.bottom, l: r.left, r: r.right, h: r.height };
    };
    const cs = (s: string) => getComputedStyle(document.querySelector(s)!);
    return {
      searching: !!document.querySelector(".m-vault--search"),
      appSearch: !!document.querySelector(".m-app--search"),
      top: {
        op: cs(".m-vh > .m-vh__top").opacity,
        tf: cs(".m-vh > .m-vh__top").transform,
        vis: cs(".m-vh > .m-vh__top").visibility,
      },
      panel: { op: cs(".m-vh > .m-vh__panel").opacity, vis: cs(".m-vh > .m-vh__panel").visibility },
      status: { op: cs(".m-vault__status").opacity, vis: cs(".m-vault__status").visibility },
      filters: cs(".m-filterbtn").display,
      navRow: { op: cs(".m-nav__row").opacity, vis: cs(".m-nav__row").visibility },
      seam: box(".m-vh__seam"),
      navSep: box(".m-nav__sep"),
      nav: box(".m-nav"),
      search: box(".m-search"),
      scroll: box(".m-vault__scroll"),
      ih: innerHeight,
      focused: document.activeElement?.classList.contains("m-search__input") ?? false,
    };
  });

test("s1-15-search-mode-collapses", async ({ page }) => {
  await openVault(page);
  await page.locator(INPUT).focus();
  await page.waitForTimeout(450);
  const s = await state(page);
  expect(s.searching && s.appSearch).toBe(true);
  // Headers + status row gone (opacity 0, translated / hidden).
  expect(s.top.op).toBe("0");
  expect(s.top.tf).not.toBe("none");
  expect(s.top.vis).toBe("hidden");
  expect(s.panel.op).toBe("0");
  expect(s.status.op).toBe("0");
  expect(s.status.vis).toBe("hidden");
  expect(s.filters).toBe("none");
  // The bar collapsed to its seam at the bottom edge.
  expect(s.navRow.op).toBe("0");
  expect(s.nav.t).toBeGreaterThanOrEqual(s.ih - 8);
  // The two separators remain, at the top and the bottom edge.
  expect(s.seam.h).toBeGreaterThan(4);
  expect(s.seam.t).toBeGreaterThanOrEqual(-0.5);
  expect(s.seam.b).toBeLessThanOrEqual(16);
  expect(s.navSep.h).toBeGreaterThan(4);
  expect(s.navSep.b).toBeLessThanOrEqual(s.ih + 0.5);
  expect(s.navSep.t).toBeGreaterThanOrEqual(s.ih - 16);
  // The search box sits under the top seam; the list fills down to the bar seam.
  expect(s.search.t).toBeGreaterThanOrEqual(s.seam.b - 6);
  expect(s.search.t).toBeLessThanOrEqual(s.seam.b + 16);
  expect(Math.abs(s.scroll.t - (s.search.b + 8))).toBeLessThanOrEqual(2);
  expect(s.scroll.b).toBeGreaterThanOrEqual(s.nav.t - 0.5);
  expect(s.scroll.b).toBeLessThanOrEqual(s.ih + 0.5);
  expect(s.focused).toBe(true);
});

test("s1-15-restores-on-blur", async ({ page }) => {
  await openVault(page);
  const rest = await state(page);
  await page.locator(INPUT).focus();
  await page.locator(INPUT).fill("vader");
  await page.waitForTimeout(300);
  // Clearing the query while focused does NOT restore.
  await page.locator(".m-search__clear").click();
  await page.waitForTimeout(300);
  const cleared = await state(page);
  expect(cleared.searching).toBe(true);
  expect(cleared.focused).toBe(true);
  expect(await page.locator(INPUT).inputValue()).toBe("");
  // Blur restores everything.
  await page.locator(INPUT).blur();
  await page.waitForTimeout(450);
  const back = await state(page);
  expect(back.searching || back.appSearch).toBe(false);
  expect(back.top).toEqual(rest.top);
  expect(back.panel).toEqual(rest.panel);
  expect(back.status).toEqual(rest.status);
  expect(back.filters).toBe(rest.filters);
  expect(back.navRow).toEqual(rest.navRow);
  for (const k of ["nav", "search", "scroll", "seam"] as const)
    expect(Math.abs(back[k].t - rest[k].t), k).toBeLessThanOrEqual(1);
});

test("s1-15-search-narrows-totals", async ({ page }) => {
  await openVault(page);
  await page.locator(INPUT).fill("luke");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => ({
    count: document.querySelector(".m-count")!.textContent!.trim(),
    amber: getComputedStyle(document.querySelector(".m-count")!).color,
    badge: document.querySelector(".m-filterbtn__n")?.textContent,
    clear: !!document.querySelector(".m-clearbtn"),
    names: [...document.querySelectorAll(".m-row__name")].map((e) => e.textContent),
  }));
  expect(LUKE).toBeGreaterThan(1);
  expect(r.count).toBe(`${LUKE} cards`);
  expect(r.amber).toBe("rgb(242, 193, 78)");
  expect(r.badge).toBe("1");
  expect(r.clear).toBe(true);
  expect(r.names.every((n) => /luke/i.test(n ?? ""))).toBe(true);
});

test("s1-15-search-nomatch", async ({ page }) => {
  await openVault(page);
  await page.locator(INPUT).fill("zzz");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const e = document.querySelector(".m-vault__scroll .m-empty")!;
    return {
      text: e.textContent!.trim(),
      ps: e.querySelectorAll("p").length,
      art: e.querySelectorAll("img, svg").length,
      rows: document.querySelectorAll(".m-row").length,
      count: document.querySelector(".m-count")!.textContent!.trim(),
    };
  });
  // S1-21: one plain sentence, desktop's (CardsTable.tsx:390), no illustration.
  expect(r).toEqual({
    text: "No cards match the current filters.",
    ps: 1,
    art: 0,
    rows: 0,
    count: "0 cards",
  });
});

test("s1-15-transform-only", async ({ page }) => {
  await openVault(page);
  const props = () =>
    page.evaluate(() =>
      document.getAnimations().map((a) => {
        const t = (a.effect as KeyframeEffect).target as Element;
        const prop =
          a instanceof CSSTransition
            ? a.transitionProperty
            : [
                ...new Set(
                  (a.effect as KeyframeEffect)
                    .getKeyframes()
                    .flatMap((k) => Object.keys(k))
                    .filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k))
                ),
              ].join("+");
        return {
          prop,
          sky: t.classList.contains("m-vh__sky"),
          cls: String(t.className).slice(0, 30),
        };
      })
    );
  // The field's own focus ring (desktop .ac-input border / background colour
  // transition, paint only) is not part of the enter / leave motion.
  const ok = (list: { prop: string; sky: boolean; cls: string }[]) =>
    list
      .filter((x) => !(x.cls.startsWith("m-search__input") && /color/.test(x.prop)))
      .every((x) =>
        x.prop
          .split("+")
          .every((p) => /^(transform|opacity|visibility)$/.test(p) || (p === "clip-path" && x.sky))
      );
  await page.locator(INPUT).focus();
  await page.waitForTimeout(40);
  const enter = await props();
  expect(enter.length).toBeGreaterThan(0);
  expect(ok(enter), JSON.stringify(enter)).toBe(true);
  await page.waitForTimeout(400);
  await page.locator(INPUT).blur();
  await page.waitForTimeout(40);
  const leave = await props();
  expect(leave.length).toBeGreaterThan(0);
  expect(ok(leave), JSON.stringify(leave)).toBe(true);
});
