import type { Page } from "@playwright/test";
import { expect, measureEach, scrollBy, test } from "./helpers";
import { dropDelete204, recorderFor } from "./mock-api";
import { CARDS, QTY } from "./card-helpers";

// The phone Stashes page (design 1d "List + in-row return") and the bottom
// bar's tap-again Vault menu, end to end against the mocked API's stashes
// double: the menu (Collection · Stashes · the stash list), the list
// screen, inside a stash with the panel collapsing by the Vault's mechanism
// (collapsed COPIES / VALUE in the header bar slot), the resting Return ->
// active row (− / chip / trash) reverting on scroll, Undo, bulk Select,
// gallery, the description popover, the edit / duplicate / delete sheets,
// and no Stashes entries signed out. Screenshots land in $BL344_SHOTS.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone page");
});

const shot = async (page: Page, name: string) => {
  const dir = process.env.BL344_SHOTS;
  if (dir && test.info().project.name === "phone-390") {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/phone2-${name}.png` });
  }
};
const settle = (page: Page) => page.waitForTimeout(350);

// Every owned printing of the fixture goes into Red binder (enough rows to
// scroll and collapse the panel); Trade stash and New box stay small.
const owned: { variant_id: number; quantity: number }[] = [];
for (const c of CARDS)
  for (const v of c.variants) {
    const q = QTY.get(v.variant_id);
    if (q) owned.push({ variant_id: v.variant_id, quantity: q });
  }
const SEED = {
  stashes: [
    {
      id: 1,
      name: "Red binder",
      description:
        "Blue binder on the shelf, SOR and SHD playsets. Sleeved, sorted by set and number; rares in the back pages.",
      created_at: "2026-11-01T00:00:00Z",
    },
    { id: 2, name: "Trade stash", description: null, created_at: "2026-11-02T00:00:00Z" },
    { id: 3, name: "New box", description: null, created_at: "2026-11-03T00:00:00Z" },
  ],
  stashItems: owned
    .filter((o) => o.variant_id !== 7146)
    .map((o) => ({ stash_id: 1, ...o }))
    .concat([{ stash_id: 2, variant_id: 7146, quantity: 2 }]),
};
const RED_COPIES = SEED.stashItems
  .filter((i) => i.stash_id === 1)
  .reduce((n, i) => n + i.quantity, 0);

const SCROLL = ".m-app__screen:not(.m-app__screen--parked) .m-vault__scroll";
const LUKE = '.m-stashline[data-variant="17"]'; // ASH 112 Standard, 2 in the stash

test.describe("seeded", () => {
  test.use({ stashSeed: SEED });

  test("stashes-phone-menu-and-list", async ({ page }) => {
    await page.goto("/#/vault");
    const vault = page.locator(".m-nav .m-tab").first();
    await expect(vault).toHaveAttribute("aria-current", "page");
    // The lit tab, tapped again, opens its menu.
    await vault.click();
    const menu = page.locator(".m-navmenu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".m-navmenu__head")).toHaveText(["Collection", "Stashes"]);
    await expect(menu.locator(".m-navmenu__name")).toHaveText([
      "Red binder",
      "Trade stash",
      "New box",
    ]);
    await settle(page);
    await shot(page, "nav-menu");
    // A tap outside closes it.
    await page.mouse.click(200, 300);
    await expect(menu).toHaveCount(0);
    await vault.click();
    await menu.getByRole("button", { name: "Stashes" }).click();
    await expect(page).toHaveURL(/#\/stashes$/);
    await expect(page.locator(".m-stashrow")).toHaveCount(3);
    await expect(page.locator(".m-stashrow__copies").first()).toHaveText(String(RED_COPIES));
    await shot(page, "a-list");

    // A2: the pencil opens Edit stash; a duplicate name is refused inline.
    await page.locator('.m-stashrow[data-stash="3"] .m-stashrow__pencil').click();
    const sheet = page.locator(".m-stashsheet");
    await expect(sheet.locator(".m-sheet__title")).toHaveText("Edit stash");
    await sheet.locator(".sp-field__input").fill("Trade stash");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet.locator(".sp-field__error")).toHaveText(
      "You already have a stash named Trade stash. Pick another name."
    );
    await settle(page);
    await shot(page, "a2-edit-dup");
    // Delete from the edit sheet: the confirm, then the row leaves.
    await sheet.getByRole("button", { name: "Delete stash" }).click();
    const del = page.locator(".m-stashsheet");
    await expect(del.locator(".m-sheet__title")).toHaveText("Delete New box?");
    await settle(page);
    await shot(page, "delete");
    await del.locator(".m-stashsheet__destroy").click();
    await expect(page.locator(".m-stashrow")).toHaveCount(2);
    expect(recorderFor(page).stashCalls).toContain("DELETE /api/stashes/3");
    dropDelete204(page);

    // Create.
    await page.getByRole("button", { name: "New stash" }).click();
    const create = page.locator(".m-stashsheet");
    await create.locator(".sp-field__input").fill("With Bob");
    await settle(page);
    await shot(page, "create");
    await create.getByRole("button", { name: "Create stash" }).click();
    await expect(page.locator(".m-stashrow")).toHaveCount(3);
  });

  test("stashes-phone-inside-collapse-return-undo", async ({ page }) => {
    await page.goto("/#/stashes/1");
    await expect(page.locator(".m-stashpanel__name")).toHaveText("Red binder");
    await expect(page.locator(".m-stashline").first()).toBeVisible();
    await expect(page.locator(".m-stashpanel__copies")).toHaveText(String(RED_COPIES));
    await settle(page);
    await shot(page, "inside-expanded");

    // The description popover.
    await page.locator(".m-stashpanel__desc").click();
    await expect(page.locator(".m-stashpop")).toBeVisible();
    await shot(page, "desc-popover");
    await page.locator(".m-stashpop__close").click();
    await expect(page.locator(".m-stashpop")).toHaveCount(0);

    // Resting Return -> active row with − / chip / trash.
    const luke = page.locator(LUKE);
    // Bring the row into view first and let any collapse settle: a scroll
    // that starts after the row is active reverts it (by design).
    await luke.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await luke.locator(".m-stashline__return").click();
    await expect(luke).toHaveClass(/m-stashline--active/);
    await shot(page, "active-row");
    await luke.locator(".m-stashline__minus").click();
    await expect(luke.locator(".m-stashline__chip")).toHaveText("1");
    await expect(page.locator(".m-stashok__text")).toHaveText(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    await expect(page.locator(".m-stashpanel__sub").first()).toHaveText("1 back in Vault");
    expect(recorderFor(page).stashCalls).toContain("POST /api/stashes/1/return");
    await shot(page, "minus");

    // Undo puts it back.
    await page.locator(".m-stashok__undo").click();
    await expect(page.locator(".m-stashok")).toHaveCount(0);
    await expect(luke.locator(".m-stashline__chip")).toHaveText("2");
    expect(recorderFor(page).stashCalls).toContain("POST /api/stashes/1/restore");

    // The row stays active through − and Undo. Starting a scroll reverts
    // it; the scroll collapses the panel by the Vault's mechanism, COPIES /
    // VALUE in the header bar slot.
    await expect(luke).toHaveClass(/m-stashline--active/);
    await scrollBy(page, SCROLL, 420);
    await expect(page.locator(".m-stashline--active")).toHaveCount(0);
    await expect(page.locator(".m-vh--collapsed")).toBeAttached();
    await expect(page.locator(".m-vh__strip .m-stashstrip")).toContainText("Copies");
    await expect(page.locator(".m-vh__strip .m-stashstrip__copies")).toHaveText(String(RED_COPIES));
    await shot(page, "collapsed");
    // Back at the top it stays collapsed (never re-expands on scroll).
    await scrollBy(page, SCROLL, -900);
    await expect(page.locator(".m-vh--collapsed")).toBeAttached();
    // A tap on the strip expands it.
    await page.locator(".m-vh__readout").click();
    await expect(page.locator(".m-vh--collapsed")).toHaveCount(0);

    // Trash returns every copy; the row leaves.
    await luke.locator(".m-stashline__return").click();
    await luke.locator(".m-stashline__trash").click();
    await expect(page.locator(LUKE)).toHaveCount(0);
    await expect(page.locator(".m-stashok__text")).toHaveText(
      "2 Luke Skywalker · Standard are back in your Vault."
    );
  });

  test("stashes-phone-bulk-and-gallery", async ({ page }) => {
    await page.goto("/#/stashes/1");
    await expect(page.locator(".m-stashline").first()).toBeVisible();
    await page.getByRole("button", { name: "Select" }).click();
    const lines = page.locator(".m-stashline");
    await lines.nth(0).locator(".m-stashline__main").click();
    await lines.nth(1).locator(".m-stashline__main").click();
    const bulk = page.locator(".m-stashbulk");
    await expect(bulk).toBeVisible();
    await expect(bulk.locator(".m-stashbulk__count")).toContainText("2 selected");
    await shot(page, "bulk");
    const copies = Number(
      ((await bulk.getByRole("button").textContent()) ?? "").match(/Return (\d+)/)![1]
    );
    await bulk.getByRole("button", { name: /Return \d+ to Vault/ }).click();
    await expect(bulk).toHaveCount(0);
    await expect(page.locator(".m-stashok__text")).toHaveText(
      `${copies} ${copies === 1 ? "copy is" : "copies are"} back in your Vault.`
    );
    // The returned rows stay, dimmed at 0, beside Undo.
    await expect(page.locator(".m-stashline--dim")).toHaveCount(2);
    await shot(page, "bulk-done");

    await page.getByRole("button", { name: "Gallery" }).click();
    await expect(page.locator(".m-stashtile").first()).toBeVisible();
    await shot(page, "gallery");

    // A tile opens the card detail on that printing.
    await page.locator(".m-stashtile").first().click();
    await expect(page).toHaveURL(/#\/card\/\d+\?v=\d+/);
  });

  test("stashes-phone-share-own-vault-menu", async ({ page }) => {
    // A share shown: the switch keeps its behaviour and offers no stashes.
    await page.goto("/shared/tok-1#/vault");
    const shared = page.locator(".m-vswitch__face--shared");
    await expect(shared).toHaveText("Rowan");
    await shared.click();
    await expect(page.locator(".m-navmenu")).toHaveCount(0);
    await page.getByRole("button", { name: "Your vault" }).click();
    // Own vault shown, share held: the lit switch opens the Vault menu with
    // the share as one more row.
    const face = page.getByRole("button", { name: "Vault: switch vault" });
    await expect(face).toHaveAttribute("aria-current", "page");
    await face.click();
    const menu = page.locator(".m-navmenu");
    await expect(menu.locator(".m-navmenu__head")).toHaveText(["Collection", "Stashes", "Rowan"]);
    await settle(page);
    await shot(page, "share-menu");
    await menu.getByRole("button", { name: "Stashes" }).click();
    await expect(page).toHaveURL(/#\/stashes$/);
    await expect(page.locator(".m-stashrow")).toHaveCount(3);
    // And the share row switches back to the share.
    await face.click();
    await page.locator(".m-navmenu").getByRole("button", { name: "Rowan's vault" }).click();
    await expect(page.locator(".m-vswitch__face--shared")).toBeVisible();
  });

  test("stashes-phone-empty-stash", async ({ page }) => {
    await page.goto("/#/stashes/3");
    await expect(page.locator(".m-stashes__zero")).toHaveText(
      "New box has no copies. Copies go into a stash from a card’s detail."
    );
    await shot(page, "zero");
  });
});

test("stashes-phone-no-stashes", async ({ page }) => {
  await page.goto("/#/stashes");
  await expect(page.locator(".m-stashes__emptytext")).toHaveText(
    "You have no stashes. A stash records where copies are kept, like a binder or a trade box."
  );
  await shot(page, "b-empty");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("stashes-phone-signed-out-no-entries", async ({ page }) => {
    await page.goto("/#/stashes");
    await expect(page).toHaveURL(/#\/vault/);
    const vault = page.locator(".m-nav .m-tab").first();
    await expect(vault).toHaveAttribute("aria-current", "page");
    await vault.click();
    await expect(page.locator(".m-navmenu")).toHaveCount(0);
    expect(recorderFor(page).stashCalls).toEqual([]);
  });
});
