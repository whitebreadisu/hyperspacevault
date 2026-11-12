import { readFileSync } from "node:fs";
import { expect, measure, test } from "./helpers";
import { recorderFor } from "./mock-api";
import type { Page } from "@playwright/test";

// BL-209 slice (c): a stash link's viewer, desktop and phone, and dead links
// (BL-357 folded in: a dead link on the phone shows its sentence, never the
// empty collection panel). The stash double lives in mock-api.ts: `stok-1` =
// Rowan's "Trade binder" (a description, 40 printings), `stok-empty` = Rowan's
// "Spare box" (no description, no cards), `stok-404` / `stok-429` the dead and
// rate-limited answers; `tok-404` is a dead VAULT link.

const ANON = { cookies: [], origins: [] };
/** stok-1's printings (mock-api: every fifth catalogue card, at most 40). */
const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as unknown[];
const PRINTINGS = Math.min(40, Math.ceil(CARDS.length / 5));
/** The viewer pane (desktop): the own Vault stays mounted, hidden, beside it. */
const SS = ".ss-page";
const isPhone = () => test.info().project.name.startsWith("phone");
const SH = '.m-app__screen[data-pane="shared"]';

/** Chromium logs a 4xx resource load as a console error; the share's 404 /
 * 429 answers are the point of these tests, not a failure. */
function forgiveStatus(page: Page, codes: number[]) {
  const rec = recorderFor(page);
  rec.consoleErrors = rec.consoleErrors.filter(
    (m) => !codes.some((c) => m.includes(`status of ${c}`))
  );
}

/** The run's end checks: errors on both layouts, plus 44 px targets and no
 * overflow on the phone. */
async function finish(page: Page, forgive: number[] = []) {
  forgiveStatus(page, forgive);
  if (isPhone()) {
    await measure(page);
    return;
  }
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
}

/** BL-357: the dead-link sentence is what the eye sees -- the topmost element
 * at its middle -- and no collection panel is painted (a panel inside the
 * parked own vault counts as shown unless an ancestor's opacity is 0). */
async function deadLinkFacts(page: Page) {
  return page.locator(".m-shared-status__text").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
    const painted = (n: Element) => {
      for (let e: Element | null = n; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.opacity === "0" || cs.display === "none") return false;
      }
      return getComputedStyle(n).visibility !== "hidden" && n.getBoundingClientRect().height > 0;
    };
    return {
      onTop: top === el || el.contains(top),
      panelsShown: [...document.querySelectorAll(".m-summary")].filter(painted).length,
    };
  });
}

test.beforeEach(() => {
  const p = test.info().project.name;
  test.skip(p !== "desktop-1440" && p !== "phone-390", "desktop-1440 and phone-390");
});

test.describe("anonymous viewer", () => {
  test.use({ storageState: ANON });

  test("bl209-viewer-anonymous", async ({ page }) => {
    const rec = recorderFor(page);
    await page.goto("/shared/stash/stok-1");
    if (isPhone()) {
      const pane = page.locator(SH);
      await expect(pane.locator(".m-stashline").first()).toBeVisible();
      await expect(pane.locator(".m-stashpanel .m-summary__label")).toHaveText("Rowan's stash");
      await expect(pane.locator(".m-stashpanel__name")).toHaveText("Trade binder");
      await expect(pane.locator(".m-stashpanel__desc")).toHaveText(
        "Doubles for trading at locals."
      );
      await expect(pane.locator(".m-count")).toHaveText(`${PRINTINGS} printings`);
      await expect(pane.getByPlaceholder("Search this stash")).toBeVisible();
      // Read-only: no pencil, trash or Return; the rows carry the count chip.
      await expect(pane.locator(".m-stashctl__icon")).toHaveCount(0);
      await expect(pane.locator(".m-stashline__return")).toHaveCount(0);
      await expect(pane.locator(".m-stashline .playset-chip").first()).toBeVisible();
      // The bar: signed out, the amber chip carries the share name.
      await expect(page.locator(".m-vswitch__face--shared")).toHaveText("Rowan");
      await expect(page.locator(".m-nav__center")).toHaveCount(0);
      // A row opens the card over the share; closing it stays in the stash.
      await pane.locator(".m-stashline__main").first().click();
      await expect(page).toHaveURL(/\/shared\/stash\/stok-1#\/card\/\d+\?v=\d+/);
      await expect(page.locator(".m-cardlayer")).toBeVisible();
      await page.getByRole("button", { name: "Close card" }).click();
      await expect(page.locator(".m-cardlayer")).toHaveCount(0);
      await expect(pane.locator(".m-stashline").first()).toBeVisible();
    } else {
      await expect(page.locator(".sp-table tbody tr").first()).toBeVisible();
      await expect(page.locator(".ss-eyebrow")).toHaveText("Rowan's stash · Read only");
      await expect(page.locator(".sp-read__name")).toHaveText("Trade binder");
      await expect(page.locator(".ss-desc")).toHaveText("Doubles for trading at locals.");
      // The pod: My vault · Rowan · Trade binder (amber, selected).
      await expect(page.locator('[data-sub="shared"]')).toHaveAttribute("aria-current", "page");
      await expect(page.locator('[data-sub="shared"]')).toContainText("Rowan · Trade binder");
      await expect(page.locator('[data-sub="own"]')).toContainText("My vault");
      await expect(page.locator(".sp-table tbody tr")).toHaveCount(PRINTINGS);
      // No edit controls anywhere: no −, trash, pencil, rail, Share, + New stash.
      await expect(page.locator(".sp-minus, .sp-trash, .sp-pencil, .sp-rail")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(Share|New stash|Add Cards)$/ })).toHaveCount(
        0
      );
      await expect(page.locator(".sp-table tbody .playset-chip").first()).toBeVisible();
      // Recently stashed (stashed_at) is in the sort bar.
      await page.getByRole("button", { name: "Sort by Recently stashed" }).click();
      await expect(
        page.getByRole("button", { name: "Sort by Recently stashed, descending" })
      ).toBeVisible();
      // A row opens the read-only detail: IN STASH, no stepper.
      await page.locator(".sp-table tbody tr").first().click();
      await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
      await expect(page.locator(".cp-plate__owned-label")).toContainText("IN STASH");
      await expect(page.locator(".cp-plate__step")).toHaveCount(0);
    }
    // Only the stash read: no resolve, quantities or limits read for a stash
    // token (React StrictMode runs the mount effect twice in dev).
    expect(new Set(rec.sharedReads)).toEqual(new Set(["/api/shared/stok-1/stash"]));
    await finish(page);
  });

  test("bl209-viewer-empty-stash", async ({ page }) => {
    await page.goto("/shared/stash/stok-empty");
    if (isPhone()) {
      const pane = page.locator(SH);
      await expect(pane.locator(".m-stashes__zero")).toHaveText(
        "Spare box has no cards right now."
      );
      await expect(pane.locator(".m-stashpanel__name")).toHaveText("Spare box");
      // No description: the line is omitted, never "No description".
      await expect(pane.locator(".m-stashpanel__desc")).toHaveCount(0);
      await expect(pane.locator(".m-metric__value").nth(0)).toHaveText("0");
      await expect(pane.locator(".m-metric__value").nth(1)).toHaveText("—");
    } else {
      await expect(page.locator(".sp-zero")).toHaveText("Spare box has no cards right now.");
      await expect(page.locator(".sp-read__name")).toHaveText("Spare box");
      await expect(page.locator(".ss-desc, .sp-read__desc")).toHaveCount(0);
      await expect(page.locator(`${SS} .inv-summary__value`).nth(0)).toHaveText("0");
      await expect(page.locator(`${SS} .inv-summary__value`).nth(1)).toHaveText("—");
    }
    await finish(page);
  });

  test("bl209-viewer-dead-and-rate-limited", async ({ page }) => {
    await page.goto("/shared/stash/stok-404");
    if (isPhone()) {
      const text = page.locator(".m-shared-status__text");
      await expect(text).toHaveText("This shared stash is no longer available.");
      // BL-357: the sentence and no empty collection panel over it.
      expect(await deadLinkFacts(page)).toEqual({ onTop: true, panelsShown: 0 });
      await expect(page.locator(".m-vswitch")).toHaveCount(0);
      await page.goto("/shared/stash/stok-429");
      await expect(text).toHaveText(
        "This shared stash is getting a lot of traffic right now — please try again in a moment."
      );
    } else {
      const text = page.locator('.loading-text[data-share-status="invalid"]');
      await expect(text).toHaveText("This shared stash is no longer available.");
      // The pod: My vault only (no share item until a link reads).
      await expect(page.locator('[data-sub="own"]')).toContainText("My vault");
      await expect(page.locator('[data-sub="shared"]')).toHaveCount(0);
      await page.goto("/shared/stash/stok-429");
      await expect(page.locator('.loading-text[data-share-status="rate-limited"]')).toHaveText(
        "This shared stash is getting a lot of traffic right now — please try again in a moment."
      );
    }
    await finish(page, [404, 429]);
  });

  test("bl357-phone-dead-vault-link", async ({ page }) => {
    test.skip(!isPhone(), "phone only (BL-357)");
    // No hash: the bare link as it is pasted.
    await page.goto("/shared/tok-404");
    const text = page.locator(".m-shared-status__text");
    await expect(text).toHaveText("This shared vault is no longer available.");
    expect(await deadLinkFacts(page)).toEqual({ onTop: true, panelsShown: 0 });
    await finish(page, [404]);
  });
});

test.describe("signed-in viewer", () => {
  test("bl209-viewer-signed-in", async ({ page }) => {
    await page.goto("/shared/stash/stok-1");
    if (isPhone()) {
      const pane = page.locator(SH);
      await expect(pane.locator(".m-stashline").first()).toBeVisible();
      // Signed in: the switch's share face reads "<share> · <stash>".
      const face = page.locator(".m-vswitch__face--shared");
      await expect(face).toHaveText("Rowan · Trade binder");
      // The switch flips to the viewer's own vault and back.
      await face.click();
      await page.getByRole("button", { name: "Your vault" }).click();
      await expect(page.locator('.m-app__screen[data-pane="own"] .m-row').first()).toBeVisible();
      // With the own vault lit, the face opens the Vault menu; the share is a row.
      await page.locator(".m-vswitch__face").click();
      await page.locator(".m-navmenu__share").click();
      await expect(pane.locator(".m-stashpanel__name")).toHaveText("Trade binder");
    } else {
      await expect(page.locator(".sp-table tbody tr").first()).toBeVisible();
      const share = page.locator('[data-sub="shared"]');
      await expect(share).toContainText("Rowan · Trade binder");
      // My vault flips to the viewer's own Vault; the share stays reachable.
      await page.locator('[data-sub="own"]').click();
      await expect(page.locator(".sp-read__name")).toBeHidden();
      await expect(page.locator(".data-table tbody tr").nth(3)).toBeVisible();
      await page.locator('[data-sub="shared"]').click();
      await expect(page.locator(".sp-read__name")).toHaveText("Trade binder");
    }
    await finish(page);
  });
});
