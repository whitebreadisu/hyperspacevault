import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { dropDelete204, recorderFor } from "./mock-api";

// The desktop Stashes page (design 1b "Master-detail") and the Command pod
// at 1440, end to end against the mocked API's stashes double: the pod's
// Stashes entry and hover menu, the rail, the printing-level table and
// gallery, return one / all with Undo, the in-place edit with a duplicate
// name, delete, and create. Component-level state coverage lives in
// screens/stashes/StashesPane.test.tsx. Screenshots land in $BL344_SHOTS.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop page");
});
test.use({ storageState: "e2e/.auth/phone.json" });
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

const shot = async (page: Page, name: string, full = false) => {
  const dir = process.env.BL344_SHOTS;
  if (!dir) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/desk-${name}.png`, fullPage: full });
};

// Fixture printings (e2e/mobile/fixtures): Luke Skywalker ASH 112 Standard
// (owned 2) and Hyperspace Foil ASH 614 (owned 1); Chimaera ASH 316
// Hyperspace (3); Lawbringer LAW 101 (3); Luke Skywalker leader ASH 5 (1);
// Fortress of the Great Mothers base ASH 19 (1); Darth Vader SOR 351 (1).
const RED = {
  id: 1,
  name: "Red binder",
  description: "Blue binder on the shelf, SOR and SHD playsets. Sleeved, sorted by set and number.",
  created_at: "2026-11-01T00:00:00Z",
};
const SEED = {
  stashes: [
    RED,
    {
      id: 2,
      name: "Trade stash",
      description: "For the Thursday league",
      created_at: "2026-11-02T00:00:00Z",
    },
    { id: 3, name: "New box", description: null, created_at: "2026-11-03T00:00:00Z" },
  ],
  stashItems: [
    { stash_id: 1, variant_id: 17, quantity: 2 },
    { stash_id: 1, variant_id: 8932, quantity: 1 },
    { stash_id: 1, variant_id: 8598, quantity: 3 },
    { stash_id: 1, variant_id: 1597, quantity: 3 },
    { stash_id: 1, variant_id: 213, quantity: 1 },
    { stash_id: 1, variant_id: 102, quantity: 1 },
    { stash_id: 1, variant_id: 6795, quantity: 1 },
    { stash_id: 2, variant_id: 7146, quantity: 2 },
  ],
};

async function openStashes(page: Page) {
  await page.goto("/");
  await expect(page.locator('[data-sub="stashes"]')).toBeVisible();
  await page.locator('[data-sub="stashes"]').click();
  await expect(page.locator(".sp-page")).toBeVisible();
}

test.describe("seeded", () => {
  test.use({ stashSeed: SEED });

  test("stashes-desktop-nav-and-menu", async ({ page }) => {
    await page.goto("/");
    const pod = page.getByTestId("nav-pod");
    await expect(pod.locator('[data-sub="collection"]')).toHaveAttribute("aria-current", "page");
    await shot(page, "nav-collection");
    await pod.locator('[data-sub="stashes"]').hover();
    const menu = page.getByTestId("stash-menu");
    await expect(menu).toHaveClass(/pod-menu--open/);
    await expect(menu.locator(".pod-menu__name")).toHaveText([
      "Red binder",
      "Trade stash",
      "New box",
    ]);
    await expect(menu.locator(".pod-menu__count")).toHaveText(["12", "2", "0"]);
    await page.waitForTimeout(300);
    await shot(page, "nav-stash-menu");
    await menu.getByRole("button", { name: /Trade stash/ }).click();
    await expect(page.locator(".sp-railrow--on .sp-railrow__name")).toHaveText("Trade stash");
    await expect(pod.locator('[data-sub="stashes"]')).toHaveAttribute("aria-current", "page");
    await page.locator('[data-top="decks"]').click();
    await expect(pod.locator('[data-sub="deck-check"]')).toHaveAttribute("aria-current", "page");
    await page.waitForTimeout(700);
    await shot(page, "nav-deckcheck");
  });

  test("stashes-desktop-table-gallery-return-undo", async ({ page }) => {
    await openStashes(page);
    const rows = page.locator(".sp-tr:not(.sp-tr--head)");
    await expect(page.locator(".sp-read__name")).toHaveText("Red binder");
    // Printing-level rows in Set | # order: the two Luke printings are two rows.
    await expect(rows).toHaveCount(7);
    await expect(page.locator('.sp-tr[data-variant="17"] .sp-td--printing')).toHaveText("Standard");
    await expect(page.locator('.sp-tr[data-variant="8932"] .sp-td--num')).toHaveText("ASH 614");
    await expect(page.locator(".sp-stat").first()).toContainText("12");
    await shot(page, "a1-c1-table", true);

    // D1: − on Luke Standard, 2 -> 1, the green line + Undo.
    await page.locator('.sp-tr[data-variant="17"] .sp-minus').click();
    await expect(page.locator('.sp-tr[data-variant="17"] .sp-chip')).toHaveText("1");
    await expect(page.locator(".sp-ok__text")).toHaveText(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    await expect(page.locator(".sp-stat__sub")).toHaveText("1 back in Vault");
    expect(recorderFor(page).stashCalls).toContain("POST /api/stashes/1/return");
    await shot(page, "d1-minus", true);

    // Undo restores exactly what was returned.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".sp-ok")).toHaveCount(0);
    await expect(page.locator('.sp-tr[data-variant="17"] .sp-chip')).toHaveText("2");
    expect(recorderFor(page).stashCalls).toContain("POST /api/stashes/1/restore");

    // D2: trash returns every copy; the row leaves.
    await page.locator('.sp-tr[data-variant="17"] .sp-trash').click();
    await expect(page.locator('.sp-tr[data-variant="17"]')).toHaveCount(0);
    await expect(page.locator(".sp-ok__text")).toHaveText(
      "2 Luke Skywalker · Standard are back in your Vault."
    );
    await expect(page.locator(".sp-stat__sub")).toHaveText("2 back in Vault");
    await shot(page, "d2-trash", true);

    // C2: the gallery, one tile per printing with its own art.
    await page.getByRole("button", { name: "Gallery" }).click();
    await expect(page.locator(".sp-tile")).toHaveCount(6);
    await shot(page, "c2-gallery", true);

    // A row click opens the card detail on that printing.
    await page.getByRole("button", { name: "Table" }).click();
    await page.locator('.sp-tr[data-variant="8932"] .sp-td--printing').click();
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    await expect(page.locator(".cp-modal")).toContainText("Hyperspace Foil");
  });

  test("stashes-desktop-filters-narrow-the-pane", async ({ page }) => {
    await openStashes(page);
    const rows = page.locator(".sp-tr:not(.sp-tr--head)");
    await expect(rows).toHaveCount(7);
    await page.locator(".ifp-sidebar-tab").click();
    await page.getByPlaceholder("Search cards…").fill("Luke");
    await expect(rows).toHaveCount(3);
    await shot(page, "filtered", true);
  });

  test("stashes-desktop-zero-edit-dup-delete-create", async ({ page }) => {
    await openStashes(page);
    // C3: an empty stash.
    await page.locator('.sp-railrow[data-stash="3"]').click();
    await expect(page.locator(".sp-zero")).toHaveText(
      "New box has no copies. Copies go into a stash from a card’s detail."
    );
    await shot(page, "c3-zero");

    // E1 / E2: in-place edit, duplicate name.
    await page.getByRole("button", { name: "Edit name and description" }).click();
    const name = page.locator(".sp-edit .sp-field__input");
    await name.fill("Trade stash");
    await page.locator(".sp-edit").getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".sp-field__error")).toHaveText(
      "You already have a stash named Trade stash. Pick another name."
    );
    await expect(page.locator(".sp-edit").getByRole("button", { name: "Save" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await shot(page, "e2-dup");
    await name.fill("Spare box");
    await page.locator(".sp-edit").getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".sp-read__name")).toHaveText("Spare box");
    expect(recorderFor(page).stashCalls).toContain("PATCH /api/stashes/3");

    // E3: delete confirm on Red binder.
    await page.locator('.sp-railrow[data-stash="1"]').click();
    await page.getByRole("button", { name: "Edit name and description" }).click();
    await shot(page, "e1-edit");
    await page.getByRole("button", { name: "Delete stash" }).click();
    const dlg = page.getByRole("alertdialog");
    await expect(dlg).toContainText("Delete Red binder?");
    await expect(dlg).toContainText("Its 12 copies go back to your Vault.");
    await shot(page, "e3-delete");
    await dlg.getByRole("button", { name: "Delete stash" }).click();
    await expect(page.locator(".sp-railrow")).toHaveCount(2);
    expect(recorderFor(page).stashCalls).toContain("DELETE /api/stashes/1");
    dropDelete204(page);

    // B2: create.
    await page.getByRole("button", { name: "New stash" }).click();
    const create = page.getByRole("dialog", { name: "New stash" });
    await create.locator(".sp-field__input").fill("With Bob");
    await shot(page, "b2-create");
    await create.getByRole("button", { name: "Create stash" }).click();
    await expect(page.locator(".sp-railrow--on .sp-railrow__name")).toHaveText("With Bob");
  });
});

test("stashes-desktop-no-stashes", async ({ page }) => {
  await openStashes(page);
  await expect(page.locator(".sp-empty__text")).toHaveText(
    "You have no stashes. A stash records where copies are kept, like a binder or a trade box."
  );
  await shot(page, "b1-empty");
});
