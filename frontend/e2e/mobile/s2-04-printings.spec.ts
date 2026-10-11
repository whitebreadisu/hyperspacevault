import { expect, measureEach, test } from "./helpers";
import { fin, openCard, QTY, scrollDetail } from "./card-helpers";

// S2-04: the printings rail (rev4 card-unit-printings, card-printing-swaps-art;
// desktop CardPopupRail order + labels).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const SHORT: Record<string, string> = {
  "Hyperspace Foil": "HS Foil",
  "Standard Prestige": "Std Prestige",
  "Foil Prestige": "Foil Prestige",
  "Serialized Prestige": "Ser. Prestige",
};

test("s2-04-rail-select-swaps-art-and-plate", async ({ page }) => {
  const c = await openCard(page, "ASH", 112);
  // Desktop order: base set first (number ascending), then other sources A-Z.
  const rows = await page.locator(".m-print").evaluateAll((els) =>
    els.map((e) => ({
      id: Number((e as HTMLElement).dataset.variant),
      finish: e.querySelector(".m-print__finish")!.textContent,
      num: e.querySelector(".m-print__num")!.textContent,
      price: e.querySelector(".m-print__price")!.textContent,
    }))
  );
  expect(rows.length).toBe(c.variants.length);
  const base = c.variants
    .filter((v) => v.source_set_code === "ASH")
    .sort((a, b) => Number(a.card_number) - Number(b.card_number));
  expect(rows.slice(0, base.length).map((r) => r.id)).toEqual(base.map((v) => v.variant_id));
  for (const r of rows) {
    const v = c.variants.find((x) => x.variant_id === r.id)!;
    expect(r.finish).toBe(SHORT[fin(v)] ?? fin(v));
    expect(r.num).toBe(`${v.source_set_code} ${v.card_number}`);
    const m = v.price?.market;
    expect(r.price).toBe(m == null ? "—" : `$${m.toFixed(2)}`);
  }
  await expect(page.locator(".m-printgroup__label").first()).toHaveText("Base set");
  await expect(page.locator(".m-sec__title#sec-printings")).toHaveText(
    `Variants ${c.variants.length}`
  );
  // Non-selected rows show desktop's ×N, green when owned.
  const foil = c.variants.find((v) => fin(v) === "Hyperspace Foil")!;
  const qty = page.locator(`.m-print[data-variant="${foil.variant_id}"] .cp-rail__item-qty`);
  await expect(qty).toHaveText(`×${QTY.get(foil.variant_id)}`);
  expect(await qty.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(31, 163, 71)");

  // card-printing-swaps-art: a tap selects; art, caption, plate and price follow.
  const before = await page.locator(".m-dreg__img").getAttribute("src");
  const hs = c.variants.find((v) => fin(v) === "Hyperspace")!;
  await page.locator(`.m-print[data-variant="${hs.variant_id}"] .m-print__main`).click();
  await expect(page.locator(`.m-print[data-variant="${hs.variant_id}"]`)).toHaveClass(
    /cp-rail__item--active/
  );
  await expect(
    page.locator(`.m-print[data-variant="${hs.variant_id}"] .m-print__main`)
  ).toHaveAttribute("aria-pressed", "true");
  const after = await page.locator(".m-dreg__img").getAttribute("src");
  expect(after).not.toBe(before);
  await expect(page.locator(".m-dreg__fin")).toHaveText("Hyperspace");
  await expect(page.locator(".m-dreg3__own .playset-chip")).toHaveText(
    String(QTY.get(hs.variant_id) ?? 0)
  );
  await expect(page.locator(".m-dreg3__mini .m-dreg__pval")).toHaveText(
    `$${hs.price!.market!.toFixed(2)}`
  );
  // Selected row: blue (desktop active row), stepper in the row.
  const bg = await page
    .locator(".m-print.cp-rail__item--active")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toBe("rgba(37, 99, 235, 0.28)");
  await expect(page.locator(".m-print.cp-rail__item--active .m-step")).toHaveCount(2);
  // card-unit-printings: the rail scrolls under the pinned region.
  await scrollDetail(page, 520);
  await expect(page.locator(".m-print").last()).toBeAttached();
});
