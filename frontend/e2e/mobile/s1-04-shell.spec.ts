import { expect, measureEach, test } from "./helpers";

// S1-04: the shell's bottom bar (rev4 `bar-one`): three targets >= 44 px --
// Vault tab, the centre SWUButton (keypad glyph only while the camera flag is
// off), More tab -- the circuit separator straddling the bar's top edge, and
// aria-current on the active tab; #/pad and #/more render ComingSoon with the
// bar still visible.
test.afterEach(measureEach);

test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone shell");
});

test("s1-04-bar-three-items", async ({ page }) => {
  await page.goto("/#/vault");
  const nav = page.locator(".m-nav");
  await expect(nav).toBeVisible();
  const m = await page.evaluate(() => {
    const nav = document.querySelector(".m-nav")!.getBoundingClientRect();
    const tabs = [...document.querySelectorAll(".m-nav .m-tab")].map((t) => {
      const r = t.getBoundingClientRect();
      return { w: r.width, h: r.height, label: t.textContent, cur: t.getAttribute("aria-current") };
    });
    const btn = document.querySelector(".m-nav__center .swu-btn")!;
    const b = btn.getBoundingClientRect();
    const sep = document.querySelector(".m-nav .m-nav__sep")!.getBoundingClientRect();
    return {
      tabs,
      btn: {
        w: b.width,
        h: b.height,
        label: btn.getAttribute("aria-label"),
        cx: b.left + b.width / 2,
      },
      tools: btn.querySelectorAll(".m-nav__tool").length,
      divider: !!btn.querySelector(".m-nav__tooldiv"),
      sepMid: sep.top + sep.height / 2,
      navTop: nav.top,
      navBottom: nav.bottom,
      iw: innerWidth,
      ih: innerHeight,
    };
  });
  expect(m.tabs.map((t) => t.label)).toEqual(["Vault", "More"]);
  for (const t of m.tabs) {
    expect(t.w).toBeGreaterThanOrEqual(44);
    expect(t.h).toBeGreaterThanOrEqual(44);
  }
  expect(m.tabs.map((t) => t.cur)).toEqual(["page", null]);
  expect(m.btn.label).toBe("Keypad");
  expect(m.btn.h).toBeGreaterThanOrEqual(44);
  expect(m.btn.w).toBeGreaterThanOrEqual(44);
  expect(Math.abs(m.btn.cx - m.iw / 2)).toBeLessThanOrEqual(2);
  expect(m.tools).toBe(1);
  expect(m.divider).toBe(false);
  expect(Math.abs(m.sepMid - m.navTop)).toBeLessThanOrEqual(1);
  expect(Math.round(m.navBottom)).toBe(m.ih);

  await page.locator(".m-nav .m-tab", { hasText: "More" }).click();
  await expect(page).toHaveURL(/#\/more$/);
  await expect(page.locator(".m-soon")).toHaveText("More arrives with a later slice.");
  await expect(page.locator(".m-nav .m-tab", { hasText: "More" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.locator(".m-soon [aria-label=Close]")).toHaveCount(0);

  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page).toHaveURL(/#\/pad$/);
  await expect(page.locator(".m-soon")).toHaveText("The keypad arrives with the next slice.");
  await expect(nav).toBeVisible();
  await expect(page.locator(".m-nav [aria-current=page]")).toHaveCount(0);

  await page.locator(".m-nav .m-tab", { hasText: "Vault" }).click();
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.locator(".m-vault")).toBeVisible();
});
