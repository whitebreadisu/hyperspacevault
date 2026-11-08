import type { Locator } from "@playwright/test";
import { expect, test } from "./helpers";

// BL-344 R1 design audit D20 / D36: the desktop pod's stash menu and the
// phone Vault menu are steel-ring panels with BOTH the top-left and the
// bottom-right corner cut (swu-design-language "The steel-ring panel"; the
// slice-2 polygons started at `0 0`, no top-left cut). Both layers of each
// ring carry the same cut, the inner one 1 px smaller.
test.use({
  storageState: "e2e/.auth/phone.json",
  stashSeed: {
    stashes: [
      { id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" },
      { id: 2, name: "Trade stash", description: null, created_at: "2026-11-02T00:00:00Z" },
    ],
    stashItems: [{ stash_id: 1, variant_id: 17, quantity: 1 }],
  },
});

/** The first and last points of a computed `polygon(...)`. */
async function cut(el: Locator, pseudo: string | null = null) {
  const clip = await el.evaluate((e, p) => getComputedStyle(e, p).clipPath, pseudo);
  const pts = clip.replace(/^polygon\(|\)$/g, "").split(/,\s*/);
  return { clip, first: pts[0], last: pts[pts.length - 1], n: pts.length };
}

test("d20-desktop-stash-menu-both-corners-cut", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop pod");
  await page.goto("/");
  await page.locator('[data-sub="stashes"]').hover();
  const panel = page.locator(".pod-menu--open .pod-menu__panel");
  await expect(panel).toBeVisible();
  const outer = await cut(panel, "::before");
  const inner = await cut(panel, "::after");
  expect(outer, outer.clip).toMatchObject({ first: "12px 0px", last: "0px 12px", n: 6 });
  expect(inner, inner.clip).toMatchObject({ first: "11px 0px", last: "0px 11px", n: 6 });
  // The head text clears the cut.
  // The head's text clears the cut (its top-left sits outside the 12 px
  // triangle: x + y >= 12 from the panel's corner).
  const gap = await panel.evaluate((p) => {
    const box = p.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(p.querySelector(".pod-menu__head span")!);
    const t = range.getBoundingClientRect();
    return t.left - box.left + (t.top - box.top);
  });
  expect(gap).toBeGreaterThanOrEqual(12);
});

test("d36-phone-vault-menu-both-corners-cut", async ({ page }) => {
  test.skip(test.info().project.name !== "phone-390", "phone menu");
  await page.goto("/#/vault");
  const vault = page.locator(".m-nav .m-tab").first();
  await expect(vault).toHaveAttribute("aria-current", "page");
  await vault.click();
  const menu = page.locator(".m-navmenu");
  await expect(menu).toBeVisible();
  const outer = await cut(menu);
  const inner = await cut(menu.locator(".m-navmenu__inner"));
  expect(outer, outer.clip).toMatchObject({ first: "14px 0px", last: "0px 14px", n: 6 });
  expect(inner, inner.clip).toMatchObject({ first: "13px 0px", last: "0px 13px", n: 6 });
  const dir = process.env.BL344_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/phone-d36-menu.png` });
});
