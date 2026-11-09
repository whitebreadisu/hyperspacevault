import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";

// BL-347 round 3 at desktop 1440 against the mocked API.
// (1) The Add Cards set and precon pickers draw the layered steel-ring panel
//     (skill "The steel-ring panel"; the nav pod menu's values): a non-scrolling
//     .acx-pdd__ring (steel 0.42, both corners cut) around the scrolling
//     .acx-pdd__panel (1px smaller cut, circuit tile), and the preview's own ring.
// (2) The glyph-only buttons keep their hit areas while their glyphs grew
//     (pinned box sizes, new font sizes).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop");
});
test.use({ storageState: "e2e/.auth/phone.json" });
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
});

const STEEL = "rgba(211, 211, 212, 0.42)";

/** Both notch corners cut at n px: top-left and bottom-right, never 0 0 / 100% 100%. */
function expectTwoCorner(clip: string, n: number) {
  expect(clip).toMatch(new RegExp(`^polygon\\(${n}px 0px, 100% 0px, 100% calc\\(100% - ${n}px\\)`));
  expect(clip).toContain(`calc(100% - ${n}px) 100%`);
  expect(clip).toContain(`0px ${n}px)`);
  const verts = clip
    .replace(/^polygon\(|\)$/g, "")
    .split(/,\s*(?![^(]*\))/)
    .map((v) => v.trim());
  expect(verts).toHaveLength(6);
  expect(verts).not.toContain("0px 0px");
  expect(verts).not.toContain("100% 100%");
}

async function home(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

async function openAddCards(page: Page) {
  await home(page);
  await page.getByRole("button", { name: "Add Cards" }).first().click();
  await expect(page.locator(".ac-modal__close")).toBeVisible();
}

async function expectRing(page: Page, label: string) {
  const ring = page.locator(".acx-pdd__ring");
  const panel = ring.locator(`> .acx-pdd__panel[role="listbox"][aria-label="${label}"]`);
  await expect(panel).toBeVisible();
  const r = await ring.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, clip: s.clipPath, pad: s.paddingTop };
  });
  expect(r.bg).toBe(STEEL);
  expect(r.pad).toBe("1.5px");
  expectTwoCorner(r.clip, 10);
  const p = await panel.evaluate((el) => {
    const s = getComputedStyle(el);
    return { clip: s.clipPath, img: s.backgroundImage, border: s.borderTopWidth };
  });
  expectTwoCorner(p.clip, 9);
  expect(p.img).toContain("circuit-tile");
  expect(p.border).toBe("0px");
  return { ring, panel };
}

test("bl347-r3-precon-picker-ring-and-preview", async ({ page }) => {
  await openAddCards(page);
  await page.getByText("Select a precon deck").click();
  const { ring, panel } = await expectRing(page, "Precon Deck");

  // The ring is outside the scroll container: scrolling the list leaves it in place.
  const before = await ring.boundingBox();
  const scrolled = await panel.evaluate((el) => {
    el.scrollTop = 200;
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  expect(await ring.boundingBox()).toEqual(before);
  const ringBg = await ring.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(ringBg).toBe(STEEL);
  await panel.evaluate((el) => (el.scrollTop = 0));

  // The preview: this box is the steel layer, ::before the inner circuit layer.
  await page.locator(".acx-pdd__row").first().hover();
  const preview = page.locator(".acx-pdd__preview");
  await expect(preview).toBeVisible();
  const pv = await preview.evaluate((el) => {
    const s = getComputedStyle(el);
    const b = getComputedStyle(el, "::before");
    return {
      bg: s.backgroundColor,
      clip: s.clipPath,
      border: s.borderTopWidth,
      bClip: b.clipPath,
      bImg: b.backgroundImage,
      bInset: b.top,
    };
  });
  expect(pv.bg).toBe(STEEL);
  expect(pv.border).toBe("0px");
  expectTwoCorner(pv.clip, 8);
  expectTwoCorner(pv.bClip, 7);
  expect(pv.bImg).toContain("circuit-tile");
  expect(pv.bInset).toBe("1.5px");

  // The option rows carry a font rule (no UA button font).
  const rowFont = await page
    .locator(".acx-pdd__row-name")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(rowFont).toMatch(/^Barlow/);
});

test("bl347-r3-set-picker-ring", async ({ page }) => {
  await openAddCards(page);
  await page.getByText("Select a set to begin").click();
  await expectRing(page, "Set");
});

async function expectBox(loc: Locator, w: number, h: number, fontSize: string) {
  await expect(loc).toBeVisible();
  const b = (await loc.boundingBox())!;
  expect(Math.abs(b.width - w), `width ${b.width} vs ${w}`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(b.height - h), `height ${b.height} vs ${h}`).toBeLessThanOrEqual(0.5);
  const s = await loc.evaluate((el) => getComputedStyle(el));
  expect(s.fontSize).toBe(fontSize);
  expect(s.fontFamily).toMatch(/^Barlow/);
}

test("bl347-r3-glyph-buttons-keep-hit-areas", async ({ page }) => {
  test.setTimeout(120_000);
  // × close family.
  await home(page);
  await page.getByRole("button", { name: "Leave Feedback" }).click();
  await expectBox(page.locator(".feedback-close"), 16.5, 28, "25px");
  await page.locator(".feedback-close").click();
  await page.getByRole("button", { name: /^Hyperspace Vault, Unofficial Fan Project/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "About & Legal" }).first().click();
  await expectBox(page.locator(".about-close"), 16.5, 28, "25px");
  await openAddCards(page);
  await expectBox(page.locator(".ac-modal__close"), 28, 28, "22px");

  // Card detail: × close, ‹ › nav, − + plate stepper, − + stash stepper, price history.
  await page.goto("/?card=ash-112");
  await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
  await expectBox(page.locator(".cp-close"), 27.8, 36, "34px");
  await expectBox(page.locator(".cp-nav-btn--prev"), 21.9, 28, "24px");
  await expectBox(page.locator(".cp-nav-btn--next"), 21.9, 28, "24px");
  await expectBox(page.locator(".cp-plate__step--dec"), 32, 32, "20px");
  await expectBox(page.locator(".cp-plate__step--inc"), 32, 32, "20px");
  await expectBox(page.locator(".php-expand"), 14, 13, "14px");
  await page.locator(".cp-plate__inner .cp-stash__quiet").click();
  await page.locator(".cp-plate__inner .cp-stash__input").fill("Red binder");
  await page.getByRole("button", { name: "Create stash" }).click();
  await expectBox(page.locator(".cp-plate__inner .cp-stash__step").first(), 28, 28, "19px");
  await page.locator(".php-expand").click();
  await expectBox(page.locator(".php-close"), 12.5, 20, "25px");

  // Settings: − + cap stepper and the transactional modal's ×.
  await home(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page
    .getByRole("menuitem", { name: "Settings" })
    .or(page.getByRole("button", { name: "Settings" }))
    .first()
    .click();
  await expectBox(page.locator(".sl-capstepper__step").first(), 26, 26, "17px");
  await page.getByRole("button", { name: "Delete Account" }).first().click();
  await expectBox(page.locator(".auth-modal-close"), 16.5, 28, "25px");
});
