import { expect, measureEach, test } from "./helpers";
import { b1NoOverflow, b1Targets, FSHEET, openFilters, tapIn } from "./filters-helpers";

// S2-13: the compact facet rows (rev4 r4-2-sheet-order, r4-2-gameplay-
// collapsed, r4-3-set-selected-chips, r4-3-rarity-inline,
// r4-3-collection-picker-anon / b1-collection-anon, b1-badge-set-one-group,
// b1-badge-search-counts, b2-badge-finish-group).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone filters");
});

test("s2-13-order", async ({ page }) => {
  await openFilters(page);
  const r = await page.evaluate((sel) => {
    const body = document.querySelector(`${sel} .m-filters__scroll`)!;
    const top = [...body.querySelectorAll("[data-facet]")]
      .filter((e) => !e.parentElement!.closest("[data-facet]"))
      .map((e) => (e as HTMLElement).dataset.facet);
    const labels = [...body.querySelectorAll(".m-frow4__k, .m-fgame__k")].map((e) =>
      getComputedStyle(e).textTransform === "uppercase" ? e.textContent : "!" + e.textContent
    );
    const head = body.querySelector(".m-fgame__head")!;
    const ph = [...body.querySelectorAll(".m-frow4__ph")].map((e) => e.textContent);
    const k = body.querySelector(".m-frow4__k")!;
    return {
      top: top.join(","),
      labels: labels.join(","),
      ph: ph.join(","),
      expanded: head.getAttribute("aria-expanded"),
      body: !!body.querySelector(".m-fgame__body"),
      count: !!head.querySelector(".m-fmore__n"),
      hint: head.querySelector(".m-fmore__hint")!.textContent,
      kWidth: k.getBoundingClientRect().width,
      rows: [...body.querySelectorAll(".m-frow4")].map((e) =>
        Math.round(e.getBoundingClientRect().height)
      ),
    };
  }, FSHEET);
  expect(r).toEqual({
    top: "set,rarity,collection,finish,gameplay",
    labels: "Set,Rarity,Collection,Finish,Gameplay",
    ph: "All sets,Any,All finishes",
    expanded: "false",
    body: false,
    count: false,
    hint: "Aspects, type, arena, keyword, trait, cost, power, HP",
    kWidth: 86,
    rows: [52, 52, 52, 52],
  });
  // A facet row opens its picker over Filters (stage 2B-2 fills it).
  await tapIn(page, '[data-fpick="finish"]');
  await expect(page.locator(".m-sheet-layer--fpick-finish")).toBeVisible();
  await expect(page.locator(FSHEET)).toBeVisible();
});

test("s2-13-set-selected-chips", async ({ page }) => {
  await openFilters(page, "#/vault?set=ASH,LAWP&sheet=filters");
  const row = page.locator(`${FSHEET} [data-facet="set"]`);
  const r = await row.evaluate((el) => {
    const s = [...el.querySelectorAll(".m-fsel")];
    const inner = s.map((e) => e.querySelector(".m-fsel__in")!.getBoundingClientRect().height);
    const cs = getComputedStyle(s[0].querySelector(".m-fsel__in")!);
    return {
      n: s.length,
      img: !!s[0].querySelector("img.m-fsel__logo"),
      t1: s[1].textContent,
      labels: s.map((e) => e.getAttribute("aria-label")),
      targets: s.map((e) => Math.round(e.getBoundingClientRect().height)),
      drawn: inner,
      bg: cs.backgroundColor,
      line: cs.borderTopColor,
      h: el.getBoundingClientRect().height,
      ph: !!el.querySelector(".m-frow4__ph"),
    };
  });
  expect(r).toEqual({
    n: 2,
    img: true,
    t1: "LAWP",
    labels: ["Remove Ashes of the Empire", "Remove A Lawless Time Weekly Play"],
    targets: [44, 44],
    drawn: [30, 30],
    bg: "rgba(37, 99, 235, 0.28)",
    line: "rgb(37, 99, 235)",
    h: expect.any(Number) as number,
    ph: false,
  });
  expect(r.h).toBeLessThanOrEqual(56);
  expect(await page.evaluate(b1Targets)).toEqual([]);
  expect(await page.evaluate(b1NoOverflow)).toEqual({ out: [], sideways: false, page: false });
  // A chip tap removes that set; no picker opens.
  await row.locator('.m-fsel[data-fv="ASH"]').click();
  await expect(row.locator(".m-fsel")).toHaveCount(1);
  await expect(page.locator(".m-sheet-layer--fpick")).toHaveCount(0);
  await row.locator('.m-fsel[data-fv="LAWP"]').click();
  await expect(row.locator(".m-frow4__ph")).toHaveText("All sets");
  const h = await row.evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
  expect(h).toBeLessThanOrEqual(56);
  await expect(page.locator(".m-filterbtn__n")).toHaveCount(0);
});

test("s2-13-rarity-inline", async ({ page }) => {
  await openFilters(page);
  const r = await page.evaluate((sel) => {
    const row = document.querySelector(`${sel} [data-facet="rarity"]`)!;
    const c = [...row.querySelectorAll(".m-fchip")];
    return {
      labels: c.map((e) => e.getAttribute("aria-label")).join(),
      tops: new Set(c.map((e) => Math.round(e.getBoundingClientRect().top))).size,
      icons: c.every((e) => !!e.querySelector(".rarity-badge__icon")),
      inside: c.every(
        (e) => e.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.5
      ),
      picker: !!row.querySelector("[data-fpick]"),
      text: c.map((e) => e.textContent).join(""),
    };
  }, FSHEET);
  expect(r).toEqual({
    labels: "Common,Uncommon,Rare,Legendary,Special",
    tops: 1,
    icons: true,
    inside: true,
    picker: false,
    text: "",
  });
  await tapIn(page, '[data-facet="rarity"] [data-fv="Rare"]');
  const rare = page.locator(`${FSHEET} [data-facet="rarity"] [data-fv="Rare"]`);
  await expect(rare).toHaveAttribute("aria-pressed", "true");
  expect(await rare.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe("rgb(37, 99, 235)");
  await expect(page.locator(FSHEET)).toBeVisible();
});

test("s2-13-finish-scoped-amber", async ({ page }) => {
  await openFilters(page, "#/vault?finish=Hyperspace%20Foil&sheet=filters");
  const chip = page.locator(`${FSHEET} [data-facet="finish"] .m-fsel`);
  await expect(chip).toHaveText("HS Foil");
  await expect(chip).toHaveClass(/m-fsel--scoped/);
  const c = await chip.evaluate((e) => {
    const cs = getComputedStyle(e.querySelector(".m-fsel__in")!);
    return [cs.color, cs.backgroundColor, cs.borderTopColor];
  });
  expect(c).toEqual(["rgb(242, 193, 78)", "rgba(217, 154, 31, 0.16)", "rgba(217, 154, 31, 0.6)"]);
  // Removing it is a Finish edit: the scope disengages.
  await chip.click();
  await expect(page.locator(`${FSHEET} [data-facet="finish"] .m-frow4__ph`)).toHaveText(
    "All finishes"
  );
  await expect(page.locator(".m-scopechip--on")).toHaveCount(0);
});

test("s2-13-badge-rules", async ({ page }) => {
  // Three sets count as one group.
  await openFilters(page, "#/vault?set=ASH,LAW,SOR&sheet=filters");
  await expect(page.locator(".m-filterbtn__n")).toHaveText("1");
  await expect(page.locator(`${FSHEET} .m-sheet__sub`)).toHaveText("1 active");
  // Search is its own group (set + search = 2).
  await page.goto("/#/vault?set=ASH");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.locator(".m-vault__searchrow .m-search__input").fill("luke");
  await page.keyboard.press("Tab");
  await expect(page.locator(".m-filterbtn__n")).toHaveText("2");
  // The scope is the Finish group (set + scope = 2).
  // (a fresh document: the search above is live state in this one)
  await page.evaluate(() => {
    location.hash = "#/vault?finish=Hyperspace&set=SOR&sheet=filters";
  });
  await page.reload();
  await expect(page.locator(FSHEET)).toBeVisible();
  await expect(page.locator(".m-filterbtn__n")).toHaveText("2");
  await expect(page.locator(`${FSHEET} .m-sheet__sub`)).toHaveText("2 active");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("s2-13-collection-anon", async ({ page }) => {
    await openFilters(page);
    const row = page.locator(`${FSHEET} [data-facet="collection"]`);
    await expect(row.locator(".m-frow4__ph")).toHaveText("Sign in to filter");
    await expect(row.locator(".m-fsel")).toHaveCount(0);
    await row.locator(".m-frow4__open").click();
    // The tap routes to sign in (no picker, the filter is unchanged).
    await expect(page.getByRole("dialog", { name: "Log In" })).toBeVisible();
    await expect(page.locator(FSHEET)).toHaveCount(0);
    await expect(page.locator(".m-sheet-layer--fpick")).toHaveCount(0);
    await expect(page.locator(".m-filterbtn__n")).toHaveCount(0);
  });
});
