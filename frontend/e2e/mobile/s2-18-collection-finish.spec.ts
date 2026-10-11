import { expect, measureEach, test } from "./helpers";
import { b1Motion, b1NoOverflow, b1Targets, FSHEET, openFilters, tapIn } from "./filters-helpers";

// S2-18: the Collection and Finish pickers over Filters (rev4
// r4-3-collection-picker / b1-collection-four, r4-3-finish-picker-tree /
// b1-finish-pair-chip, b1-finish-prestige-row, b1-finish-group-expand,
// b1-finish-plain-rows, r4-3-inert-zero-in-pickers; desktop CardsPage's four
// toggles + exclusions, FinishFilter's two-tier tree).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone filters");
});

const COL = ".m-sheet-layer--fpick-collection";
const FIN = ".m-sheet-layer--fpick-finish";

test("s2-18-collection-picker", async ({ page }) => {
  await openFilters(page);
  await tapIn(page, '[data-fpick="collection"]');
  const L = page.locator(COL);
  await expect(L).toBeVisible();
  await page.waitForTimeout(300);
  const rows = await L.locator(".m-fcheck").evaluateAll((es) =>
    es.map((e) => e.textContent!.trim()).join("|")
  );
  expect(rows).toBe(
    "Only incomplete playsets|Only cards I own|Only cards I don't own|Over my keep limit"
  );
  const checked = () =>
    L.locator(".m-fcheck").evaluateAll((es) =>
      es.map((e) => (e as HTMLElement).dataset.fv + "=" + e.getAttribute("aria-checked")).join(",")
    );
  // Desktop exclusions on the way in: Don't own clears Own; Over limit
  // clears Don't own.
  await L.locator('[data-fv="owned"]').click();
  await L.locator('[data-fv="unowned"]').click();
  expect(await checked()).toBe("incomplete=false,owned=false,unowned=true,overcap=false");
  await L.locator('[data-fv="incomplete"]').click();
  await L.locator('[data-fv="overcap"]').click();
  expect(await checked()).toBe("incomplete=true,owned=false,unowned=false,overcap=true");
  await expect(L.locator(".m-sheet__sub")).toHaveText("2 selected");
  // Collection sizes to its four rows; X top-right; 44 px.
  const geo = await L.evaluate((el) => {
    const s = el.querySelector(".m-sheet")!.getBoundingClientRect();
    const x = el.querySelector(".m-sheet__close")!.getBoundingClientRect();
    return {
      short: s.height < innerHeight * 0.7,
      x: x.right > innerWidth - 30 && x.top - s.top < 40,
    };
  });
  expect(geo).toEqual({ short: true, x: true });
  expect(await page.evaluate(b1Targets)).toEqual([]);
  await L.locator(".m-picker__done").click();
  await expect(L).toHaveCount(0);
  const chips = await page
    .locator(`${FSHEET} [data-facet="collection"] .m-fsel`)
    .evaluateAll((es) => es.map((e) => e.textContent).join("|"));
  expect(chips).toBe("Incomplete|Over limit");
  expect(await page.evaluate(b1NoOverflow)).toEqual({ out: [], sideways: false, page: false });
});

test("s2-18-finish-tree", async ({ page }) => {
  await openFilters(page, "#/vault?finish=Hyperspace%20Foil&sheet=filters");
  const rowChip = page.locator(`${FSHEET} [data-facet="finish"] .m-fsel`).first();
  await expect(rowChip).toHaveText("HS Foil");
  await expect(rowChip).toHaveClass(/m-fsel--scoped/);
  await page.locator(`${FSHEET} [data-fpick="finish"]`).click({ position: { x: 30, y: 20 } });
  const L = page.locator(FIN);
  await expect(L).toBeVisible();
  await page.waitForTimeout(300);
  const t = await L.evaluate((el) => {
    const pair = el.querySelector('.m-ffin--pair[data-row="Standard"]')!;
    const pres = el.querySelector('.m-ffin--prestige[data-row="Prestige"]')!;
    const gc = el.querySelector('.m-ffin--group[data-row="Galactic Championship"] .m-ffin__head')!;
    const rows = [...el.querySelectorAll(".m-ftree > *")] as HTMLElement[];
    const wp = rows.findIndex((e) => e.dataset.row === "Weekly Play");
    const bar = [...el.querySelectorAll(".m-fpick__bar .m-flink")].map((e) => e.textContent);
    return {
      pair: [...pair.querySelectorAll(".m-ffin__chip")]
        .map((e) => e.textContent + "=" + e.getAttribute("aria-label"))
        .join("|"),
      pres: [...pres.querySelectorAll(".m-ffin__chip")].map((e) => e.textContent).join(","),
      presExpander: !!pres.querySelector("[aria-expanded]"),
      gc: gc.getAttribute("aria-expanded"),
      kids: el.querySelectorAll(".m-ffin__kid").length,
      plain: !!el.querySelector('.m-ffin--plain[data-fv="Showcase"]'),
      dividerAfterWp: wp >= 0 && rows[wp + 1]?.classList.contains("m-fdivider"),
      hsOn: el
        .querySelector('.m-ffin__chip[data-fv="Hyperspace Foil"]')!
        .getAttribute("aria-pressed"),
      bar: bar.join(","),
    };
  });
  expect(t).toEqual({
    pair: "Non-foil=Standard|Foil=Standard Foil",
    pres: "Std,Foil,Serialized",
    presExpander: false,
    gc: "false",
    kids: 0,
    plain: true,
    dividerAfterWp: true,
    hsOn: "true",
    bar: "All,Clear",
  });
  // A family header only expands; children show stripped labels with the
  // raw value as their name.
  const gcHead = L.locator('.m-ffin--group[data-row="Galactic Championship"] .m-ffin__head');
  await gcHead.click();
  const kids = await L.locator(".m-ffin__kid").evaluateAll((es) =>
    es.map((e) => [e.textContent!.trim(), e.getAttribute("aria-label")])
  );
  expect(kids.length).toBeGreaterThanOrEqual(5);
  expect(kids.every(([text, name]) => !text!.startsWith("GC ") && name!.startsWith("GC "))).toBe(
    true
  );
  expect(await page.evaluate(b1Motion)).toEqual([]);
  expect(await page.evaluate(b1Targets)).toEqual([]);
  // Editing the facet disengages the scope (not exactly the scoped value).
  await L.locator(
    '.m-ffin--pair[data-row="Standard"] .m-ffin__chip[data-fv="Standard Foil"]'
  ).click();
  await expect(page.locator(".m-scopechip--on")).toHaveCount(0);
  await L.locator('.m-ffin__kid[data-fv="GC Top 8"]').click();
  await gcHead.click();
  await expect(
    L.locator('.m-ffin--group[data-row="Galactic Championship"] .m-ffin__badge')
  ).toHaveText("· 1");
  await expect(L.locator(".m-sheet__sub")).toHaveText("3 selected");
  await L.locator(".m-picker__done").click();
  await expect(L).toHaveCount(0);
  const row = await page
    .locator(`${FSHEET} [data-facet="finish"] .m-fsel`)
    .evaluateAll((es) =>
      es.map((e) => (e.classList.contains("m-fsel--scoped") ? "!" : "") + e.textContent)
    );
  expect(row.slice(0, 2)).toEqual(["HS Foil", "Std Foil"]);
  expect(row.length).toBe(3);
  expect(await page.evaluate(b1NoOverflow)).toEqual({ out: [], sideways: false, page: false });
});

test("s2-18-inert-zero-in-pickers", async ({ page }) => {
  await openFilters(page, "#/vault?set=IBH&sheet=filters");
  await tapIn(page, '[data-fpick="finish"]');
  const L = page.locator(FIN);
  await expect(L).toBeVisible();
  const r = await L.evaluate((el) => {
    const inert = [
      ...el.querySelectorAll(".m-fchip--inert, .m-fcheck--inert"),
    ] as HTMLButtonElement[];
    return {
      n: inert.length > 0,
      all: inert.every((e) => e.disabled && /\(0\)$/.test(e.getAttribute("aria-label")!)),
    };
  });
  expect(r).toEqual({ n: true, all: true });
});
