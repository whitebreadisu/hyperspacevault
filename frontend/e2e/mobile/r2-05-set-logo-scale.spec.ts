import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";

// R2-5 (owner, 2026-11-08): on desktop, the HMW, JTL, LOF, TWI, IBH, TS26 and
// IC27 logos read small next to SOR / SHD / SEC / LAW / ASH in the Vault's
// "by set" popovers and the card detail header -- their PNGs carry more
// transparent margin. They get a per-set optical scale (data-set +
// screens/cards/setLogoDesktop.css), drawn with a transform so no row or
// header changes size. The phone keeps its own equal-area rule
// (mobile/setLogoArt.ts) and is not touched. Review screenshots land in
// $R25_SHOTS (prefix $R25_TAG, e.g. "before" / "after").
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop surfaces");
});
test.use({ storageState: "e2e/.auth/phone.json" });
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

const RAISED = ["HMW", "JTL", "LOF", "TWI", "IBH", "TS26", "IC27"];
const REFERENCE = ["SOR", "SHD", "SEC", "LAW", "ASH"];
const ALL = [...REFERENCE, ...RAISED];
// One fixture card per set the fixtures carry.
const CARD: Record<string, string> = {
  SOR: "sor-10",
  SEC: "sec-1",
  LAW: "law-1",
  ASH: "ash-5",
  JTL: "jtl-1",
  IBH: "ibh-1",
  TS26: "ts26-1",
};
// Layout boxes pinned to main's CSS (transforms do not change them):
// cards.css .inv-summary__popover-logo height 34 (LAW 28), CardPopup.css
// .cp-header__setlogo height 34.
const LOGO_H = 34;
const LAW_POPOVER_LOGO_H = 28;

const shotDir = process.env.R25_SHOTS;
const tag = process.env.R25_TAG ?? "after";
// "before" = screenshots of the shipped sizes only (no scale checks).
const before = tag === "before";
const ready = (page: Page) => page.evaluate(() => document.fonts.ready);

async function scaleOf(page: Page, sel: string): Promise<number> {
  return page.locator(sel).evaluate((e) => {
    const t = getComputedStyle(e).transform;
    if (!t || t === "none") return 1;
    return Number(t.match(/matrix\(([^,]+)/)?.[1] ?? 1);
  });
}

async function openHeader(page: Page, card: string) {
  await page.goto(`/?card=${card}`);
  const logo = page.locator(".cp-header__setlogo");
  await expect(logo).toBeVisible();
  await page.waitForFunction(
    () => (document.querySelector(".cp-header__setlogo") as HTMLImageElement).complete
  );
  await ready(page);
  return logo;
}

test("r2-05-popover-logos", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("inv-summary-block-cards").click();
  const pop = page.locator(".inv-summary__popover");
  await expect(pop).toBeVisible();
  await ready(page);
  if (shotDir) await pop.screenshot({ path: `${shotDir}/r2-05-${tag}-popover.png` });
  if (before) return;
  const logos = pop.locator(".inv-summary__popover-logo");
  const codes = await logos.evaluateAll((els) => els.map((e) => e.getAttribute("data-set")));
  // Every row's logo carries its set code; the fixtures list every base set,
  // so each raised set is there and scaled, each reference set is not.
  expect(codes.length).toBeGreaterThan(0);
  expect(codes.every((c) => !!c)).toBe(true);
  for (const code of RAISED) {
    expect(codes, code).toContain(code);
    const k = await scaleOf(page, `.inv-summary__popover-logo[data-set="${code}"]`);
    expect(k, code).toBeGreaterThan(1);
  }
  for (const code of REFERENCE) {
    expect(codes, code).toContain(code);
    expect(await scaleOf(page, `.inv-summary__popover-logo[data-set="${code}"]`), code).toBe(1);
  }
  // Layout boxes stay main's: the logo's own box (offsetHeight ignores the
  // transform) and every row at one height.
  const boxes = await logos.evaluateAll((els) =>
    els.map((e) => [e.getAttribute("data-set"), (e as HTMLElement).offsetHeight] as const)
  );
  for (const [code, h] of boxes)
    expect(h, code ?? "").toBe(code === "LAW" ? LAW_POPOVER_LOGO_H : LOGO_H);
  // And every row's layout height is what it is with the scale switched off
  // (main's geometry): the scale is paint only.
  const rowHeights = () =>
    pop
      .locator(".inv-summary__popover-row")
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight));
  const scaled = await rowHeights();
  await page.addStyleTag({ content: ".inv-summary__popover-logo { transform: none !important; }" });
  expect(await rowHeights()).toEqual(scaled);
});

// Production selection: the header picks the logo from the card's set; a
// raised set (JTL) and a reference set (SOR) through the real path, with the
// header's layout height unchanged between them.
test("r2-05-card-header-logo-production", async ({ page }) => {
  const heights: number[] = [];
  for (const code of ["JTL", "SOR"]) {
    const logo = await openHeader(page, CARD[code]);
    await expect(logo).toHaveAttribute("data-set", code);
    const k = await scaleOf(page, ".cp-header__setlogo");
    if (code === "JTL") expect(k).toBeGreaterThan(1);
    else expect(k).toBe(1);
    expect(await logo.evaluate((e) => (e as HTMLElement).offsetHeight)).toBe(LOGO_H);
    heights.push(await page.locator(".cp-header").evaluate((e) => (e as HTMLElement).offsetHeight));
  }
  expect(heights[0]).toBe(heights[1]);
});

// CSS matching for every set: the fixtures carry cards from only seven sets,
// so for the rest the header logo is pointed at that set's PNG and data-set
// by hand -- this checks the per-set rules (and saves the review shots), not
// the production selection (the test above covers that).
test("r2-05-card-header-logo-css-per-set", async ({ page }) => {
  test.setTimeout(90_000);
  for (const code of ALL) {
    const logo = await openHeader(page, CARD[code] ?? "ash-5");
    if (!CARD[code]) {
      await logo.evaluate((e, c) => {
        e.setAttribute("src", `/images/set_${c}.png`);
        e.setAttribute("data-set", c);
      }, code);
      await page.waitForFunction(
        () => (document.querySelector(".cp-header__setlogo") as HTMLImageElement).complete
      );
    }
    if (!before) {
      await expect(logo).toHaveAttribute("data-set", code);
      const k = await scaleOf(page, ".cp-header__setlogo");
      if (RAISED.includes(code)) expect(k, code).toBeGreaterThan(1);
      else expect(k, code).toBe(1);
    }
    if (shotDir)
      await page
        .locator(".cp-header")
        .screenshot({ path: `${shotDir}/r2-05-${tag}-header-${code}.png` });
  }
});
