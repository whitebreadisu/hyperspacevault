import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-16: the finish scope chip + menu sheet (rev4 b2-scope-chip-renders,
// b2-menu-options, b2-trigger-copy-amber, b2-targets-44).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone scope");
});

const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
  variants: { finish: string | null; variant_type: string }[];
}[];
const withFinish = (f: string) =>
  CARDS.filter((c) => c.variants.some((v) => (v.finish ?? v.variant_type) === f)).length;

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

test("s1-16-scope-chip-renders", async ({ page }) => {
  await openVault(page);
  const r = await page.evaluate(() => {
    const c = document.querySelector(".m-vault__status .m-scopechip")!;
    const be = getComputedStyle(c, "::before");
    return {
      text: c.querySelector(".m-scopechip__t")!.textContent,
      upper: getComputedStyle(c).textTransform,
      on: c.classList.contains("m-scopechip--on"),
      glyph: !!c.querySelector(".m-pipsglyph"),
      line: be.borderTopColor,
      color: getComputedStyle(c).color,
      h: c.getBoundingClientRect().height,
    };
  });
  expect(r).toEqual({
    text: "All finishes",
    upper: "uppercase",
    on: false,
    glyph: false,
    line: "rgb(30, 39, 72)",
    color: "rgb(207, 214, 228)",
    h: 44,
  });
});

test("s1-16-menu-options", async ({ page }) => {
  await openVault(page, "#/vault?sheet=scope");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const m = document.querySelector(".m-sheet-layer--scope .m-scopemenu")!;
    const rows = [...m.querySelectorAll(".m-ffin[data-row]")].map(
      (row) =>
        (row as HTMLElement).dataset.row +
        ":" +
        [...row.querySelectorAll(".m-ffin__chip")].map((c) => c.textContent).join("/")
    );
    return {
      rows: rows.join("|"),
      allInert: (m.querySelector(".m-scopemenu__all") as HTMLButtonElement).disabled,
      showcase: m.querySelectorAll('[data-scope="Showcase"]').length,
    };
  });
  // REPLACE (BL-259 FR4-03, owner decision 2026-10-12): this test pinned four
  // pinned rows, "no Showcase" and 13 values; Showcase is back as the last
  // pinned row (one chip), so it pins five rows, one Showcase and 14 values.
  expect(r.rows).toBe(
    "Standard:Non-foil/Foil|Hyperspace:Non-foil/Foil|Prestige:Std/Foil/Serialized|Weekly Play:Non-foil/Foil|Showcase:Showcase"
  );
  expect(r.allInert).toBe(true);
  expect(r.showcase).toBe(1);
  await page.locator(".m-scopemenu__more").click();
  const all = await page.evaluate(() =>
    [...document.querySelectorAll(".m-sheet-layer--scope [data-scope]")].map(
      (e) => (e as HTMLElement).dataset.scope
    )
  );
  expect(all).toHaveLength(14);
  expect(all.slice(-4)).toEqual([
    "Convention Exclusive",
    "Event Exclusive",
    "Prerelease Promo",
    "Movie Promo",
  ]);
  // BL-259 fix run (owner decision 2026-10-12: whole scope picker
  // single-select chips): every value is a chip; no check-box row in the sheet.
  const kinds = await page.evaluate(() => {
    const layer = document.querySelector(".m-sheet-layer--scope")!;
    return {
      chips: layer.querySelectorAll("button.m-chip[data-scope]").length,
      checks: layer.querySelectorAll(".m-check, .m-check__box").length,
    };
  });
  expect(kinds).toEqual({ chips: 14, checks: 0 });
});

test("s1-16-trigger-copy-amber", async ({ page }) => {
  await openVault(page);
  await page.locator(".m-scopechip").click();
  await page.waitForTimeout(300);
  await page.locator('.m-sheet-layer--scope [data-scope="Hyperspace Foil"]').click();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const c = document.querySelector(".m-scopechip")!;
    const be = getComputedStyle(c, "::before");
    const clear = document.querySelector(".m-clearbtn");
    return {
      sheet: !!document.querySelector(".m-sheet-layer"),
      on: c.classList.contains("m-scopechip--on"),
      text: c.querySelector(".m-scopechip__t")!.textContent,
      glyph: !!c.querySelector(".m-pipsglyph"),
      color: getComputedStyle(c).color,
      line: be.borderTopColor,
      wash: be.backgroundColor,
      h: c.getBoundingClientRect().height,
      clear: clear ? getComputedStyle(clear).color : null,
      count: document.querySelector(".m-count")!.textContent!.trim(),
      badge: document.querySelector(".m-filterbtn__n")?.textContent,
    };
  });
  expect(r).toEqual({
    sheet: false,
    on: true,
    text: "HS Foil",
    glyph: true,
    color: "rgb(242, 193, 78)",
    line: "rgba(217, 154, 31, 0.4)",
    wash: "rgba(217, 154, 31, 0.16)",
    h: 44,
    clear: "rgb(242, 193, 78)",
    count: `${withFinish("Hyperspace Foil")} cards`,
    badge: "1",
  });
  // All finishes clears the scope and the facet value it wrote.
  await page.locator(".m-scopechip").click();
  await page.waitForTimeout(300);
  await page.locator(".m-scopemenu__all").click();
  await page.waitForTimeout(400);
  expect(await page.locator(".m-scopechip__t").textContent()).toBe("All finishes");
  expect(await page.locator(".m-clearbtn").count()).toBe(0);
  expect(await page.locator(".m-count").textContent()).toBe(`${CARDS.length} cards`);
});

test("s1-16-targets-44", async ({ page }) => {
  // The expanded tail opens itself when the scope is an expanded-only value.
  await openVault(page, "#/vault?finish=Prerelease%20Promo&sheet=scope");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const layer = document.querySelector(".m-sheet-layer--scope")!;
    const small = [...layer.querySelectorAll("button")]
      .map((b) => b.getBoundingClientRect())
      .filter((b) => b.width < 43.5 || b.height < 43.5).length;
    // REPLACE (BL-259 fix run, owner decision 2026-10-12: whole scope picker
    // single-select chips): `tail` counted the four `.m-ffin--plain` check-box
    // rows; the tail is now four one-chip rows after the expander. Still 4,
    // still opened by an expanded-only scope, every target still >= 44 px.
    return {
      small,
      tail: layer.querySelectorAll(".m-scopemenu__more ~ .m-ffin--single button.m-chip").length,
      plain: layer.querySelectorAll(".m-ffin--plain, .m-check").length,
      on: layer.querySelector('[data-scope="Prerelease Promo"]')!.getAttribute("aria-pressed"),
      overflow: document.documentElement.scrollWidth > innerWidth,
      sub: layer.querySelector(".m-sheet__sub")?.textContent,
    };
  });
  expect(r).toEqual({
    small: 0,
    tail: 4,
    plain: 0,
    on: "true",
    overflow: false,
    sub: "Scoped · Prerelease Promo",
  });
});

test("s1-16-param-sheet-scope", async ({ page }) => {
  await openVault(page, "#/vault?sheet=scope");
  await page.waitForTimeout(300);
  expect(await page.locator(".m-sheet-layer--scope .m-sheet__title").textContent()).toBe(
    "Finish scope"
  );
  // A fresh open is unscoped (never persisted): reload drops the pick.
  await page.locator('.m-sheet-layer--scope [data-scope="Hyperspace"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator(".m-scopechip__t").textContent()).toBe("Hyperspace");
  await page.goto("/#/vault");
  await page.reload();
  await expect(page.locator(".m-row").first()).toBeVisible();
  expect(await page.locator(".m-scopechip__t").textContent()).toBe("All finishes");
});
