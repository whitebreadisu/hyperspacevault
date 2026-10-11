import { expect, measureEach, test } from "./helpers";
import {
  b1Motion,
  b1NoOverflow,
  b1Targets,
  CARDS,
  FSHEET,
  openFilters,
  tapIn,
} from "./filters-helpers";

// S2-19: the Gameplay section (rev4 r4-2-gameplay-collapsed,
// r4-3-gameplay-expands, b1-aspects-mode-meaning, b1-badge-mode-only,
// b1-aspect-first-tap-narrows, b1-type-rarity-chips, b1-arena-chips,
// b1-picker-keyword, b1-picker-trait-search, b1-picker-inert,
// b1-picker-targets-44, b1-range-slider; desktop FilterPanel's Gameplay
// group, AspectPicker / AspectModeControl, MultiSelect searchable,
// RangeSlider).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone filters");
});

type FixtureCard = (typeof CARDS)[number] & {
  type: string;
  arena: string | null;
  cost: number | null;
};
const ALL = CARDS as FixtureCard[];
const showN = (n: number) => (n === 1 ? "Show 1 card" : `Show ${n} cards`);
const SHOW = `${FSHEET} .m-filterfoot__show`;

async function openGameplay(page: import("@playwright/test").Page, hash?: string) {
  await openFilters(page, hash);
  await tapIn(page, ".m-fgame__head");
  await expect(page.locator(`${FSHEET} .m-fgame__body`)).toBeVisible();
  await page.waitForTimeout(300);
}

test("s2-19-gameplay-collapsed", async ({ page }) => {
  await openFilters(page);
  const head = page.locator(`${FSHEET} .m-fgame__head`);
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(`${FSHEET} .m-fgame__body`)).toHaveCount(0);
  await expect(head.locator(".m-fmore__n")).toHaveCount(0);
  await head.click();
  // Open: desktop's Gameplay order with Aspects first.
  const order = await page
    .locator(`${FSHEET} .m-fgame__body`)
    .evaluate((b) =>
      [...b.children]
        .map(
          (e) =>
            (e as HTMLElement).dataset.facet ??
            (e as HTMLElement).dataset.picker ??
            (e as HTMLElement).dataset.range
        )
        .join(",")
    );
  expect(order).toBe("aspects,type,arena,keyword,trait,cost,power,hp");
  await page.waitForTimeout(300);
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual({ out: [], sideways: false, page: false });
  expect(await page.evaluate(b1Motion)).toEqual([]);
  // Type Leader + Arena Ground, then collapse: "· 2 active" (one per group).
  await tapIn(page, '[data-facet="type"] .m-fchip[data-fv="Leader"]');
  await tapIn(page, '[data-facet="arena"] .m-fchip[data-fv="Ground"]');
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(head.locator(".m-fmore__n")).toHaveText("· 2 active");
  await expect(page.locator(".m-filterbtn__n")).toHaveText("2");
});

test("s2-19-aspects-mode", async ({ page }) => {
  await openGameplay(page);
  const chits = page.locator(`${FSHEET} [data-facet="aspects"] .m-faspect`);
  const state = () =>
    chits.evaluateAll((es) =>
      es.map((e) => (e as HTMLElement).dataset.fv + "=" + e.getAttribute("aria-pressed"))
    );
  const s0 = await state();
  expect(s0.length).toBe(7);
  expect(s0[6]).toBe("__none__=true");
  expect(s0.every((x) => x.endsWith("=true"))).toBe(true);
  await expect(page.locator(`${FSHEET} .m-fmode [aria-checked="true"]`)).toHaveText("Exact");
  await expect(page.locator(`${FSHEET} .m-fmeaning`)).toHaveText(
    "Cards whose aspects match the selection exactly."
  );
  // A mode-only change counts 1 though it filters nothing (desktop quirk).
  await tapIn(page, '.m-fmode [role="radio"]:has-text("Within")');
  const meaning = await page.locator(`${FSHEET} .m-fmeaning`).evaluate((e) => ({
    t: e.textContent,
    oneLine: e.getBoundingClientRect().height < 24 && e.scrollWidth <= e.clientWidth,
  }));
  expect(meaning).toEqual({
    t: "Cards whose aspects all fit inside the selection.",
    oneLine: true,
  });
  await expect(page.locator(`${FSHEET} .m-sheet__sub`)).toHaveText("1 active");
  await expect(page.locator(SHOW)).toHaveText(showN(ALL.length));
  // BL-90: the first tap narrows to that aspect, the others dim; removing
  // the last lands back on unfiltered.
  await tapIn(page, '.m-faspect[data-fv="Aggression"]');
  const s1 = await state();
  expect(s1.filter((x) => x.endsWith("=true"))).toEqual(["Aggression=true"]);
  expect(await page.locator(`${FSHEET} .m-faspect--off`).count()).toBeGreaterThanOrEqual(5);
  await tapIn(page, '.m-faspect[data-fv="Aggression"]');
  await expect(page.locator(`${FSHEET} .m-faspect--off`)).toHaveCount(0);
  // Type + Rarity chips narrow, one bump each.
  await tapIn(page, '.m-fmode [role="radio"]:has-text("Exact")');
  await tapIn(page, '[data-facet="type"] .m-fchip[data-fv="Leader"]');
  await tapIn(page, '[data-facet="rarity"] .m-fchip[data-fv="Special"]');
  const n = ALL.filter((c) => c.type === "Leader" && c.rarity === "Special").length;
  await expect(page.locator(SHOW)).toHaveText(showN(n));
  await expect(page.locator(`${FSHEET} .m-sheet__sub`)).toHaveText("2 active");
});

test("s2-19-keyword-picker", async ({ page }) => {
  await openGameplay(page);
  await tapIn(page, '[data-picker="keyword"]');
  const K = page.locator(".m-sheet-layer--plist-keyword");
  await expect(K).toBeVisible();
  await page.waitForTimeout(350);
  const kw = new Set(ALL.flatMap((c) => (c as unknown as { keywords: string[] }).keywords));
  const r = await K.evaluate((el) => ({
    top: el.querySelector(".m-sheet")!.getBoundingClientRect().top,
    focused: !!document.activeElement?.closest(".m-picker__search"),
    rows: el.querySelectorAll(".m-picker__list .m-fcheck").length,
    font: getComputedStyle(el.querySelector(".m-search__input")!).fontSize,
  }));
  expect(r.top).toBeLessThan(30);
  expect(r.focused).toBe(true);
  expect(r.rows).toBe(kw.size);
  expect(r.font).toBe("16px");
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual({ out: [], sideways: false, page: false });
  await K.locator(".m-picker__done").click();
  await expect(K).toHaveCount(0);

  // Trait: typing narrows the list; All becomes "All matches (n)"; Done
  // returns to Filters with the pick on the row.
  await tapIn(page, '[data-picker="trait"]');
  const T = page.locator(".m-sheet-layer--plist-trait");
  await expect(T).toBeVisible();
  await page.waitForTimeout(350);
  await page.keyboard.type("je");
  const rows = await T.locator(".m-picker__list .m-fcheck").evaluateAll((es) =>
    es.map((e) => (e as HTMLElement).dataset.fv)
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((v) => /je/i.test(v!))).toBe(true);
  const all = T.locator(".m-picker__bar .m-flink").first();
  await expect(all).toHaveText(`All matches (${rows.length})`);
  await all.click();
  await expect(T.locator(".m-sheet__sub")).toHaveText(`${rows.length} selected`);
  await T.locator(".m-picker__done").click();
  await expect(T).toHaveCount(0);
  await expect(page.locator(`${FSHEET} [data-picker="trait"] .m-frow__v`)).toHaveText(
    rows.length === 1 ? rows[0]! : `${rows.length} selected`
  );
});

test("s2-19-picker-inert", async ({ page }) => {
  await openGameplay(page, "#/vault?set=IBH&sheet=filters");
  await tapIn(page, '[data-picker="trait"]');
  const T = page.locator(".m-sheet-layer--plist-trait");
  await expect(T).toBeVisible();
  const r = await T.evaluate((el) => {
    const inert = [
      ...el.querySelectorAll(".m-picker__list .m-fcheck--inert"),
    ] as HTMLButtonElement[];
    return {
      n: inert.length > 0,
      all: inert.every((e) => e.disabled && /\(0\)$/.test(e.getAttribute("aria-label")!)),
    };
  });
  expect(r).toEqual({ n: true, all: true });
});

test("s2-19-range-slider", async ({ page }) => {
  await openGameplay(page);
  const hi = page.locator(`${FSHEET} .m-range[data-range="cost"] [aria-label="Cost maximum"]`);
  await hi.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
  await expect(page.locator(`${FSHEET} .m-range[data-range="cost"] .m-range__read`)).toHaveText(
    "0 – 5"
  );
  const n = ALL.filter((c) => c.cost != null && c.cost <= 5).length;
  await expect(page.locator(SHOW)).toHaveText(showN(n));
  await expect(page.locator(".m-filterbtn__n")).toHaveText("1");
  // Two 44 px thumbs on one track.
  const thumbs = await page
    .locator(`${FSHEET} .m-range[data-range="hp"] .m-range__thumb`)
    .evaluateAll((es) =>
      es.map(
        (e) =>
          Math.round(e.getBoundingClientRect().width) +
          "x" +
          Math.round(e.getBoundingClientRect().height)
      )
    );
  expect(thumbs).toEqual(["44x44", "44x44"]);
  // A tap on the track moves the nearer thumb (HP max to the middle).
  const track = page.locator(`${FSHEET} .m-range[data-range="hp"] .m-range__track`);
  await track.scrollIntoViewIfNeeded();
  const box = (await track.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  const now = Number(
    await page
      .locator(`${FSHEET} .m-range[data-range="hp"] [aria-label="HP maximum"]`)
      .getAttribute("aria-valuenow")
  );
  expect(now).toBeGreaterThanOrEqual(15);
  expect(now).toBeLessThanOrEqual(20);
  await expect(page.locator(`${FSHEET} .m-fgame__head .m-fmore__n`)).toHaveText("· 2 active");
});
