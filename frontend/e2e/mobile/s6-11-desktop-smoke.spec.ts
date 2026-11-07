import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";
import type { Page } from "@playwright/test";

// BL-252 stage 6b S6-11: the desktop regression smoke. The phone work shares
// the repo (the S1 gate in App.tsx, the isolated-document auth in firebase.ts,
// additive analytics values); this spec proves the desktop tree at 1440 still
// renders and opens its main surfaces, and that the main document stays
// outside the scan document's cross-origin isolation.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop smoke");
});
test.use({ storageState: "e2e/.auth/phone.json" });

// The phone health check (controls >= 44 px) does not apply to the dense
// desktop tree; the same page-error / console-error / failed-request checks do.
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

test("s6-11-desktop-smoke-vault-renders", async ({ page }) => {
  const res = await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();
  await expect(page.locator(".m-app")).toHaveCount(0);
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  // The main document is never cross-origin isolated (the Google sign-in
  // popup keeps window.opener): no COOP / COEP on `/`.
  const h = res!.headers();
  expect(h["cross-origin-opener-policy"]).toBeUndefined();
  expect(h["cross-origin-embedder-policy"]).toBeUndefined();
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
});

test("s6-11-desktop-smoke-filters-panel-opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  // Closed rail first (the tab is shown, the panel is not), then open, then
  // collapsed again: the test proves the toggle, not just the title text.
  const tab = page.locator(".ifp-sidebar-tab");
  const title = page.locator(".ifp-sidebar__title");
  await expect(tab).toBeVisible();
  await expect(title).toHaveCount(0);
  await tab.click();
  await expect(title).toHaveText("Filters");
  await expect(tab).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse filters" }).click();
  await expect(title).toHaveCount(0);
  await expect(tab).toBeVisible();
});

test("s6-11-desktop-smoke-card-popup-opens", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("tbody tr:not([aria-hidden])").first();
  await expect(row).toBeVisible();
  await row.locator("td").nth(1).click();
  await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
});

test("s6-11-desktop-smoke-add-cards-opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  await page.getByRole("button", { name: "Add Cards", exact: true }).click();
  await expect(page.locator(".ac-modal[role=dialog]")).toBeVisible();
});

test("s6-11-desktop-smoke-shared-page-renders", async ({ page }) => {
  await page.goto("/shared/tok-1");
  await expect(page.locator(".app-layout")).toBeVisible();
  await expect(page.locator(".m-app")).toHaveCount(0);
  await expect(page.locator(".nav-tab--active")).toContainText("Rowan");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
});

/** The brand block's rendered geometry: logo, one-line tag, header height. */
async function brandGeometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".app-header__logo").evaluate((img: HTMLImageElement) => img.decode());
  return page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const tag = document.querySelector(".app-header__brand-line")!;
    const range = document.createRange();
    range.selectNodeContents(tag);
    return {
      logo: { w: r(".app-header__logo").width, h: r(".app-header__logo").height },
      logoBottom: r(".app-header__logo").bottom,
      tagTop: r(".app-header__brand-line").top,
      tagH: r(".app-header__brand-line").height,
      tagLines: new Set(Array.from(range.getClientRects()).map((x) => Math.round(x.top))).size,
      tagText: tag.textContent,
      header: r(".app-header").height,
    };
  });
}

test("s6-11-desktop-brand-one-line-tag-and-height", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  const g = await brandGeometry(page);
  expect(g.logo).toEqual({ w: 158, h: 46 });
  // `UNOFFICIAL FAN PROJECT v2.3` renders on one line under the logo.
  expect(g.tagText).toMatch(/^Unofficial Fan Project v\d+\.\d+/);
  expect(g.tagLines, JSON.stringify(g)).toBe(1);
  expect(g.tagH).toBeLessThanOrEqual(13);
  expect(g.tagTop).toBeGreaterThanOrEqual(g.logoBottom);
  // The header keeps its pre-logo heights (App Spec §5.12): 120 px at 1440,
  // 112 px at 900 where the nav takes its own row.
  expect(Math.round(g.header)).toBe(120);
  await page.setViewportSize({ width: 900, height: 900 });
  const narrow = await brandGeometry(page);
  expect(Math.round(narrow.header)).toBe(112);
  expect(narrow.tagLines).toBe(1);
});

test("s6-11-desktop-brand-chooser", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("swu.releaseNotes.lastSeen");
    } catch {
      /* ignore */
    }
  });
  await page.goto("/");
  await expect(page.locator("tbody tr").nth(5)).toBeVisible();
  const brand = page.getByRole("button", {
    name: /^Hyperspace Vault, Unofficial Fan Project v\d+\.\d+.* - About & Legal and Updates$/,
  });
  // Unread: the tag line pulses (the nav tab keeps its own amber cue).
  await expect(page.locator(".app-header__brand-line--cue")).toHaveCount(1);
  await expect(page.locator(".app-header__brand-line")).toHaveCSS("animation-name", "na-cue-pulse");
  await expect(page.locator(".nav-tab--cue")).toHaveText("[HSV] Updates");

  await brand.click();
  const dlg = page.locator(".hsv-chooser [role=dialog]");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".swu-btn")).toHaveText(["About & Legal", "[HSV] Updates"]);
  await expect(dlg.locator(".m-chooser__btn--cue .m-cue")).toHaveCSS(
    "animation-name",
    "na-cue-pulse"
  );
  // Centred in the viewport, X inside the card's top-right corner.
  const m = await page.evaluate(() => {
    const c = document.querySelector(".hsv-chooser .m-chooser__card")!.getBoundingClientRect();
    const x = document.querySelector(".hsv-chooser .m-chooser__x")!.getBoundingClientRect();
    return {
      cx: c.left + c.width / 2,
      cy: c.top + c.height / 2,
      c,
      x,
      iw: innerWidth,
      ih: innerHeight,
    };
  });
  expect(Math.abs(m.cx - m.iw / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.cy - m.ih / 2)).toBeLessThanOrEqual(1);
  expect(m.c.right - m.x.right).toBeLessThanOrEqual(8);
  expect(m.x.top - m.c.top).toBeLessThanOrEqual(8);
  // Escape closes; Updates opens the release notes view.
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await brand.click();
  await dlg.locator(".swu-btn", { hasText: "[HSV] Updates" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator(".nav-tab--active")).toHaveText("[HSV] Updates");
  await expect(page.locator(".app-header__brand-line--cue")).toHaveCount(0);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("s6-11-desktop-brand-chooser-about-signed-out", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-header__account").getByText("Sign In")).toBeVisible();
    await page.locator(".app-header__brand-btn").click();
    await page.locator(".hsv-chooser .swu-btn", { hasText: "About & Legal" }).click();
    await expect(page.locator(".hsv-chooser")).toHaveCount(0);
    await expect(page.locator(".about-title")).toHaveText("About This Project");
  });
});
