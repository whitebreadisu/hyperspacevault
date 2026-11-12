import type { Page } from "@playwright/test";
import { expect, measureEach, test } from "./helpers";
import { dropDelete204, recorderFor } from "./mock-api";

// Stash sharing, the owner screens (App Spec §19.1), desktop 1440 and phone
// 390, against the mocked API's shares double (mock-api.ts: one vault link and
// one link per stash; deleting a stash drops its link). Create a stash link
// and copy it; switch to the vault link through "Your links"; revoke; the
// rail's link marks and "Shared · N" legend, the phone list's marks and
// "N shared"; the stash delete confirm's "Its share link stops working.".
// Component-level coverage: ShareManageModal.test.tsx, StashesPane.test.tsx,
// stashesPhone.test.tsx. Review screenshots land in $SHARE_SHOTS.

const desk = () => test.info().project.name === "desktop-1440";
test.beforeEach(() => {
  const p = test.info().project.name;
  test.skip(p !== "phone-390" && p !== "desktop-1440", "phone-390 and desktop-1440");
});
test.use({ storageState: "e2e/.auth/phone.json" });
test.afterEach(async ({ page }, info) => {
  if (info.project.name.startsWith("phone")) return measureEach({ page });
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

async function shot(page: Page, name: string) {
  const dir = process.env.SHARE_SHOTS;
  if (!dir) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/owner_${name}.png` });
}
async function shotOf(page: Page, sel: string, name: string) {
  const dir = process.env.SHARE_SHOTS;
  if (!dir) return;
  await page.evaluate(() => document.fonts.ready);
  await page.locator(sel).screenshot({ path: `${dir}/owner_${name}.png` });
}

const STASHES = [
  { id: 1, name: "Red binder", description: "Blue binder on the shelf", created_at: "2026-11-01" },
  { id: 2, name: "Trade stash", description: "For the Thursday league", created_at: "2026-11-02" },
  { id: 3, name: "With Bob", description: null, created_at: "2026-11-03" },
];
const ITEMS = [
  { stash_id: 1, variant_id: 17, quantity: 2 },
  { stash_id: 2, variant_id: 7146, quantity: 2 },
];

// ── Desktop ────────────────────────────────────────────────────────────────

test.describe("desktop", () => {
  test.beforeEach(() => test.skip(!desk(), "desktop"));
  test.use({
    stashSeed: {
      stashes: STASHES,
      stashItems: ITEMS,
      shares: { vault: "Jeremy", stashes: [{ stashId: 3, name: "Jeremy" }] },
    },
  });

  async function openStashes(page: Page) {
    await page.goto("/");
    await page.locator('[data-sub="stashes"]').click();
    await expect(page.locator(".sp-page")).toBeVisible();
    // The links have landed: With Bob's mark.
    await expect(page.locator('.sp-railrow[data-stash="3"] .sp-railrow__link')).toBeVisible();
  }

  test("bl209-desk-create-copy-switch-revoke", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const rec = recorderFor(page);
    await openStashes(page);
    const legend = page.locator(".sp-rail__legend");
    await expect(legend).toHaveText("Shared · 1");
    await expect(page.locator('.sp-railrow[data-stash="1"] .sp-railrow__link')).toHaveCount(0);
    await expect(page.locator(".sp-share .sp-linkon")).toHaveCount(0);
    await shot(page, "desk_rail_before");

    // Share in the head opens the window on Red binder: Create, pre-filled.
    await page.locator(".sp-share").getByRole("button", { name: "Share" }).click();
    const dlg = page.getByRole("dialog", { name: "Share Red binder" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel("Share name")).toHaveValue("Jeremy");
    await expect(dlg.locator(".share-modal__hint")).toHaveText(
      "Filled in from your Vault link. Viewers see Jeremy · Red binder. The share name can’t be changed later."
    );
    await shotOf(page, ".auth-modal-card", "desk_window_create");
    await dlg.getByRole("button", { name: "Create share" }).click();
    await expect.poll(() => rec.shares).toEqual(["create Jeremy stash=1"]);

    // Link mode: name · stash, Rename stash, the link, Copy -> Copied!.
    const link = dlg.locator(".share-modal__link-input");
    await expect(link).toHaveValue(/\/shared\/stash\/e2e-share-token-3$/);
    await expect(dlg.locator(".share-modal__names")).toHaveText("Jeremy· Red binder");
    await expect(dlg.getByRole("button", { name: "Rename stash" })).toBeVisible();
    await dlg.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dlg.getByRole("button", { name: "Copied!" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
    await shotOf(page, ".auth-modal-card", "desk_window_copied");
    await expect(dlg.getByRole("button", { name: "Copy", exact: true })).toBeVisible();

    // Your links · 3: Vault, Red binder (showing), With Bob.
    const list = dlg.getByRole("region", { name: "Your links" });
    await expect(list.getByRole("heading")).toHaveText("Your links · 3");
    await expect(list.locator(".share-links__name")).toHaveText([
      "Vault",
      "Red binder",
      "With Bob",
    ]);
    await expect(list.locator(".share-links__row--on")).toContainText("Showing");
    await shotOf(page, ".auth-modal-card", "desk_window_link_list");

    // The rail mark, legend and "Link on" line follow at once.
    await expect(page.locator('.sp-railrow[data-stash="1"] .sp-railrow__link')).toBeVisible();
    await expect(legend).toHaveText("Shared · 2");
    await expect(page.locator(".sp-share .sp-linkon")).toHaveText("Link on · Jeremy");

    // Switch to the vault link in place, then back.
    await list.getByRole("button", { name: "Show the Vault link" }).click();
    const vault = page.getByRole("dialog", { name: "Share your Vault" });
    await expect(vault).toBeVisible();
    await expect(vault.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
    await expect(vault.locator(".share-modal__link-input")).toHaveValue(/e2e-share-token-1$/);
    await shotOf(page, ".auth-modal-card", "desk_window_vault");
    await vault.getByRole("button", { name: "Show the Red binder link" }).click();
    await expect(dlg).toBeVisible();

    // New link confirm (Cancel), then Revoke: back to Create for Red binder.
    await dlg.getByRole("button", { name: "New link" }).click();
    await expect(dlg.locator(".auth-danger-warning")).toHaveText(
      "A new link replaces this one. The old link stops working at once — anyone still using it loses access. This cannot be undone."
    );
    await shotOf(page, ".auth-modal-card", "desk_window_rotate");
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await dlg.getByRole("button", { name: "Revoke" }).click();
    await expect(dlg.locator(".auth-danger-warning")).toHaveText(
      "Revoking breaks the link at once — anyone still using it loses access. Red binder itself is not changed. This cannot be undone."
    );
    await shotOf(page, ".auth-modal-card", "desk_window_revoke");
    await dlg.locator(".auth-danger-submit").click();
    await expect(dlg.getByRole("button", { name: "Create share" })).toBeVisible();
    expect(rec.shares.at(-1)).toBe("revoke stash=1");
    await expect(page.locator('.sp-railrow[data-stash="1"] .sp-railrow__link')).toHaveCount(0);
    await expect(legend).toHaveText("Shared · 1");
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator(".sp-share .sp-linkon")).toHaveCount(0);
  });

  // Integration with the viewer (slice c): the copied stash link opens the
  // stash viewer on that stash. Same page, so the API doubles carry over
  // (mock-api.ts serves an owner-made token's stash read from them).
  test("bl209-desk-copied-link-opens-the-stash-viewer", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openStashes(page);
    await page.locator(".sp-share").getByRole("button", { name: "Share" }).click();
    const dlg = page.getByRole("dialog", { name: "Share Red binder" });
    await dlg.getByRole("button", { name: "Create share" }).click();
    await expect(dlg.locator(".share-modal__link-input")).toHaveValue(/\/shared\/stash\//);
    await dlg.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dlg.getByRole("button", { name: "Copied!" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/shared\/stash\/e2e-share-token-\d+$/);

    await page.goto(copied);
    await expect(page.locator(".ss-page .sp-read__name")).toHaveText("Red binder");
    await expect(page.locator('[data-sub="shared"]')).toContainText("Jeremy · Red binder");
    await shot(page, "desk_viewer_from_copied_link");
  });

  test("bl209-desk-rail-marks-and-delete-line", async ({ page }) => {
    await openStashes(page);
    // A resting row's mark is the light blue; the selected row's the lighter blue.
    const mark = page.locator('.sp-railrow[data-stash="3"] .sp-railrow__link');
    await expect(mark).toHaveCSS("color", "rgb(59, 130, 246)");
    await page.locator('.sp-railrow[data-stash="3"]').click();
    await expect(mark).toHaveCSS("color", "rgb(147, 180, 255)");
    await expect(page.locator(".sp-share .sp-linkon")).toHaveText("Link on · Jeremy");
    await shot(page, "desk_stash_head_link_on");

    // Delete With Bob: the confirm carries the link line; the link dies with it.
    await page.locator(".sp-read").getByRole("button", { name: "Delete With Bob" }).click();
    const del = page.getByRole("alertdialog", { name: "Delete With Bob?" });
    await expect(del).toContainText("Its share link stops working.");
    await shotOf(page, ".auth-modal-card", "desk_delete_confirm");
    await del.getByRole("button", { name: "Delete stash" }).click();
    await expect(del).toHaveCount(0);
    dropDelete204(page);
    await expect(page.locator(".sp-railrow__link")).toHaveCount(0);
    await expect(page.locator(".sp-rail__legend")).toHaveCount(0);

    // A stash without a link: no line.
    await page
      .locator(".sp-read")
      .getByRole("button", { name: /^Delete / })
      .click();
    const plain = page.getByRole("alertdialog");
    await expect(plain).not.toContainText("Its share link stops working.");
  });
});

// ── Phone ──────────────────────────────────────────────────────────────────

test.describe("phone", () => {
  test.beforeEach(() => test.skip(desk(), "phone"));
  test.use({
    stashSeed: {
      stashes: STASHES,
      stashItems: ITEMS,
      shares: { vault: "Jeremy", stashes: [{ stashId: 2, name: "Jeremy" }] },
    },
  });

  test("bl209-phone-list-marks", async ({ page }) => {
    await page.goto("/#/stashes");
    const row2 = page.locator('.m-stashrow[data-stash="2"]');
    await expect(row2.locator(".m-stashrow__link")).toBeVisible();
    await expect(page.locator('.m-stashrow[data-stash="1"] .m-stashrow__link')).toHaveCount(0);
    await expect(page.locator(".m-stashes__label")).toHaveText("Your stashes · 3");
    await expect(page.locator(".m-stashes__shared")).toHaveText("1 shared");
    await shot(page, "phone_list");
  });

  test("bl209-phone-create-copy-switch-revoke", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const rec = recorderFor(page);
    await page.goto("/#/stashes/1");
    const share = page.getByRole("button", { name: "Share Red binder", exact: true });
    await expect(share).toBeVisible();
    // Outlined with no link; the status-row order.
    await expect(share).not.toHaveClass(/m-stashctl__icon--on/);
    const order = await page
      .locator(".m-stashctl__status > *")
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") ?? e.className.split(" ")[0])
      );
    expect(order.slice(0, 4)).toEqual([
      "m-count",
      "Share Red binder",
      "Edit stash",
      "Delete Red binder",
    ]);
    const box = (await share.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([44, 44]);
    await shot(page, "phone_stash_no_link");

    // The sharing layer over the stash, on Red binder's link: Create.
    await share.click();
    await expect(page).toHaveURL(/#\/more\/sharing\?stash=1$/);
    const dlg = page.getByRole("dialog", { name: "Share Red binder" });
    await expect(dlg.getByLabel("Share name")).toHaveValue("Jeremy");
    await shot(page, "phone_window_create");
    await dlg.getByRole("button", { name: "Create share" }).click();
    await expect.poll(() => rec.shares).toEqual(["create Jeremy stash=1"]);
    const link = dlg.locator(".share-modal__link-input");
    await expect(link).toHaveValue(/\/shared\/stash\/e2e-share-token-3$/);
    await dlg.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dlg.getByRole("button", { name: "Copied!" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
    const list = dlg.getByRole("region", { name: "Your links" });
    await expect(list.locator(".share-links__name")).toHaveText([
      "Vault",
      "Red binder",
      "Trade stash",
    ]);
    await shot(page, "phone_window_link_list");

    // Switch to the vault link in place.
    await list.getByRole("button", { name: "Show the Vault link" }).click();
    await expect(page.getByRole("dialog", { name: "Share your Vault" })).toBeVisible();
    await page
      .getByRole("dialog", { name: "Share your Vault" })
      .getByRole("button", { name: "Show the Red binder link" })
      .click();

    // Close back onto the stash: Share filled, "Link on" under VALUE.
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(/#\/stashes\/1$/);
    const on = page.getByRole("button", { name: "Share Red binder: link on" });
    await expect(on).toHaveClass(/m-stashctl__icon--on/);
    await expect(page.locator(".m-stashpanel .sp-linkon")).toHaveText("Link on · Jeremy");
    await shot(page, "phone_stash_link_on");

    // Revoke from the layer: back to Create; the stash's Share is outlined again.
    await on.click();
    await dlg.getByRole("button", { name: "Revoke" }).click();
    await dlg.locator(".auth-danger-submit").click();
    await expect(dlg.getByRole("button", { name: "Create share" })).toBeVisible();
    expect(rec.shares.at(-1)).toBe("revoke stash=1");
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(share).not.toHaveClass(/m-stashctl__icon--on/);
    await expect(page.locator(".m-stashpanel .sp-linkon")).toHaveCount(0);
  });

  test("bl209-phone-copied-link-opens-the-stash-viewer", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/#/stashes/1");
    await page.getByRole("button", { name: "Share Red binder", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Share Red binder" });
    await dlg.getByRole("button", { name: "Create share" }).click();
    await dlg.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dlg.getByRole("button", { name: "Copied!" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/shared\/stash\/e2e-share-token-\d+$/);

    await page.goto(copied);
    const pane = page.locator('.m-app__screen[data-pane="shared"]');
    await expect(pane.locator(".m-stashpanel__name")).toHaveText("Red binder");
    await shot(page, "phone_viewer_from_copied_link");
  });

  test("bl209-phone-delete-line", async ({ page }) => {
    await page.goto("/#/stashes/2");
    await expect(page.getByRole("button", { name: "Share Trade stash: link on" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Trade stash" }).click();
    const del = page.getByRole("dialog", { name: "Delete Trade stash?" });
    await expect(del).toContainText("Its share link stops working.");
    await shot(page, "phone_delete_sheet");
  });
});
