import { expect, measureEach, test } from "./helpers";
import { openCard } from "./card-helpers";

// S2-07b: the Aspects sheet (rev4 MSheet.jsx AspectsSheet) -- desktop shows
// an aspect's name on hover; on the phone a tap on the detail's aspect icons
// opens a small sheet listing the card's aspects with icon + name, X
// top-right, 44 px rows.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

test("s2-07b-aspects-sheet", async ({ page }) => {
  await openCard(page, "SOR", 87); // Command, Villainy
  const btn = page.locator("button.m-info__aspects");
  await btn.scrollIntoViewIfNeeded();
  await expect(btn).toHaveAttribute("aria-label", "Aspects: Command, Villainy");
  const bb = await btn.boundingBox();
  expect(bb!.height).toBeGreaterThanOrEqual(44);
  expect(bb!.width).toBeGreaterThanOrEqual(44);
  await btn.click();
  const sheet = page.locator(".m-sheet-layer--aspects");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".m-sheet__title")).toHaveText("Aspects");
  const rows = sheet.locator(".m-aspectlist__row");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator("span")).toHaveText(["Command", "Villainy"]);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll(".m-aspectlist__row")].map((row) => {
      const img = row.querySelector("img")!;
      const cs = getComputedStyle(row.querySelector("span")!);
      return {
        h: row.getBoundingClientRect().height,
        img: [img.width, img.height, img.alt],
        face: cs.fontFamily,
        upper: getComputedStyle(row).textTransform,
      };
    })
  );
  for (const [i, row] of r.entries()) {
    expect(row.h).toBeGreaterThanOrEqual(44);
    expect(row.img).toEqual([36, 36, ["Command", "Villainy"][i]]);
    expect(row.face).toMatch(/Barlow Condensed/);
    expect(row.upper).toBe("uppercase");
  }
  // X top-right, 44 px; closes back to the card.
  const x = await sheet.locator(".m-sheet__close").boundingBox();
  const iw = await page.evaluate(() => innerWidth);
  expect(x!.x + x!.width).toBeGreaterThan(iw - 30);
  expect(Math.round(x!.width)).toBeGreaterThanOrEqual(44);
  await sheet.locator(".m-sheet__close").click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
});
