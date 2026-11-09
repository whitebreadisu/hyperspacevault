import type { Page } from "@playwright/test";
import { expect, measureEach, scrollBy, test, wheel } from "./helpers";
import { dropDelete204, recorderFor } from "./mock-api";
import { CARDS, QTY } from "./card-helpers";

// The phone Stashes page (design 1d "List + in-row return") and the bottom
// bar's tap-again Vault menu, end to end against the mocked API's stashes
// double: the menu (Collection · Stashes · the stash list), the list
// screen, inside a stash with the panel collapsing by the Vault's mechanism
// (collapsed CARDS / VALUE in the header bar slot), the resting Return ->
// active row (− / chip / trash) reverting on scroll, Undo, the gallery,
// the stash's own sort, the description popover, the edit / duplicate /
// delete sheets, delete from inside a stash, and no Stashes entries signed
// out. Bulk Select was removed (R1-14). Screenshots land in $BL344_SHOTS.
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

// R3-5: on every phone stash plate, the count at the left and the finish at
// the right, each inset 12 px from the plate's edges, on one centre line
// (within 1 px). A long finish is cut with an ellipsis: its visible right
// edge is the span's, not the unclipped text run's.
async function expectPlatesAligned(page: Page) {
  const plates = await page.locator(".m-stashgrid .gallery-plate").evaluateAll((els) => {
    // The ink's vertical centre (not the line box's): the baseline from the
    // text run's box and the font's ascent, minus half the glyphs' own
    // ascent - descent, measured with the element's font on a canvas.
    const ink = (el: Element) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      let t = el.textContent ?? "";
      if (cs.textTransform === "uppercase") t = t.toUpperCase();
      const m = ctx.measureText(t);
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      const content = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
      const baseline = r.top + (r.height - content) / 2 + m.fontBoundingBoxAscent;
      return baseline - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    };
    return els.map((plate) => {
      const box = plate.getBoundingClientRect();
      const text = (sel: string) => {
        const range = document.createRange();
        range.selectNodeContents(plate.querySelector(sel)!);
        return range.getBoundingClientRect();
      };
      const count = text(".gallery-plate__total");
      const fin = text(".m-stashtile__fin");
      const finBox = plate.querySelector(".m-stashtile__fin")!.getBoundingClientRect();
      return {
        left: count.left - box.left,
        right: box.right - Math.min(fin.right, finBox.right),
        order: fin.left > count.right,
        centre: Math.abs(
          ink(plate.querySelector(".gallery-plate__total")!) -
            ink(plate.querySelector(".m-stashtile__fin")!)
        ),
      };
    });
  });
  expect(plates.length).toBeGreaterThan(0);
  for (const p of plates) {
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left).toBeLessThanOrEqual(14);
    expect(p.right).toBeGreaterThanOrEqual(12);
    expect(p.right).toBeLessThanOrEqual(14);
    expect(p.order).toBe(true);
    // Ink centres are measured in quarter pixels and depend on the platform's
    // font rasteriser: the R3-5 CSS gives 0.25-0.75 on Windows Chromium and
    // up to 1.25 on CI's Linux Chromium; the pre-R3-5 CSS gives 1.5 on
    // Windows (fails here). 1.25 is the tightest bound both platforms hold.
    expect(p.centre, `count vs finish ink offset ${p.centre}`).toBeLessThanOrEqual(1.25);
  }
}

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
    await expect(page.locator(".m-stashpanel .m-metric__value").first()).toHaveText(
      String(RED_COPIES)
    );
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
    await expect(luke.locator(".playset-chip")).toHaveText("1");
    await expect(page.locator(".m-stashok__text")).toHaveText(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    await expect(page.locator(".m-stashpanel__sub").first()).toHaveText("1 back in Vault");
    expect(recorderFor(page).stashCalls).toContain("POST /api/stashes/1/return");
    await shot(page, "minus");

    // Undo puts it back.
    await page.locator(".m-stashok__undo").click();
    await expect(page.locator(".m-stashok")).toHaveCount(0);
    await expect(luke.locator(".playset-chip")).toHaveText("2");
    expect(recorderFor(page).stashCalls).toContain("POST /api/stashes/1/restore");

    // The row stays active through − and Undo. Starting a scroll reverts
    // it; the scroll collapses the panel by the Vault's mechanism, COPIES /
    // VALUE in the header bar slot.
    await expect(luke).toHaveClass(/m-stashline--active/);
    await scrollBy(page, SCROLL, 420);
    await expect(page.locator(".m-stashline--active")).toHaveCount(0);
    await expect(page.locator(".m-vh--collapsed")).toBeAttached();
    // R1-12: two lines -- the stash name over cards and value.
    await expect(page.locator(".m-vh__strip .m-stashstrip__name")).toHaveText("Red binder");
    await expect(page.locator(".m-vh__strip .m-stashstrip")).toContainText("cards");
    await expect(page.locator(".m-vh__strip .m-vh__n")).toHaveText(String(RED_COPIES));
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

  // Was "stashes-phone-bulk-and-gallery": its bulk Select half is retired --
  // owner removed, 2026-11-08 R1-14 (desktop has no bulk return); the
  // gallery half is kept, on the Vault's m-cell / plate.
  test("stashes-phone-gallery-sort-delete", async ({ page }) => {
    await page.goto("/#/stashes/1");
    await expect(page.locator(".m-stashline").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Select" })).toHaveCount(0);

    // R1-15 / R1-16: the stash's own sort, default Set | # by base card.
    await page.getByRole("button", { name: /^Sort: Set \| # \(base card\)/ }).click();
    const sheet = page.getByRole("dialog", { name: "Sort" });
    await expect(sheet.locator(".m-choice__row > span:first-child")).toHaveText([
      "Set | # (base card)",
      "Set | # (this printing)",
      "Name",
      "Value",
      "Copies in stash",
      "Rarity",
      "Recently stashed",
    ]);
    await settle(page);
    await shot(page, "sort-sheet");
    await sheet.getByRole("button", { name: "Name" }).click();
    await expect(page.getByRole("button", { name: /^Sort: Name, ascending/ })).toBeVisible();

    await page.getByRole("button", { name: "Gallery" }).click();
    await expect(page.locator(".m-stashgrid .m-cell").first()).toBeVisible();
    await expect(page.locator(".m-stashgrid .gallery-plate").first()).toBeVisible();
    await expectPlatesAligned(page);
    await shot(page, "gallery");

    // A tile opens the card detail on that printing.
    await page.locator(".m-stashtile").first().click();
    await expect(page).toHaveURL(/#\/card\/\d+\?v=\d+/);

    // R1-9: delete from inside the stash, with the count; it lands on the list.
    await page.goto("/#/stashes/2");
    await page.getByRole("button", { name: "Delete Trade stash" }).click();
    const del = page.locator(".m-stashsheet");
    await expect(del.locator(".m-sheet__title")).toHaveText("Delete Trade stash?");
    await expect(del).toContainText("Every card in it returns to your Vault: 2 cards.");
    await settle(page);
    await shot(page, "delete-inside");
    await del.locator(".m-stashsheet__destroy").click();
    await expect(page).toHaveURL(/#\/stashes$/);
    await expect(page.locator(".m-stashrow")).toHaveCount(2);
    expect(recorderFor(page).stashCalls).toContain("DELETE /api/stashes/2");
    dropDelete204(page);
  });

  // R1-12: the stash panel collapses with the Vault's hold -- the wheel
  // gesture that collapses ends there; the next one scrolls (s1-06).
  test("stashes-phone-collapse-holds-like-the-vault", async ({ page }) => {
    await page.goto("/#/stashes/1");
    await expect(page.locator(".m-stashline").first()).toBeVisible();
    await settle(page);
    const top = () => page.locator(SCROLL).evaluate((e) => e.scrollTop);
    await wheel(page, SCROLL, Array(12).fill(60));
    await expect(page.locator(".m-vh--collapsed")).toBeAttached();
    expect(await top()).toBe(0);
    await wheel(page, SCROLL, Array(6).fill(60));
    expect(await page.locator(SCROLL).evaluate((e) => getComputedStyle(e).overflowY)).toBe("auto");
    expect(await top()).toBeGreaterThan(0);
    await expect(page.locator(".m-vh--collapsed")).toBeAttached();
    await shot(page, "collapsed-two-line");
  });

  // R3-5 at 430 (phone-430 runs only its explicit list, so the width is
  // set here, inside the phone project).
  test.describe("at 430", () => {
    test.use({ viewport: { width: 430, height: 932 } });
    test("stashes-phone-gallery-plates-430", async ({ page }) => {
      await page.goto("/#/stashes/1");
      await expect(page.locator(".m-stashline").first()).toBeVisible();
      await page.getByRole("button", { name: "Gallery" }).click();
      await expect(page.locator(".m-stashgrid .gallery-plate").first()).toBeVisible();
      await expectPlatesAligned(page);
    });
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
      "New box has no cards. Cards go into a stash from a card’s detail."
    );
    await shot(page, "zero");
  });
});

test("stashes-phone-no-stashes", async ({ page }) => {
  await page.goto("/#/stashes");
  await expect(page.locator(".m-stashes__emptytext")).toHaveText(
    "You have no stashes. A stash records where cards are kept, like a binder or a trade box."
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
