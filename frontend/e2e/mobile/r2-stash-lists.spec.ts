import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { byNum, fin } from "./card-helpers";

// Owner feedback 2026-11-08 (the owner has 50 stashes on dev):
//   R2-3 desktop: the pod's stash menu ends above the window's bottom; only
//        the stash rows scroll; the heading and "All stashes" stay visible.
//   R2-4 desktop: in the card detail only the stash rows scroll; the card
//        image stays put; "New stash" and Done stay visible.
//   R2-7 phone: the Vault menu stops below the screen's header (Collection
//        tappable), only its stash rows scroll, and no entry is squeezed
//        (a squeezed entry drew its blue underline through its text).
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
});

const LUKE = byNum("ASH", 112); // Standard owned 2
const STD = LUKE.variants.find((v) => fin(v) === "Standard")!;

const LONG = "Trade binder for the Thursday league ABC";

/** The 40-character name stays on one line and inside its row (R2-6:
 * stash names in Barlow Condensed 600, case as typed). */
async function longNameFits(page: Page, nameSel: string, rowSel: string) {
  const m = await page.evaluate(
    ([nameSel, rowSel, long]) => {
      const names = [...document.querySelectorAll<HTMLElement>(nameSel)];
      const longEl = names.find((n) => n.textContent === long)!;
      const shortEl = names.find((n) => n.textContent !== long)!;
      const row = longEl.closest(rowSel)!.getBoundingClientRect();
      const r = longEl.getBoundingClientRect();
      return {
        family: getComputedStyle(longEl).fontFamily,
        transform: getComputedStyle(longEl).textTransform,
        longH: r.height,
        shortH: shortEl.getBoundingClientRect().height,
        right: r.right,
        rowRight: row.right,
      };
    },
    [nameSel, rowSel, LONG] as const
  );
  expect(m.family).toContain("Barlow Condensed");
  expect(m.transform).toBe("none");
  expect(m.longH).toBeCloseTo(m.shortH, 0);
  expect(m.right).toBeLessThanOrEqual(m.rowRight + 0.5);
}

const seed = (n: number) => ({
  stashes: Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    // Stash 2 has a 40-character name (the longest allowed).
    name: i === 1 ? LONG : `Binder ${String(i + 1).padStart(2, "0")}`,
    description: null,
    created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  })),
  stashItems: [{ stash_id: 1, variant_id: STD.variant_id, quantity: 1 }],
});

/** Card art with a real shape (the harness serves a 1 px square): every
 * card image this page asks for is a w x h SVG. */
async function artOfShape(page: Page, w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#345"/></svg>`;
  const fulfill = (route: import("@playwright/test").Route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg });
  await page.route((u) => u.pathname.startsWith("/images/cards/"), fulfill);
  await page.route("https://cdn.starwarsunlimited.com/**", fulfill);
}

const rectOf = (page: Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    });

const scrolls = (page: Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .evaluate((e) => e.scrollHeight > e.clientHeight + 1);

test.describe("desktop", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop-1440", "desktop");
  });
  test.use({ storageState: "e2e/.auth/phone.json", stashSeed: seed(50) });

  for (const [w, h] of [
    [1440, 700],
    [1440, 900],
  ])
    test(`r2-03-stash-menu-fits-the-window-${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/");
      await page.locator('[data-sub="stashes"]').hover();
      const menu = page.getByTestId("stash-menu");
      await expect(menu).toHaveClass(/pod-menu--open/);
      // Let the opening slide finish before measuring.
      await menu.evaluate((e) =>
        Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished))
      );
      await expect(menu.locator(".pod-menu__row")).toHaveCount(50);
      const panel = await rectOf(page, ".pod-menu--open .pod-menu__panel");
      expect(panel.bottom).toBeLessThanOrEqual(h - 16 + 1);
      expect(await scrolls(page, ".pod-menu--open .pod-menu__list")).toBe(true);
      // The heading and "All stashes" are inside the window and the panel.
      const head = await rectOf(page, ".pod-menu--open .pod-menu__head");
      const all = await rectOf(page, ".pod-menu--open .pod-menu__all");
      expect(head.top).toBeGreaterThanOrEqual(panel.top);
      expect(all.bottom).toBeLessThanOrEqual(panel.bottom);
      await expect(menu.getByRole("button", { name: "All stashes" })).toBeInViewport();
      // Scrolling the list moves the rows, not the pinned entries.
      await page.locator(".pod-menu--open .pod-menu__list").evaluate((e) => (e.scrollTop = 9999));
      expect((await rectOf(page, ".pod-menu--open .pod-menu__all")).bottom).toBeCloseTo(
        all.bottom,
        0
      );
      await expect(menu.getByRole("button", { name: /^Binder 50,/ })).toBeInViewport();
      await longNameFits(page, ".pod-menu--open .pod-menu__name", ".pod-menu__row");
      // "New stash" is pinned last, under "All stashes", inside the panel.
      const fresh = await rectOf(page, ".pod-menu--open .pod-menu__new");
      expect(fresh.top).toBeGreaterThanOrEqual(all.bottom - 0.5);
      expect(fresh.bottom).toBeLessThanOrEqual(panel.bottom + 0.5);
      await expect(menu.getByRole("button", { name: /new stash/i })).toBeInViewport();
    });

  async function openCreateFromMenu(page: Page) {
    await page.goto("/");
    await page.locator('[data-sub="stashes"]').hover();
    const menu = page.getByTestId("stash-menu");
    await expect(menu).toHaveClass(/pod-menu--open/);
    await menu.getByRole("button", { name: /new stash/i }).click();
    const dialog = page.getByRole("dialog", { name: "New stash" });
    await expect(dialog).toBeVisible();
    await expect(menu).not.toHaveClass(/pod-menu--open/);
    return dialog;
  }

  test.describe("with room for one more (49 stashes)", () => {
    test.use({ stashSeed: seed(49) });

    test("r2-03-new-stash-from-the-menu-opens-the-dialog-and-the-new-stash", async ({ page }) => {
      const dialog = await openCreateFromMenu(page);
      await dialog.getByRole("textbox", { name: "Name" }).fill("Fresh binder");
      await dialog.getByRole("button", { name: "Create stash" }).click();
      await expect(dialog).toHaveCount(0);
      // As the Stashes page's own "+ New stash": the page opens on it.
      await expect(page.locator(".sp-page")).toBeVisible();
      await expect(page.locator('[data-sub="stashes"]')).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".sp-page")).toContainText("Fresh binder");
      // Focus is back on the pod's Stashes entry, and the menu stays shut.
      await expect(page.locator('[data-sub="stashes"]')).toBeFocused();
      await expect(page.getByTestId("stash-menu")).not.toHaveClass(/pod-menu--open/);
    });

    test("r2-03-new-stash-keyboard-path-and-escape-returns-focus", async ({ page }) => {
      await page.goto("/");
      const trigger = page.locator('[data-sub="stashes"]');
      await trigger.focus(); // focus opens the menu (NavPod)
      const menu = page.getByTestId("stash-menu");
      await expect(menu).toHaveClass(/pod-menu--open/);
      const fresh = menu.getByRole("button", { name: /new stash/i });
      await fresh.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "New stash" });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(menu).not.toHaveClass(/pod-menu--open/);
    });
  });

  test.describe("at the limit (50 stashes)", () => {
    test.use({ stashSeed: seed(50) });

    test("r2-03-new-stash-at-the-limit-shows-the-stashes-page-error", async ({ page }) => {
      const dialog = await openCreateFromMenu(page);
      await dialog.getByRole("textbox", { name: "Name" }).fill("One more");
      await dialog.getByRole("button", { name: "Create stash" }).click();
      await expect(dialog).toContainText("You have 50 stashes, the most allowed.");
      await expect(dialog).toBeVisible();
      // The 409 is the point of the test, not a failure.
      const rec = recorderFor(page);
      rec.consoleErrors = rec.consoleErrors.filter((m) => !m.includes("status of 409"));
    });
  });

  // Owner 2026-11-09: only the stash list scrolls at every height; a short
  // window scales the card image down (keeping its shape) instead.
  for (const [w, h] of [
    [1440, 900],
    [1366, 768],
    [1280, 720],
  ])
    test(`r2-04-card-detail-only-the-stash-rows-scroll-${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await artOfShape(page, 716, 1000); // a portrait card
      await openRows(page);
      // The column itself does not scroll; the stash rows do.
      expect(await scrolls(page, ".cp-center")).toBe(false);
      expect(await scrolls(page, ".cp-stash__rows .cp-stash__scroll")).toBe(true);
      // At least three stash rows show.
      const list = await rectOf(page, ".cp-stash__rows .cp-stash__scroll");
      expect(list.height).toBeGreaterThanOrEqual(3 * 40 - 1);
      // The image keeps its shape and a sensible size.
      const img = await page.locator(".cp-image").evaluate((e) => {
        const i = e as HTMLImageElement;
        const r = i.getBoundingClientRect();
        return { w: r.width, h: r.height, nat: i.naturalWidth / i.naturalHeight };
      });
      expect(img.h).toBeGreaterThanOrEqual(159);
      expect(img.w / img.h).toBeCloseTo(img.nat, 1);
      const image = await rectOf(page, ".cp-image-wrap");
      await page.locator(".cp-stash__rows .cp-stash__scroll").evaluate((e) => (e.scrollTop = 9999));
      expect((await rectOf(page, ".cp-image-wrap")).top).toBeCloseTo(image.top, 0);
      // The Vault row, New stash and Done stay visible.
      const rows = page.locator(".cp-stash__rows");
      await expect(rows.locator(".cp-stash__vault")).toBeInViewport();
      await expect(rows.getByRole("button", { name: /new stash/i })).toBeInViewport();
      await expect(rows.getByRole("button", { name: "Done" })).toBeInViewport();
      await expect(page.locator('.cp-stash__row[data-stash="50"]')).toBeInViewport();
      await longNameFits(page, ".cp-stash__rows .cp-stash__name", ".cp-stash__row");
    });

  test("r2-04-card-detail-landscape-art-scales-too-1280x720", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await artOfShape(page, 1000, 716); // landscape (a base or leader)
    // A base: landscape art (fixture ASH 19, owned 1, nothing stashed).
    await page.goto("/?card=ash-19");
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    await page.locator(".cp-plate__inner .cp-stash__quiet").click();
    await expect(page.locator(".cp-stash__rows .cp-stash__row[data-stash]")).toHaveCount(50);
    expect(await scrolls(page, ".cp-center")).toBe(false);
    const img = await page.locator(".cp-image").evaluate((e) => {
      const i = e as HTMLImageElement;
      const r = i.getBoundingClientRect();
      return { w: r.width, h: r.height, nat: i.naturalWidth / i.naturalHeight };
    });
    expect(img.w).toBeGreaterThan(img.h);
    expect(img.w / img.h).toBeCloseTo(img.nat, 1);
    const rows = page.locator(".cp-stash__rows");
    await expect(rows.getByRole("button", { name: /new stash/i })).toBeInViewport();
    await expect(rows.getByRole("button", { name: "Done" })).toBeInViewport();
  });

  /** The image's box against the column it sits in: uncapped means the
   * image is as wide as the column's content (the size on main). */
  async function imageFillsColumn(page: Page) {
    return page.evaluate(() => {
      const c = document.querySelector(".cp-center") as HTMLElement;
      const cs = getComputedStyle(c);
      const content = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const w = document.querySelector(".cp-image-wrap")!.getBoundingClientRect().width;
      return {
        fills: Math.abs(w - content) < 1,
        inlineCap: c.style.maxHeight,
        budget: c.style.getPropertyValue("--cp-image-hmax"),
      };
    });
  }

  for (const [w, h] of [
    [1280, 720],
    [1440, 900],
  ])
    test(`r2-04-read-mode-keeps-the-image-size-${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await artOfShape(page, 716, 1000);
      await page.goto("/?card=ash-112");
      await expect(page.locator(".cp-stash__list")).toBeVisible();
      expect(await imageFillsColumn(page)).toEqual({ fills: true, inlineCap: "", budget: "" });
    });

  test.describe("one stash", () => {
    test.use({ stashSeed: seed(1) });
    test("r2-04-one-stash-keeps-the-image-size-1440x900", async ({ page }) => {
      // The budget reserves only the rows present (one): the full image
      // fits beside it, so nothing is shrunk.
      await page.setViewportSize({ width: 1440, height: 900 });
      await artOfShape(page, 716, 1000);
      await page.goto("/?card=ash-112");
      await page.locator(".cp-plate__inner .cp-stash__edit").click();
      await expect(page.locator(".cp-stash__rows .cp-stash__row[data-stash]")).toHaveCount(1);
      await budgetSettled(page);
      expect((await imageFillsColumn(page)).fills).toBe(true);
    });
  });

  /** Everything the rows need is in view inside the column: New stash and
   * Done not clipped by the column or the modal. */
  async function pinnedInView(page: Page) {
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const col = r(".cp-center");
      const modal = r(".cp-modal");
      const bottom = Math.min(col.bottom, modal.bottom);
      const fresh = r(".cp-stash__rows .cp-stash__new");
      const done = r(".cp-stash__rows .cp-stash__foot");
      return { bottom, fresh: fresh.bottom, done: done.bottom };
    });
    expect(m.fresh).toBeLessThanOrEqual(m.bottom + 0.5);
    expect(m.done).toBeLessThanOrEqual(m.bottom + 0.5);
  }

  test("r2-04-expanded-price-history-with-50-stashes-1280x720", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await artOfShape(page, 716, 1000);
    await page.goto("/?card=ash-112");
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    await page.getByRole("button", { name: /expand price history/i }).click();
    await expect(page.locator(".cp-history-expand")).toBeVisible();
    await page.locator(".cp-plate__inner .cp-stash__edit").click();
    await expect(page.locator(".cp-stash__rows .cp-stash__row[data-stash]")).toHaveCount(50);
    await budgetSettled(page);
    // Too little room for the floor here: the column's last-resort scroll.
    await page.locator(".cp-center").evaluate((e) => (e.scrollTop = 99999));
    await pinnedInView(page);
  });

  // A two-line title (the header grows ~90 px with its wrapped lines): at
  // 1366x768 the image, the pinned parts and the rows still fit; at
  // 1280x720 they cannot (image floor 160 + pinned + two rows), so the
  // column's last-resort scroll applies and New stash / Done are reachable.
  for (const [w, h, fits] of [
    [1366, 768, true],
    [1280, 720, false],
  ] as const)
    test(`r2-04-long-title-with-50-stashes-${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await artOfShape(page, 716, 1000);
      await page.goto("/?card=ash-112");
      await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
      await page.locator("#cp-title").evaluate((e) => {
        e.textContent = "A very long card title that wraps onto a second line in the header bar";
      });
      await page.locator(".cp-plate__inner .cp-stash__edit").click();
      await expect(page.locator(".cp-stash__rows .cp-stash__row[data-stash]")).toHaveCount(50);
      await budgetSettled(page);
      expect(await scrolls(page, ".cp-center")).toBe(!fits);
      if (!fits) await page.locator(".cp-center").evaluate((e) => (e.scrollTop = 99999));
      await pinnedInView(page);
    });

  test("r2-04-leader-with-flip-button-1280x720", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await artOfShape(page, 1000, 716);
    await page.goto("/?card=ash-5"); // Luke Skywalker, leader (owned 1)
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    await expect(page.locator(".cp-flip")).toBeVisible();
    await page.locator(".cp-plate__inner .cp-stash__quiet").click();
    await expect(page.locator(".cp-stash__rows .cp-stash__row[data-stash]")).toHaveCount(50);
    await budgetSettled(page);
    expect(await scrolls(page, ".cp-center")).toBe(false);
    await pinnedInView(page);
  });

  test("r2-04-very-short-window-falls-back-to-the-column-scroll-1280x620", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 620 });
    await artOfShape(page, 716, 1000);
    await openRows(page);
    await expect(page.locator(".cp-center")).toHaveClass(/cp-center--tight/);
    const img = await rectOf(page, ".cp-image");
    expect(img.height).toBeGreaterThanOrEqual(159);
    await page.locator(".cp-center").evaluate((e) => (e.scrollTop = 99999));
    await pinnedInView(page);
  });

  async function openRows(page: Page) {
    await page.goto("/?card=ash-112");
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
    await page.locator(".cp-plate__inner .cp-stash__edit").click();
    await expect(page.locator(".cp-stash__rows .cp-stash__row[data-stash]")).toHaveCount(50);
    await budgetSettled(page);
  }

  /** The column's budget is measured on the frames after the rows open. */
  async function budgetSettled(page: Page) {
    await expect(page.locator(".cp-center")).toHaveClass(/cp-center--budget/);
    let last = "";
    await expect
      .poll(async () => {
        const now = await page
          .locator(".cp-center")
          .evaluate(
            (e) =>
              `${e.style.maxHeight}|${e.style.getPropertyValue("--cp-image-hmax")}|${document.querySelector(".cp-image-wrap")!.getBoundingClientRect().height}`
          );
        const same = now === last;
        last = now;
        return same;
      })
      .toBe(true);
  }
});

test.describe("phone", () => {
  test.beforeEach(() => {
    test.skip(!test.info().project.name.startsWith("phone"), "phone");
  });

  async function openMenu(page: Page) {
    await page.goto("/#/vault");
    const vault = page.locator(".m-nav .m-tab").first();
    await expect(vault).toHaveAttribute("aria-current", "page");
    await vault.click();
    await expect(page.locator(".m-navmenu")).toBeVisible();
    // Let the opening slide finish before measuring.
    await page
      .locator(".m-navmenu")
      .evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
  }

  async function headerBottom(page: Page) {
    return page
      .locator(".m-app__screen:not(.m-app__screen--parked) .m-vh")
      .evaluate((e) => e.getBoundingClientRect().bottom);
  }

  for (const n of [50, 3])
    test.describe(`${n} stashes`, () => {
      test.use({ stashSeed: seed(n) });

      test(`r2-07-vault-menu-stops-below-the-header-${n}`, async ({ page }) => {
        await openMenu(page);
        const menu = page.locator(".m-navmenu");
        await expect(menu.locator(".m-navmenu__row")).toHaveCount(n);
        const top = await headerBottom(page);
        const collection = menu.getByRole("button", { name: "Collection" });
        const c = await rectOf(page, ".m-navmenu__head");
        expect(c.top).toBeGreaterThanOrEqual(top);
        // Full height: its underline sits under the text, not through it.
        expect(Math.round(c.height)).toBe(48);
        await expect(collection).toBeInViewport();
        if (n === 50) {
          expect(await scrolls(page, ".m-navmenu__list")).toBe(true);
          await page.locator(".m-navmenu__list").evaluate((e) => (e.scrollTop = 9999));
          expect((await rectOf(page, ".m-navmenu__head")).top).toBeCloseTo(c.top, 0);
          await expect(menu.getByRole("button", { name: /^Binder 50,/ })).toBeInViewport();
        }
        if (n >= 2) await longNameFits(page, ".m-navmenu__name", ".m-navmenu__row");
        if (n !== 50) {
          expect(await scrolls(page, ".m-navmenu__list")).toBe(false);
        }
        // Collection is tappable: it takes the tap (nothing on top of it).
        await collection.click();
        await expect(menu).toHaveCount(0);
      });
    });
});

test.describe("signed out (desktop)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop-1440", "desktop");
  });
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [w, h] of [
    [1280, 720],
    [1440, 900],
  ])
    test(`r2-04-signed-out-keeps-the-image-size-${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await artOfShape(page, 716, 1000);
      await page.goto("/?card=ash-112");
      await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
      const m = await page.evaluate(() => {
        const c = document.querySelector(".cp-center") as HTMLElement;
        const cs = getComputedStyle(c);
        const content = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const w = document.querySelector(".cp-image-wrap")!.getBoundingClientRect().width;
        return { fills: Math.abs(w - content) < 1, cap: c.style.maxHeight };
      });
      expect(m).toEqual({ fills: true, cap: "" });
    });
});
