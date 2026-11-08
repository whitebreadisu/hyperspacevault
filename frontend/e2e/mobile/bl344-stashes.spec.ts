import type { Page } from "@playwright/test";
import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { byNum, fin, openCard, scrollDetail } from "./card-helpers";

// BL-344 slice 1, phone 1e "Stash sheet" (claude_design/design_handoff_card_stash
// README): the entry under the owned plate, the New stash and rows modes of
// the sheet, save on click with Done / the X closing (BL-344 R1-11: no
// Cancel), the read-only list on the plate and pinned
// under the collapsed art, the owned stepper's decrease floor, and no stash
// calls or UI in a shared vault or signed out. The stashes double lives in
// mock-api.ts (stashCalls records every /api/stashes* request).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const ACTIVE = ".m-print.cp-rail__item--active";
const SHEET = ".m-sheet-layer--stash";
const LUKE = byNum("ASH", 112); // Standard owned 2
const STD = LUKE.variants.find((v) => fin(v) === "Standard")!;

/** Review screenshots, only when BL344_SHOTS names a directory. */
const shot = async (page: Page, name: string) => {
  const dir = process.env.BL344_SHOTS;
  if (dir && test.info().project.name === "phone-390")
    await page.screenshot({ path: `${dir}/phone-${name}.png` });
};

const settle = (page: Page) => page.waitForTimeout(350);

test("bl344-first-stash-done", async ({ page }) => {
  await openCard(page, "ASH", 112);
  const entry = page.locator(".m-dreg3__own .m-stash__entry");
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText(/Stash copies/i);
  expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "a1-entry");

  // a1 -> a2: no stashes yet, so the sheet opens on New stash.
  await entry.click();
  const sheet = page.locator(SHEET);
  await expect(sheet.locator(".m-sheet__title")).toHaveText("New stash");
  await settle(page);
  await shot(page, "a2-new-stash");
  await sheet.locator(".m-stash__input").fill("Red binder");
  await sheet.getByRole("button", { name: "Create stash" }).click();

  // Straight to rows: Vault 2, Red binder 0; nothing moved.
  await expect(sheet.locator(".m-sheet__title")).toHaveText("Stash copies");
  await expect(sheet.locator(".m-sheet__sub")).toContainText("2 owned");
  await expect(sheet.locator(".m-stash__vault")).toHaveText("2");
  expect(recorderFor(page).stashCalls).toContain("POST /api/stashes");
  expect(recorderFor(page).stashCalls.some((c) => c.startsWith("PUT"))).toBe(false);
  await shot(page, "b2-rows");

  const plus = sheet.locator('.m-stash__row[data-stash="1"] .m-step').nth(1);
  const minus = sheet.locator('.m-stash__row[data-stash="1"] .m-step').nth(0);
  await expect(minus).toHaveAttribute("aria-disabled", "true");
  await plus.click();
  await plus.click();
  // e1: every copy stashed -- Vault 0 in red, + off.
  await expect(sheet.locator(".m-stash__vault")).toHaveText("0");
  await expect(sheet.locator(".m-stash__vault")).toHaveClass(/m-stash__vault--empty/);
  await expect(plus).toHaveAttribute("aria-disabled", "true");
  for (const b of await sheet.locator(".m-step").all()) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await shot(page, "e1-all-stashed");
  // REPLACE (R1-11): the clicks save themselves (one coalesced PUT), the
  // sheet stays open; Done only closes it.
  await expect
    .poll(() => recorderFor(page).stashCalls.filter((c) => c.startsWith("PUT")))
    .toEqual([`PUT /api/stashes/variants/${STD.variant_id}`]);
  await expect(sheet).toHaveCount(1);
  await expect(sheet.getByRole("button", { name: "Cancel" })).toHaveCount(0);

  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);

  // c1: the read-only list on the plate.
  const list = page.locator(".m-dreg3__own .m-stash__list");
  await expect(list.locator(".m-stash__readrow")).toHaveCount(1);
  await expect(list.locator(".m-stash__readrow .m-stash__name")).toHaveText("Red binder");
  await expect(list.locator(".playset-chip")).toHaveText("2");
  await settle(page);
  await shot(page, "c1-list");

  // Decrease floor: owned 2 = stashed 2 -- the owned - says why and does nothing.
  const dec = page.locator(`${ACTIVE} .m-step[aria-label^="Decrement"]`);
  await expect(dec).toHaveAttribute("aria-disabled", "true");
  await expect(dec).toHaveAttribute(
    "aria-label",
    /All copies are stashed\. Remove from a stash first\./
  );
  await dec.click({ force: true });
  await page.waitForTimeout(700);
  expect(recorderFor(page).adjust).toEqual([]);
  await expect(page.locator(`${ACTIVE} .m-step__qty`)).toHaveText("2");

  // g: collapsed, the list stays pinned under the mini row.
  await scrollDetail(page, 420);
  await expect(page.locator(".m-dreg3--collapsed")).toHaveCount(1);
  const pinned = page.locator(".m-dreg3__pinned");
  await expect(pinned).toBeVisible();
  await expect(pinned.locator(".m-stash__name")).toHaveText("Red binder");
  const mini = (await page.locator(".m-dreg3__mini").boundingBox())!;
  const pin = (await pinned.boundingBox())!;
  expect(pin.y).toBeGreaterThanOrEqual(mini.y + mini.height - 1);
  // It is part of the fixed region: the sticky box grows by its height and
  // a further scroll leaves it where it is.
  const region = (await page.locator(".m-cardlayer .m-dreg3").first().boundingBox())!;
  expect(region.y + region.height).toBeGreaterThanOrEqual(pin.y + pin.height - 1);
  await scrollDetail(page, 300);
  expect((await pinned.boundingBox())!.y).toBeCloseTo(pin.y, 0);
  await shot(page, "g-pinned");
});

test.describe("seeded", () => {
  test.use({
    stashSeed: {
      stashes: [
        { id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" },
        { id: 2, name: "Trade stash", description: null, created_at: "2026-11-02T00:00:00Z" },
      ],
      stashItems: [{ stash_id: 1, variant_id: STD.variant_id, quantity: 1 }],
    },
  });

  // REPLACE (R1-11): was "the X = Cancel discards"; the X now closes and
  // the move is saved.
  test("bl344-edit-x-keeps-the-move", async ({ page }) => {
    await openCard(page, "ASH", 112);
    const list = page.locator(".m-dreg3__own .m-stash__list");
    await expect(list.locator(".m-stash__name")).toHaveText(["Red binder"]);
    await list.getByRole("button", { name: "Edit" }).click();
    const sheet = page.locator(SHEET);
    await expect(sheet.locator(".m-stash__row")).toHaveCount(3); // Vault, Red binder, Trade stash
    await expect(sheet.locator(".m-stash__vault")).toHaveText("1");
    // d1: Red binder -> Trade stash.
    await sheet.locator('.m-stash__row[data-stash="1"] .m-step').nth(0).click();
    await sheet.locator('.m-stash__row[data-stash="2"] .m-step').nth(1).click();
    await expect(sheet.locator('.m-stash__row[data-stash="2"] .m-step__qty')).toHaveText("1");
    await settle(page);
    await shot(page, "d1-move");
    // The X closes the sheet and sends the move; the list shows it.
    await sheet.locator(".m-sheet__close").click();
    await expect(sheet).toHaveCount(0);
    await expect
      .poll(() => recorderFor(page).stashCalls.filter((c) => c.startsWith("PUT")).length)
      .toBe(1);
    await expect(list.locator(".m-stash__name")).toHaveText(["Trade stash"]);
  });

  test("bl344-duplicate-name-inline", async ({ page }) => {
    await openCard(page, "ASH", 112);
    await page
      .locator(".m-dreg3__own .m-stash__list")
      .getByRole("button", { name: "Edit" })
      .click();
    const sheet = page.locator(SHEET);
    await sheet.getByRole("button", { name: "New stash" }).click();
    await sheet.locator(".m-stash__input").fill("red binder");
    await sheet.getByRole("button", { name: "Create stash" }).click();
    await expect(sheet.locator(".m-stash__error")).toHaveText(
      "You already have a stash with this name. Choose another name."
    );
    // The 409 is the point of the test, not a failure.
    const rec = recorderFor(page);
    rec.consoleErrors = rec.consoleErrors.filter((m) => !m.includes("status of 409"));
    await shot(page, "a2-duplicate");
  });
});

test("bl344-no-stash-calls-in-a-share", async ({ page }) => {
  await page.goto("/shared/tok-1#/vault");
  const SH = '.m-app__screen[data-pane="shared"]';
  await expect(page.locator(`${SH} .m-row`).first()).toBeVisible();
  await page.locator(`${SH} .m-row`).first().click();
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator(".m-stash__entry, .m-stash__list")).toHaveCount(0);
  expect(recorderFor(page).stashCalls).toEqual([]);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("bl344-no-stash-calls-signed-out", async ({ page }) => {
    await openCard(page, "ASH", 112);
    await expect(page.locator(".m-stash__entry, .m-stash__list")).toHaveCount(0);
    expect(recorderFor(page).stashCalls).toEqual([]);
  });
});
