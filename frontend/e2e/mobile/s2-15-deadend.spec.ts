import { expect, measureEach, test } from "./helpers";
import { CARDS, FSHEET, openFilters, tapIn } from "./filters-helpers";

// S2-15: dead ends inert (rev4 b1-deadend-inert, b1-selected-never-hidden;
// the IBH example). Rarity is the inline facet on the compact sheet; the
// pickers' faceting is asserted in s2-18-inert-zero-in-pickers / s2-19-picker-inert.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone filters");
});

const inSet = (code: string) =>
  CARDS.filter((c) => c.set_code === code || c.variants.some((v) => v.source_set_code === code));

test("s2-15-deadend-inert", async ({ page }) => {
  const ibhRarities = new Set(inSet("IBH").map((c) => c.rarity));
  await openFilters(page, "#/vault?set=IBH&sheet=filters");
  const r = await page.evaluate(
    (sel) =>
      [...document.querySelectorAll(`${sel} [data-facet="rarity"] .m-fchip`)].map((e) => ({
        v: (e as HTMLElement).dataset.fv,
        label: e.getAttribute("aria-label"),
        disabled: (e as HTMLButtonElement).disabled,
        inert: e.classList.contains("m-fchip--inert"),
        opacity: getComputedStyle(e).opacity,
      })),
    FSHEET
  );
  expect(r.length).toBe(5);
  for (const c of r) {
    if (ibhRarities.has(c.v!)) {
      expect(c).toEqual({ v: c.v, label: c.v, disabled: false, inert: false, opacity: "1" });
    } else {
      expect(c).toEqual({
        v: c.v,
        label: `${c.v} (0)`,
        disabled: true,
        inert: true,
        opacity: "0.38",
      });
    }
  }
  expect(r.filter((c) => c.inert).length).toBeGreaterThan(0);
  // An inert value is not addable: a tap changes nothing.
  const dead = r.find((c) => c.inert)!.v!;
  await page.locator(`${FSHEET} [data-fv="${dead}"]`).click({ force: true });
  await expect(page.locator(`${FSHEET} [data-fv="${dead}"]`)).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await expect(page.locator(".m-filterbtn__n")).toHaveText("1");
});

test("s2-15-selected-never-hidden", async ({ page }) => {
  await openFilters(page);
  await tapIn(page, '[data-facet="rarity"] [data-fv="Common"]');
  // IBH has no Common, so the set arrives the other way a set can (a link /
  // the by-set sheet), with Common still selected.
  expect(inSet("IBH").some((c) => c.rarity === "Common")).toBe(false);
  await page.evaluate(() => {
    location.hash = "#/vault?sheet=filters&set=IBH";
  });
  const common = page.locator(`${FSHEET} [data-facet="rarity"] [data-fv="Common"]`);
  await expect(common).toHaveAttribute("aria-label", "Common (0)");
  await expect(common).toHaveAttribute("aria-pressed", "true");
  await expect(common).toHaveClass(/m-fchip--inert/);
  await expect(common).toBeEnabled();
  // (opacity is one of the two properties allowed to transition; let it land)
  await expect.poll(() => common.evaluate((e) => getComputedStyle(e).opacity)).toBe("0.6");
  // Still removable.
  await common.click();
  await expect(common).toHaveAttribute("aria-pressed", "false");
  await expect(common).toBeDisabled();
});
