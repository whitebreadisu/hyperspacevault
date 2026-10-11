import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { byNum, fin, openCard } from "./card-helpers";

// S2-05: the stepper (desktop CardPopupInventory semantics through
// api/inventory adjustCard; rev4 card-over-limit; b2-detail-scoped-printing's
// stepper half).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const ACTIVE = ".m-print.cp-rail__item--active";

test("s2-05-stepper-adjusts", async ({ page }) => {
  const c = await openCard(page, "ASH", 112);
  const std = c.variants.find((v) => fin(v) === "Standard")!; // owned 2
  const inc = page.locator(`${ACTIVE} .m-step[aria-label^="Increment"]`);
  const qty = page.locator(`${ACTIVE} .m-step__qty`);
  await expect(qty).toHaveText("2");
  await inc.click();
  // Optimistic: the readout and the plate move at once, before any call.
  await expect(qty).toHaveText("3");
  await expect(page.locator(".m-dreg3__own .playset-chip")).toHaveText("3");
  expect(recorderFor(page).adjust).toEqual([]);
  await page.waitForTimeout(700);
  expect(recorderFor(page).adjust).toEqual([{ variantId: std.variant_id, delta: 1 }]);
  // Hard cap (Standard keep-limit 3): + stops, the readout is red at the limit.
  await expect(inc).toBeDisabled();
  expect(await qty.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(248, 113, 113)");
  // Back on the Vault the row's chip carries the new total (2+1+1 -> 5).
  await page.locator(".m-hdr__close").click();
  await expect(page.locator(`.m-row[data-card="${c.id}"] .playset-chip`)).toHaveText("5");
});

test("s2-05-over-limit-amber", async ({ page }) => {
  // Soft cap mode, Standard keep-limit 2: LAW 214 owns 3 Standard -> desktop's
  // amber over-limit readout + "Over limit" tag; + stays enabled.
  const limits = JSON.parse(readFileSync("e2e/mobile/fixtures/limits.json", "utf8")) as {
    cap_mode: string;
    limits: { type_category: string; limit_bucket: string; max_quantity: number }[];
  };
  limits.cap_mode = "soft";
  for (const l of limits.limits)
    if (l.type_category === "standard" && l.limit_bucket === "Standard") l.max_quantity = 2;
  await page.route(
    (u) => u.pathname === "/api/settings/limits",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(limits) })
  );
  await openCard(page, "LAW", 214);
  const qty = page.locator(`${ACTIVE} .m-step__qty`);
  await expect(qty).toHaveText("3");
  expect(await qty.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(217, 154, 31)");
  const tag = page.locator(`${ACTIVE} .cp-plate__over-limit-tag`);
  await expect(tag).toHaveText("Over limit");
  expect(await tag.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(217, 154, 31)");
  await expect(page.locator(`${ACTIVE} .m-step[aria-label^="Increment"]`)).toBeEnabled();
  // Not amber anywhere else on the screen's rail.
  await expect(page.locator(".cp-plate__over-limit-tag")).toHaveCount(1);
  void byNum;
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("s2-05-anonymous-routes-to-signin", async ({ page }) => {
    await openCard(page, "ASH", 112);
    const dec = page.locator(`${ACTIVE} .m-step`).first();
    await expect(dec).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(`${ACTIVE} .m-step__qty`)).toHaveText("—");
    await expect(page.locator(".cp-rail__item-qty")).toHaveCount(0);
    await expect(page.locator(".m-dreg3__own .playset-chip")).toHaveText("—");
    // aria-disabled keeps the control tappable (Playwright treats it as disabled).
    await dec.click({ force: true });
    await expect(page.getByRole("dialog", { name: "Log In" })).toBeVisible();
    expect(recorderFor(page).adjust).toEqual([]);
  });
});
