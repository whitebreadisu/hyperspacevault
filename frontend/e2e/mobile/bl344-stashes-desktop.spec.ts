import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { byNum, fin } from "./card-helpers";

// BL-344 slice 1, desktop 1a "Place rows" (claude_design/design_handoff_card_stash
// README) at 1440: the stash UI inside the popup's inventory panel, end to end
// against the mocked API (mock-api.ts's stashes double). Component-level state
// coverage lives in screens/cards/CardPopupStashes.test.tsx; this proves the
// real tree renders and writes, and gives review screenshots.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop popup");
});
test.use({ storageState: "e2e/.auth/phone.json" });
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

const LUKE = byNum("ASH", 112); // Standard owned 2
const STD = LUKE.variants.find((v) => fin(v) === "Standard")!;
const PANEL = ".cp-plate__inner";

const shot = async (page: Page, name: string) => {
  const dir = process.env.BL344_SHOTS;
  if (dir) await page.locator(".cp-modal").screenshot({ path: `${dir}/desktop-${name}.png` });
};

async function openLuke(page: Page) {
  await page.goto("/?card=ash-112");
  await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
  await expect(page.locator(".cp-plate__qty")).toHaveText("2");
  await page.evaluate(() => document.fonts.ready);
}

test("bl344-desktop-first-stash", async ({ page }) => {
  await openLuke(page);
  const quiet = page.locator(`${PANEL} .cp-stash__quiet`);
  await expect(quiet).toHaveText(/Stash copies/i);
  await shot(page, "a1");
  await quiet.click();
  await expect(page.locator(`${PANEL} .cp-stash__title`)).toHaveText("New stash");
  await page.locator(`${PANEL} .cp-stash__input`).fill("Red binder");
  await shot(page, "a2");
  await page.getByRole("button", { name: "Create stash" }).click();
  await expect(page.locator(`${PANEL} .cp-stash__row`)).toHaveCount(2);
  const row = page.locator(`${PANEL} .cp-stash__row[data-stash="1"]`);
  await row.locator(".cp-stash__step").nth(1).click();
  await row.locator(".cp-stash__step").nth(1).click();
  await expect(page.locator(`${PANEL} .cp-stash__vault`)).toHaveText("0");
  await shot(page, "e1");
  // R1-11: the clicks save themselves (one coalesced PUT); Done collapses.
  await expect
    .poll(() => recorderFor(page).stashCalls.filter((c) => c.startsWith("PUT")))
    .toEqual([`PUT /api/stashes/variants/${STD.variant_id}`]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(`${PANEL} .cp-stash__readrow`)).toHaveCount(1);
  const dec = page.locator(".cp-plate__step--dec");
  await expect(dec).toHaveAttribute("aria-disabled", "true");
  await expect(dec).toHaveAttribute("title", "All copies are stashed. Remove from a stash first.");
  await shot(page, "c1");
});

test.describe("seeded", () => {
  test.use({
    stashSeed: {
      stashes: [
        { id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" },
        { id: 2, name: "Trade stash", description: null, created_at: "2026-11-02T00:00:00Z" },
        { id: 3, name: "With Bob", description: null, created_at: "2026-11-03T00:00:00Z" },
      ],
      stashItems: [{ stash_id: 1, variant_id: STD.variant_id, quantity: 1 }],
    },
  });

  // REPLACE (R1-11): was "edit and Cancel" (nothing written). Cancel is
  // gone; a click saves, Done collapses onto the saved list.
  test("bl344-desktop-edit-saves-on-click", async ({ page }) => {
    await openLuke(page);
    await expect(page.locator(`${PANEL} .cp-stash__readrow .cp-stash__name`)).toHaveText([
      "Red binder",
    ]);
    await page.locator(`${PANEL} .cp-stash__edit`).click();
    await expect(page.locator(`${PANEL} .cp-stash__row`)).toHaveCount(4);
    await page.locator(`${PANEL} .cp-stash__row[data-stash="2"] .cp-stash__step`).nth(1).click();
    await shot(page, "c2-d1");
    await expect(
      page.locator(`${PANEL} .cp-stash__foot`).getByRole("button", { name: "Cancel" })
    ).toHaveCount(0);
    await expect
      .poll(() => recorderFor(page).stashCalls.filter((c) => c.startsWith("PUT")).length)
      .toBe(1);
    await page.locator(`${PANEL} .cp-stash__foot`).getByRole("button", { name: "Done" }).click();
    await expect(page.locator(`${PANEL} .cp-stash__readrow .cp-stash__name`)).toHaveText([
      "Red binder",
      "Trade stash",
    ]);
  });
});
