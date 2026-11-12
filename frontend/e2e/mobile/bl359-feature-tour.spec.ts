import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { byNum, fin, openCard } from "./card-helpers";

// App Spec §20, "Feature tour": the v2.5 tips on desktop (1440) and phone
// (390) against the mocked API. The harness turns the tour off (helpers.ts
// tourOff); each test here turns it on with `since` far ahead, so the e2e
// account (created during the run) counts as a returning user. The app writes
// <html data-tour-phase> ("<page>:empty" once a page has settled with nothing
// to show, "off" when no page tour runs), so "no tip" is asserted without a
// fixed wait. Review screenshots land in $BL359_SHOTS when it names a folder.

const TIP = ".tour-tip";
const SEEN = "swu.tour.seen";
const SKIPPED = "swu.tour.skipped";
const LUKE = byNum("ASH", 112); // Standard owned 2
const STD = LUKE.variants.find((v) => fin(v) === "Standard")!;

const desk = () => test.info().project.name === "desktop-1440";
const phone390 = () => test.info().project.name === "phone-390";

test.beforeEach(() => {
  const p = test.info().project.name;
  test.skip(p !== "phone-390" && p !== "desktop-1440", "phone-390 and desktop-1440");
});
test.use({ storageState: "e2e/.auth/phone.json" });
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

/** The tour on, for an account older than `since`; `seen` tips pre-marked. */
async function tourOn(page: Page, opts: { since?: string; seen?: string[] } = {}) {
  await page.addInitScript(
    ({ since, seen, key }) => {
      (window as unknown as { __hsvTour: unknown }).__hsvTour = { on: true, since };
      if (seen.length && !localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ "2.5": seen }));
    },
    { since: opts.since ?? "2999-01-01", seen: opts.seen ?? [], key: SEEN }
  );
}

const phase = (page: Page) => page.locator("html");

async function shot(page: Page, name: string) {
  const dir = process.env.BL359_SHOTS;
  if (!dir) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/${name}.png` });
}

/** The tip's box sits on the given side of the target's box. */
async function boxes(tip: Locator, target: Locator) {
  const t = (await tip.boundingBox())!;
  const g = (await target.boundingBox())!;
  return { t, g };
}

const seenRecord = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}"), SEEN);

// ── Desktop ────────────────────────────────────────────────────────────────

test.describe("desktop", () => {
  test.beforeEach(() => test.skip(!desk(), "desktop"));

  test("bl359-desk-collection-tip-after-settle-then-done", async ({ page }) => {
    await tourOn(page);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
    const t0 = Date.now();
    const tip = page.getByRole("dialog", { name: "Stashes" });
    await expect(tip).toBeVisible();
    // About a second after the page settles, never at once.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    await expect(tip).toContainText("New in v2.5");
    await expect(tip).toContainText("Point at Stashes to see yours or start one.");
    await expect(tip).not.toContainText(/\d of \d/);
    await expect(tip.getByRole("button", { name: "Skip tour" })).toBeVisible();
    // Under the pod's Stashes item, notch up, the item glowing.
    const target = page.locator('[data-tour="nav-stashes"]');
    const { t, g } = await boxes(tip, target);
    expect(t.y).toBeGreaterThanOrEqual(g.y + g.height);
    await expect(page.locator(TIP)).toHaveClass(/tour-tip--up/);
    await expect(page.locator(".tour-glow")).toBeVisible();
    // Focus stays where it was.
    expect(await page.evaluate(() => document.activeElement?.closest(".tour-tip") == null)).toBe(
      true
    );
    await shot(page, "01_desk_tip1");
    await tip.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(TIP)).toHaveCount(0);
    expect(await seenRecord(page)).toEqual({ "2.5": ["stashes-nav"] });

    // A reload does not show a seen tip.
    await page.reload();
    await expect(phase(page)).toHaveAttribute("data-tour-phase", "collection:empty");
    await expect(page.locator(TIP)).toHaveCount(0);
  });

  test("bl359-desk-card-window-1-of-2-then-2-of-2", async ({ page }) => {
    await tourOn(page, { seen: ["stashes-nav"] });
    await page.goto("/?card=ash-112");
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    const first = page.getByRole("dialog", { name: "Stash copies" });
    await expect(first).toBeVisible();
    await expect(first).toContainText("1 of 2");
    await expect(first).toContainText("so you know which binder or box or friend has it");
    // To the right of the button, notch on the left edge.
    const { t, g } = await boxes(first, page.locator('[data-tour="card-stash-copies"]'));
    expect(t.x).toBeGreaterThanOrEqual(g.x + g.width);
    await expect(page.locator(TIP)).toHaveClass(/tour-tip--left/);
    await shot(page, "02_desk_tip2");
    await first.getByRole("button", { name: "Next" }).click();
    const second = page.getByRole("dialog", { name: "Share this card" });
    await expect(second).toContainText("2 of 2");
    await expect(second).toContainText("Paste it in a text or on Discord.");
    const link = await boxes(second, page.locator('[data-tour="card-share"]'));
    expect(link.t.y).toBeGreaterThanOrEqual(link.g.y + link.g.height);
    await shot(page, "03_desk_tip4");
    // Stashes page still unseen: Skip tour stays.
    await expect(second.getByRole("button", { name: "Skip tour" })).toBeVisible();
    await second.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(TIP)).toHaveCount(0);
    expect(await seenRecord(page)).toEqual({
      "2.5": ["stashes-nav", "stash-copies", "share-card"],
    });
    // The card window keeps its own Escape (the tip took none).
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
  });

  test.describe("stashed copies", () => {
    test.use({
      stashSeed: {
        stashes: [
          { id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" },
        ],
        stashItems: [{ stash_id: 1, variant_id: STD.variant_id, quantity: 1 }],
      },
    });

    test("bl359-desk-2b-instead-of-2", async ({ page }) => {
      await tourOn(page, { seen: ["stashes-nav"] });
      await page.goto("/?card=ash-112");
      const tip = page.getByRole("dialog", { name: "Your stashed copies" });
      await expect(tip).toBeVisible();
      await expect(tip).toContainText("1 of 2");
      await expect(tip).toContainText("Use Edit to move them around.");
      await shot(page, "04_desk_tip2b");
      // Escape closes the tip only, without marking it.
      await page.keyboard.press("Escape");
      await expect(page.locator(TIP)).toHaveCount(0);
      await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
      expect(await seenRecord(page)).toEqual({ "2.5": ["stashes-nav"] });
    });
  });

  test("bl359-desk-stashes-page-heading", async ({ page }) => {
    await tourOn(page, { seen: ["stashes-nav"] });
    await page.goto("/");
    await expect(phase(page)).toHaveAttribute("data-tour-phase", "collection:empty");
    await page.locator('[data-sub="stashes"]').click();
    const tip = page.getByRole("dialog", { name: "Your stashes" });
    await expect(tip).toBeVisible();
    await expect(tip).not.toContainText(/\d of \d/);
    const { t, g } = await boxes(tip, page.locator('[data-tour="stashes-heading"]'));
    expect(t.y).toBeGreaterThanOrEqual(g.y + g.height);
    await shot(page, "05_desk_tip3");
  });

  test("bl359-desk-skip-tour-ends-it-everywhere", async ({ page }) => {
    await tourOn(page);
    await page.goto("/");
    const tip = page.getByRole("dialog", { name: "Stashes" });
    await tip.getByRole("button", { name: "Skip tour" }).click();
    await expect(page.locator(TIP)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), SKIPPED)).toBe('{"2.5":true}');
    await expect(phase(page)).toHaveAttribute("data-tour-phase", "off");
    // The card window's tips never start either.
    await page.goto("/?card=ash-112");
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    await expect(phase(page)).toHaveAttribute("data-tour-phase", "off");
    await expect(page.locator(TIP)).toHaveCount(0);
  });

  test("bl359-desk-empty-click-closes-without-marking", async ({ page }) => {
    await tourOn(page);
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Stashes" })).toBeVisible();
    // The header's open starfield, clear of the brand, the pod and the
    // account slot.
    await page.mouse.click(1100, 30);
    await expect(page.locator(TIP)).toHaveCount(0);
    expect(await seenRecord(page)).toEqual({});
  });

  test("bl359-desk-new-account-sees-nothing", async ({ page }) => {
    // The account was created after this date: a new user.
    await tourOn(page, { since: "2000-01-01" });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
    await expect(phase(page)).toHaveAttribute("data-tour-phase", "off");
    await expect(page.locator(TIP)).toHaveCount(0);
  });
});

// ── Phone ──────────────────────────────────────────────────────────────────

test.describe("phone", () => {
  test.beforeEach(() => test.skip(!phone390(), "phone"));

  test("bl359-phone-vault-tab-tip", async ({ page }) => {
    await tourOn(page);
    await page.goto("/");
    await expect(page.locator(".m-app")).toBeVisible();
    const tip = page.getByRole("dialog", { name: "Stashes live under Vault" });
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Tap Vault again to open its menu.");
    // Above the Vault tab, notch down, 8 px from the screen's left.
    const tab = page.locator('[data-tour="nav-stashes"]');
    const { t, g } = await boxes(tip, tab);
    expect(t.y + t.height).toBeLessThanOrEqual(g.y);
    expect(Math.round(t.x)).toBe(8);
    await expect(page.locator(TIP)).toHaveClass(/tour-tip--down/);
    for (const b of await tip.getByRole("button").all())
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "06_phone_tip1");
    // Tapping Vault uses the target: seen, and the menu opens as usual.
    await tab.click();
    await expect(page.locator(TIP)).toHaveCount(0);
    await expect(page.locator(".m-navmenu")).toBeVisible();
    expect(await seenRecord(page)).toEqual({ "2.5": ["stashes-nav"] });
  });

  test("bl359-phone-card-detail-tips", async ({ page }) => {
    await tourOn(page, { seen: ["stashes-nav"] });
    await openCard(page, "ASH", 112);
    const entry = page.locator(".m-dreg3__own .m-stash__entry");
    await expect(entry).toBeVisible();
    const first = page.getByRole("dialog", { name: "Stash copies" });
    await expect(first).toBeVisible();
    await expect(first).toContainText("1 of 2");
    // Below the row, or above it when below would leave the screen; never
    // over it.
    const { t, g } = await boxes(first, page.locator('[data-tour="card-stash-copies"]').first());
    expect(t.y >= g.y + g.height - 0.5 || t.y + t.height <= g.y + 0.5).toBe(true);
    await shot(page, "07_phone_tip2");
    await first.getByRole("button", { name: "Next" }).click();
    const second = page.getByRole("dialog", { name: "Share this card" });
    await expect(second).toContainText("2 of 2");
    await expect(second).toContainText("through your phone's share menu");
    await shot(page, "08_phone_tip4");
    await second.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(TIP)).toHaveCount(0);
  });

  test("bl359-phone-stashes-page-heading", async ({ page }) => {
    await tourOn(page, { seen: ["stashes-nav"] });
    await page.goto("/#/stashes");
    const tip = page.getByRole("dialog", { name: "Your stashes" });
    await expect(tip).toBeVisible();
    const { t, g } = await boxes(tip, page.locator('[data-tour="stashes-heading"]'));
    expect(t.y).toBeGreaterThanOrEqual(g.y + g.height);
    await shot(page, "09_phone_tip3");
  });

  test("bl359-phone-new-account-sees-nothing", async ({ page }) => {
    await tourOn(page, { since: "2000-01-01" });
    await page.goto("/");
    await expect(page.locator(".m-app")).toBeVisible();
    await expect(phase(page)).toHaveAttribute("data-tour-phase", "off");
    await expect(page.locator(TIP)).toHaveCount(0);
  });
});
