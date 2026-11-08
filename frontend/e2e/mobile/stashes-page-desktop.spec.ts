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
    const rows = page.locator("tbody .sp-tr");
    await expect(page.locator(".sp-read__name")).toHaveText("Red binder");
    // Printing-level rows, base card order: the two Luke printings are two
    // rows, side by side (R1-15).
    await expect(rows).toHaveCount(7);
    await expect(page.locator('.sp-tr[data-variant="17"] .sp-td--printing')).toHaveText("Standard");
    await expect(page.locator('.sp-tr[data-variant="8932"] .sp-td--num')).toHaveText("ASH 614");
    await expect(page.locator(".sp-stat").first()).toContainText("12");
    const lukeRows = await rows.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-variant"))
    );
    expect(Math.abs(lukeRows.indexOf("17") - lukeRows.indexOf("8932"))).toBe(1);
    await shot(page, "a1-c1-table", true);

    // D1: − on Luke Standard, 2 -> 1, the green line + Undo.
    await page.locator('.sp-tr[data-variant="17"] .sp-minus').click();
    await expect(page.locator('.sp-tr[data-variant="17"] .playset-chip')).toHaveText("1");
    await expect(page.locator(".sp-ok__text")).toHaveText(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    await expect(page.locator(".sp-stat__sub")).toHaveText("1 back in Vault");
    expect(recorderFor(page).stashCalls).toContain("POST /api/stashes/1/return");
    await shot(page, "d1-minus", true);

    // Undo restores exactly what was returned.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".sp-ok")).toHaveCount(0);
    await expect(page.locator('.sp-tr[data-variant="17"] .playset-chip')).toHaveText("2");
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
    await expect(page.locator(".sp-gallery .gallery-cell")).toHaveCount(6);
    await shot(page, "c2-gallery", true);

    // A row click opens the card detail on that printing.
    await page.getByRole("button", { name: "Table" }).click();
    await page.locator('.sp-tr[data-variant="8932"] .sp-td--printing').click();
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    await expect(page.locator(".cp-modal")).toContainText("Hyperspace Foil");
  });

  test("stashes-desktop-mock-validates-like-the-backend", async ({ page }) => {
    // The double's return / restore answer the backend's 422s and write
    // nothing: empty, a repeated printing, a quantity under 1 or over 999.
    await page.goto("/");
    const post = (action: string, items: unknown[]) =>
      page.evaluate(
        async ([a, body]) => {
          const r = await fetch(`/api/stashes/1/${a}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: body }),
          });
          return r.status;
        },
        [action, items] as const
      );
    const held = () =>
      page.evaluate(async () => {
        const r = await fetch("/api/stashes/items");
        const rows = (await r.json()) as {
          stash_id: number;
          variant_id: number;
          quantity: number;
        }[];
        return rows.find((i) => i.stash_id === 1 && i.variant_id === 17)?.quantity;
      });
    for (const action of ["return", "restore"]) {
      expect(await post(action, [])).toBe(422);
      expect(await post(action, [{ variant_id: 17, quantity: 1000 }])).toBe(422);
      expect(await post(action, [{ variant_id: 17, quantity: 0 }])).toBe(422);
      expect(
        await post(action, [
          { variant_id: 17, quantity: 1 },
          { variant_id: 17, quantity: 1 },
        ])
      ).toBe(422);
    }
    expect(await held()).toBe(2);
    // Past what the stash holds / the Vault holds: 409, nothing written.
    expect(await post("return", [{ variant_id: 17, quantity: 3 }])).toBe(409);
    expect(await post("restore", [{ variant_id: 17, quantity: 1 }])).toBe(409);
    expect(await held()).toBe(2);
    // The browser logs each refused fetch as a console error: expected here.
    const rec = recorderFor(page);
    rec.consoleErrors = rec.consoleErrors.filter((m) => !/status of 4(09|22)/.test(m));
  });

  test("stashes-desktop-filters-narrow-the-pane", async ({ page }) => {
    await openStashes(page);
    const rows = page.locator("tbody .sp-tr");
    await expect(rows).toHaveCount(7);
    // R1-5: the filters sit at the card list's top-left, not the page's.
    const list = await page.locator(".sp-list").boundingBox();
    const tab = await page.locator(".sp-list .ifp-sidebar-tab-ring").boundingBox();
    expect(Math.round(tab!.x)).toBe(Math.round(list!.x));
    expect(Math.round(tab!.y)).toBe(Math.round(list!.y));
    const pane = async () => (await page.locator(".sp-content").boundingBox())!;
    const table = async () => (await page.locator(".sp-tablewrap").boundingBox())!;
    const [paneBefore, tableBefore] = [await pane(), await table()];
    await shot(page, "filters-closed");
    await page.locator(".ifp-sidebar-tab").click();
    const panel = await page.locator(".sp-list .ifp-sidebar").boundingBox();
    expect(Math.round(panel!.x)).toBe(Math.round(list!.x));
    expect(Math.round(panel!.y)).toBe(Math.round(list!.y));
    // Opening the filters moves nothing (no 24 px overlay-pin indent).
    expect(Math.round((await pane()).x)).toBe(Math.round(paneBefore.x));
    expect(Math.round((await table()).x)).toBe(Math.round(tableBefore.x));
    await page.getByPlaceholder("Search cards…").fill("Luke");
    await expect(rows).toHaveCount(3);
    await shot(page, "filtered", true);
    // One FilterPanel for the page's life: the search survives a stash change
    // and an empty stash anchors the filters at its list corner too.
    await page.mouse.move(5, 5);
    await page.locator('.sp-railrow[data-stash="3"]').click();
    await expect(page.locator(".sp-zero")).toBeVisible();
    const empty = await page.locator(".sp-list").boundingBox();
    const corner = page.locator(".sp-list .ifp-sidebar-tab-ring, .sp-list .ifp-sidebar").first();
    const box = await corner.boundingBox();
    expect(Math.round(box!.x)).toBe(Math.round(empty!.x));
    expect(Math.round(box!.y)).toBe(Math.round(empty!.y));
    await page.locator('.sp-railrow[data-stash="1"]').click();
    if (await page.locator(".sp-list .ifp-sidebar-tab").count())
      await page.locator(".ifp-sidebar-tab").click();
    await expect(page.getByPlaceholder("Search cards…")).toHaveValue("Luke");
    await expect(rows).toHaveCount(3);
    await shot(page, "filters-empty-stash", true);
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
    await expect(dlg).toContainText("Every card in it returns to your Vault: 12 copies.");
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

// R1-7 / R1-8 / R1-10 at the extremes: 50 stashes (the per-user cap) with
// long names, the rail folded and unfolded, and the table's column balance
// at 1280 and 1920.
const MANY = {
  stashes: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: i === 49 ? "W".repeat(40) : `Stash ${i + 1} on the long shelf by the door`.slice(0, 40),
    description: i % 3 ? null : "A description long enough to need an ellipsis in the rail row",
    created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  })),
  stashItems: SEED.stashItems.filter((i) => i.stash_id === 1),
};

test.describe("many stashes", () => {
  test.use({ stashSeed: MANY });

  test("stashes-desktop-rail-scale-and-fold", async ({ page }) => {
    await openStashes(page);
    const list = page.locator(".sp-rail__list");
    await expect(list.locator(".sp-railrow")).toHaveCount(50);
    // The rail's list scrolls on its own; the page does not grow with it.
    const box = await list.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    expect(box.sh).toBeGreaterThan(box.ch);
    const vh = page.viewportSize()!.height;
    const rail = await page.locator(".sp-rail").boundingBox();
    expect(rail!.y + rail!.height).toBeLessThanOrEqual(vh + 1);
    await list.locator(".sp-railrow").last().scrollIntoViewIfNeeded();
    await expect(list.locator(".sp-railrow").last()).toBeVisible();
    await shot(page, "rail-50");

    // Fold: the edge tab; the list stays one click away; remembered.
    await page.getByRole("button", { name: "Collapse the stash list" }).click();
    await expect(page.locator(".sp-rail")).toHaveCount(0);
    const before = await page.locator(".sp-content").boundingBox();
    await shot(page, "rail-folded");
    await page.getByRole("button", { name: "Stashes, 50: show the list" }).click();
    await expect(page.locator(".sp-rail--flyout .sp-railrow")).toHaveCount(50);
    // The flyout floats: the pane does not move.
    const after = await page.locator(".sp-content").boundingBox();
    expect(Math.round(after!.x)).toBe(Math.round(before!.x));
    await shot(page, "rail-flyout");
    await page.locator('.sp-rail--flyout .sp-railrow[data-stash="50"]').click();
    await expect(page.locator(".sp-read__name")).toHaveText("W".repeat(40));
    await expect(page.locator(".sp-rail--flyout")).toHaveCount(0);
    // A fresh visit opens folded (per viewer).
    await openStashes(page);
    await expect(page.getByRole("button", { name: "Stashes, 50: show the list" })).toBeVisible();
  });
});

for (const width of [1280, 1920]) {
  test.describe(`table at ${width}`, () => {
    test.use({ stashSeed: SEED, viewport: { width, height: 1080 } });
    test(`stashes-desktop-table-balance-${width}`, async ({ page }) => {
      await openStashes(page);
      const th = page.locator(".sp-table thead th");
      await expect(th).toHaveCount(6);
      const w = await th.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      const [num, name, printing, qty, value, rarity] = w;
      // Name leads but does not take the slack; Value and Rarity have room.
      expect(name).toBeLessThan((num + printing + qty + value + rarity) * 0.5);
      expect(value).toBeGreaterThanOrEqual(120);
      expect(rarity).toBeGreaterThanOrEqual(80);
      expect(qty).toBeGreaterThanOrEqual(130);
      // No header text is clipped.
      const clipped = await th.evaluateAll(
        (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length
      );
      expect(clipped).toBe(0);
      // Nor any Rarity cell (badge + label).
      const rarityClipped = await page
        .locator(".sp-table tbody td.sp-td--rarity")
        .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      expect(rarityClipped).toBe(0);
      await shot(page, `table-${width}`, true);
    });
  });
}

// R1-8: the page never scrolls sideways, at any desktop width (the table
// scrolls inside its own wrapper, the head wraps).
for (const width of [768, 1024, 1280, 1920]) {
  test.describe(`page width ${width}`, () => {
    test.use({ stashSeed: SEED, viewport: { width, height: 900 } });
    test(`stashes-desktop-no-horizontal-overflow-${width}`, async ({ page }) => {
      await openStashes(page);
      await expect(page.locator("tbody .sp-tr").first()).toBeVisible();
      const over = () =>
        page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      // The Stashes page itself stays inside the window (checked first, so a
      // header overflow -- r1-01-header-widths -- reads as that, not this).
      const pageRight = await page
        .locator(".sp-page")
        .evaluate((e) => Math.max(e.getBoundingClientRect().right, e.scrollWidth));
      expect(pageRight, "stash page right edge").toBeLessThanOrEqual(width);
      expect(await over()).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "Gallery" }).click();
      expect(await over()).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "Table" }).click();
      await page.getByRole("button", { name: "Collapse the stash list" }).click();
      expect(await over()).toBeLessThanOrEqual(0);
      await shot(page, `overflow-${width}`, true);
    });
  });
}

test("stashes-desktop-no-stashes", async ({ page }) => {
  await openStashes(page);
  await expect(page.locator(".sp-empty__text")).toHaveText(
    "You have no stashes. A stash records where copies are kept, like a binder or a trade box."
  );
  await shot(page, "b1-empty");
});
