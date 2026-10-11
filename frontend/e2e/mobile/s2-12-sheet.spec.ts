import { expect, measureEach, test } from "./helpers";
import { BASE_SETS, CARDS, FSHEET, openFilters, tapIn } from "./filters-helpers";

// S2-12: the Filters sheet frame (rev4 f-4-sheet-fits-content,
// f-4-sheet-grow-transform-only, b1-show-n-live, b1-reset,
// b1-reset-inert-default, b1-close-x, b0-q10-filters-not-persisted).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone filters");
});

test("s2-12-sheet-fits-content", async ({ page }) => {
  await openFilters(page);
  const r = await page.evaluate((sel) => {
    const L = document.querySelector(sel)!;
    const s = L.querySelector(".m-sheet")!;
    const scroll = L.querySelector(".m-filters__scroll")!;
    const lr = L.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    const game = L.querySelector(".m-fgame")!.getBoundingClientRect();
    const foot = L.querySelector(".m-filters__foot")!.getBoundingClientRect();
    return {
      underCap: sr.height < lr.height * 0.86 - 40,
      noScroll: scroll.scrollHeight <= scroll.clientHeight,
      gapUnderGameplay: Math.round(scroll.getBoundingClientRect().bottom - game.bottom),
      bottomAnchored: Math.abs(sr.bottom - lr.bottom) <= 1,
      footInView: foot.bottom <= innerHeight + 0.5,
      footUnderScroll: foot.top >= scroll.getBoundingClientRect().bottom - 0.5,
      maxHeight: getComputedStyle(s).maxHeight,
      tall: s.classList.contains("m-sheet--tall"),
    };
  }, FSHEET);
  expect(r).toEqual({
    underCap: true,
    noScroll: true,
    gapUnderGameplay: expect.any(Number) as number,
    bottomAnchored: true,
    footInView: true,
    footUnderScroll: true,
    maxHeight: "86%",
    tall: false,
  });
  expect(r.gapUnderGameplay).toBeLessThanOrEqual(30);
});

/** Record every inline transform the sheet is given and every animation /
 * transition that runs on it, from now on. */
async function watchSheet(page: import("@playwright/test").Page) {
  await page.evaluate((sel) => {
    const s = document.querySelector<HTMLElement>(`${sel} .m-sheet`)!;
    const w = window as unknown as {
      __g: { h0: number; log: string[]; anims: string[]; on: boolean };
    };
    w.__g = { h0: s.getBoundingClientRect().height, log: [], anims: [], on: true };
    // The grow sets and clears the inline transform in one task, so the
    // observer reads it from the records' old values (one entry per start;
    // consecutive records of the same start are folded).
    let prev = "";
    new MutationObserver((recs) => {
      for (const r of recs) {
        const m = /transform:\s*(translateY\([^)]*\))/.exec(r.oldValue ?? "");
        const t = m ? m[1] : "";
        if (t && t !== prev) w.__g.log.push(t);
        prev = t;
      }
    }).observe(s, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });
    const tick = () => {
      s.getAnimations().forEach((a) => {
        const k =
          ((a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName ?? "?") +
          ":" +
          a.playState;
        if (!w.__g.anims.includes(k)) w.__g.anims.push(k);
      });
      if (w.__g.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, FSHEET);
}

test("s2-12-grow-transform-only", async ({ page }) => {
  await openFilters(page);
  await watchSheet(page);
  await tapIn(page, ".m-fgame__head");
  await page.waitForTimeout(60);
  const mid = await page.evaluate((sel) => {
    const s = document.querySelector(`${sel} .m-sheet`)!;
    return { t: getComputedStyle(s).transform, tp: getComputedStyle(s).transitionProperty };
  }, FSHEET);
  await page.waitForTimeout(400);
  const end = await page.evaluate((sel) => {
    const s = document.querySelector<HTMLElement>(`${sel} .m-sheet`)!;
    const w = window as unknown as { __g: { h0: number; log: string[]; anims: string[] } };
    return {
      d: Math.round(s.getBoundingClientRect().height - w.__g.h0),
      log: w.__g.log.slice(),
      anims: w.__g.anims.slice(),
      t: getComputedStyle(s).transform,
      inline: s.style.transform,
    };
  }, FSHEET);
  // Gameplay open: one grow, starting exactly translateY(<growth>), mid-way
  // non-zero, the transition is the transform alone, ending at none.
  expect(end.d).toBeGreaterThan(0);
  expect(end.log).toEqual([`translateY(${end.d}px)`]);
  expect(mid.t).toMatch(/^matrix\(1, 0, 0, 1, 0, [1-9]/);
  expect(mid.tp).toBe("transform");
  expect(end.anims.length).toBeGreaterThan(0);
  for (const a of end.anims) expect(a).toMatch(/^transform:/);
  expect(end.t).toBe("none");
  expect(end.inline).toBe("");

  // Chips wrapping the Set row grow it the same way (every base set at once;
  // logos arriving later grow it again, each grow from the drawn top).
  await tapIn(page, ".m-fgame__head");
  await page.waitForTimeout(300);
  await watchSheet(page);
  await page.evaluate((codes) => {
    location.hash = "#/vault?sheet=filters&set=" + codes.join(",");
  }, BASE_SETS);
  await page.waitForTimeout(600);
  const wrap = await page.evaluate((sel) => {
    const s = document.querySelector<HTMLElement>(`${sel} .m-sheet`)!;
    const w = window as unknown as { __g: { h0: number; log: string[]; anims: string[] } };
    const chips = [...document.querySelectorAll(`${sel} [data-facet="set"] .m-fsel`)];
    return {
      d: Math.round(s.getBoundingClientRect().height - w.__g.h0),
      lines: new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size,
      px: w.__g.log.map((x) => +(/^translateY\((\d+)px\)$/.exec(x) ?? [0, -1])[1]),
      anims: w.__g.anims.slice(),
      t: getComputedStyle(s).transform,
    };
  }, FSHEET);
  expect(wrap.lines).toBeGreaterThan(1);
  expect(wrap.d).toBeGreaterThan(0);
  expect(wrap.px.length).toBeGreaterThanOrEqual(1);
  for (const v of wrap.px) {
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(wrap.d);
  }
  for (const a of wrap.anims) expect(a).toMatch(/^transform:/);
  // A logo that loads late restarts the move from where it is drawn; it ends at none.
  await expect
    .poll(
      () =>
        page.evaluate(
          (sel) => getComputedStyle(document.querySelector(`${sel} .m-sheet`)!).transform,
          FSHEET
        ),
      { timeout: 3000 }
    )
    .toBe("none");
});

test("s2-12-reset-and-show-n", async ({ page }) => {
  await openFilters(page);
  const reset = page.locator(`${FSHEET} .m-resetbtn`);
  const show = page.locator(`${FSHEET} .m-filterfoot__show`);
  // Inert (not amber) at default; Show N = every card.
  await expect(reset).toHaveAttribute("aria-disabled", "true");
  expect(await reset.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(107, 122, 153)");
  await expect(show).toHaveText(`Show ${CARDS.length} cards`);
  await expect(page.locator(`${FSHEET} .m-sheet__sub`)).toHaveCount(0);

  // A rarity narrows live: Show N, the sub and the Filters badge follow.
  await tapIn(page, '[data-facet="rarity"] [data-fv="Rare"]');
  const rare = CARDS.filter((c) => c.rarity === "Rare").length;
  await expect(show).toHaveText(`Show ${rare} cards`);
  await expect(page.locator(`${FSHEET} .m-sheet__sub`)).toHaveText("1 active");
  await expect(reset).not.toHaveAttribute("aria-disabled", "true");
  expect(await reset.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(242, 193, 78)");
  const before = await reset.evaluate((e) => {
    const b = getComputedStyle(e, "::before");
    return [b.borderTopColor, b.backgroundColor];
  });
  expect(before).toEqual(["rgba(217, 154, 31, 0.4)", "rgba(217, 154, 31, 0.16)"]);
  const box = await reset.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Reset: back to default, inert again.
  await reset.click();
  await expect(reset).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(`${FSHEET} [data-fv="Rare"]`)).toHaveAttribute("aria-pressed", "false");
  await expect(show).toHaveText(`Show ${CARDS.length} cards`);

  // Show N closes the sheet onto the narrowed list.
  await tapIn(page, '[data-facet="rarity"] [data-fv="Rare"]');
  await show.click();
  await expect(page.locator(FSHEET)).toHaveCount(0);
  await expect(page.locator(".m-filterbtn__n")).toHaveText("1");
  await expect(page.locator(".m-count")).toHaveText(`${rare} cards`);
});

test("s2-12-reset-clears-search-set-and-toggles", async ({ page }) => {
  await openFilters(page, "#/vault?set=ASH&q=luke&sheet=filters");
  await expect(page.locator(`${FSHEET} .m-sheet__sub`)).toHaveText("2 active");
  await tapIn(page, ".m-resetbtn");
  await expect(page.locator(`${FSHEET} .m-resetbtn`)).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".m-vault__searchrow .m-search__input")).toHaveValue("");
  await expect(page.locator(`${FSHEET} [data-facet="set"] .m-frow4__ph`)).toHaveText("All sets");
});

test("s2-12-not-persisted", async ({ page }) => {
  await openFilters(page, "#/vault?set=ASH&sheet=filters");
  await tapIn(page, '[data-facet="rarity"] [data-fv="Rare"]');
  await expect(page.locator(".m-filterbtn__n")).toHaveText("2");
  // A fresh open (reload) starts with nothing narrowed.
  await page.goto("/#/vault");
  await page.reload();
  await expect(page.locator(".m-row").first()).toBeVisible();
  await expect(page.locator(".m-filterbtn__n")).toHaveCount(0);
  await expect(page.locator(".m-count")).toHaveText(`${CARDS.length} cards`);
  await page.locator(".m-filterbtn").click();
  await expect(page.locator(FSHEET)).toBeVisible();
  await expect(page.locator(`${FSHEET} [data-fv="Rare"]`)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(`${FSHEET} [data-facet="set"] .m-frow4__ph`)).toHaveText("All sets");
});

test("s2-12-x-top-right", async ({ page }) => {
  await openFilters(page);
  const r = await page.evaluate((sel) => {
    const x = document.querySelector(`${sel} .m-sheet__close`)!.getBoundingClientRect();
    const s = document.querySelector(`${sel} .m-sheet`)!.getBoundingClientRect();
    return {
      right: x.right > innerWidth - 30,
      top: x.top - s.top < 40,
      w: x.width,
      h: x.height,
    };
  }, FSHEET);
  expect(r).toEqual({ right: true, top: true, w: 44, h: 44 });
  await page.locator(`${FSHEET} .m-sheet__close`).click();
  await expect(page.locator(FSHEET)).toHaveCount(0);
  // The Filters button opens it again (onOpenFilters).
  await page.locator(".m-filterbtn").click();
  await expect(page.locator(FSHEET)).toBeVisible();
  await expect(page.locator(`${FSHEET} .m-sheet__title`)).toHaveText("Filters");
});
