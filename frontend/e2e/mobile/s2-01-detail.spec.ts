import { expect, measureEach, test } from "./helpers";
import { byNum, fin, openCard, openVault, tapRow } from "./card-helpers";

// S2-01: the card detail route + fixed header (rev4 card-unit,
// card-stepper-plain, card-stepper-amber, b2-detail-scoped-printing's entry
// half under R5-5).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

test("s2-01-detail-opens-from-row", async ({ page }) => {
  // Unscoped row: the detail opens on the representative (Standard).
  const c = await openCard(page, "ASH", 112);
  await expect(page).toHaveURL(new RegExp(`#/card/${c.id}$`));
  const std = c.variants.find((v) => fin(v) === "Standard")!;
  await expect(page.locator(".m-print.cp-rail__item--active")).toHaveAttribute(
    "data-variant",
    String(std.variant_id)
  );
  await expect(page.locator(".m-detail__title")).toHaveText(c.name);
  // Bar order: spacer, prev, "n of m", next, X -- the X in the top-right corner.
  const bar = await page.evaluate(() => {
    const kids = [...document.querySelector(".m-cardlayer .m-hdr__bar")!.children];
    const nav = document.querySelector(".m-cardlayer .m-hdr__nav")!;
    const x = document.querySelector(".m-hdr__close")!.getBoundingClientRect();
    return {
      order: kids.map((k) => k.className.split(" ").find((n) => n.startsWith("m-hdr__"))),
      nav: [...nav.children].map((k) => k.getAttribute("aria-label") ?? k.className),
      x: { right: x.right, top: x.top, w: x.width, h: x.height },
      iw: innerWidth,
    };
  });
  expect(bar.order).toEqual(["m-hdr__balance", "m-hdr__nav", "m-hdr__close"]);
  expect(bar.nav).toEqual(["Previous card", "m-hdr__pos", "Next card"]);
  expect(bar.x.right).toBeGreaterThan(bar.iw - 40);
  expect(bar.x.top).toBeLessThan(12);
  expect(bar.x.w).toBeGreaterThanOrEqual(44);
  expect(bar.x.h).toBeGreaterThanOrEqual(44);
  // Unfiltered list: plain "n of 53" (card-stepper-plain).
  const pos = page.locator(".m-hdr__pos");
  await expect(pos).toHaveText(/ of 53$/);
  await expect(pos).not.toHaveClass(/m-hdr__pos--narrowed/);
  expect(await pos.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(207, 214, 228)");
  // X returns to the Vault with its list intact.
  await page.locator(".m-hdr__close").click();
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.locator(".m-cardlayer")).toHaveCount(0);
  await expect(page.locator(".m-row").first()).toBeVisible();
});

test("s2-01-scoped-row-opens-scoped-printing", async ({ page }) => {
  // A scoped Vault (Hyperspace) only picks the default printing (R5-5):
  // the scoped printing is selected, no scope marker, no amber row edge.
  await openVault(page, "#/vault?finish=Hyperspace");
  const c = byNum("SOR", 35);
  await tapRow(page, c.id);
  const hs = c.variants.find((v) => fin(v) === "Hyperspace")!;
  await expect(page.locator(".m-print.cp-rail__item--active")).toHaveAttribute(
    "data-variant",
    String(hs.variant_id)
  );
  await expect(page.locator(".m-print__scope, .m-print--scoped")).toHaveCount(0);
  await expect(page.locator(".m-print")).toHaveCount(c.variants.length);
});

test("s2-01-n-of-m-amber-when-narrowed", async ({ page }) => {
  // card-stepper-amber: from a Vault narrowed to ASH, the third row opens as
  // "3 of n" in lit amber, n = the narrowed count; next keeps it amber.
  await openVault(page, "#/vault?set=ASH");
  await expect(page.locator(".m-count")).toHaveText("18 cards");
  await page.locator(".m-row").nth(2).click();
  const pos = page.locator(".m-hdr__pos");
  await expect(pos).toHaveText(/^3 of 18$/);
  await expect(pos).toHaveClass(/m-hdr__pos--narrowed/);
  expect(await pos.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(242, 193, 78)");
  await page.locator('[aria-label="Next card"]').click();
  await expect(pos).toHaveText(/^4 of 18$/);
  await expect(pos).toHaveClass(/m-hdr__pos--narrowed/);
  // Back to the Vault: still narrowed to ASH (the Vault stayed mounted).
  await page.locator(".m-hdr__close").click();
  await expect(page.locator(".m-count")).toHaveText("18 cards");
});
