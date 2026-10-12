import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import type { Page } from "@playwright/test";

// FR4 (BL-259, owner decision 2026-10-12): Showcase is back in the finish
// scope picker as the last pinned row, drawn with one chip (the picker's
// single-select idiom), never a check-box row. Ports s1-16-scope patterns.
// The finish_scope_changed event is asserted in vitest (the harness runs
// with analytics off): filters/filterAnalytics.test.tsx "fr4-03".

const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
  variants: { finish: string | null; variant_type: string }[];
}[];
const withFinish = (f: string) =>
  CARDS.filter((c) => c.variants.some((v) => (v.finish ?? v.variant_type) === f)).length;

/** Review screenshots, only when FR4_SHOTS names a directory. */
const shot = async (page: Page, name: string) => {
  const dir = process.env.FR4_SHOTS;
  if (dir && test.info().project.name !== "phone-430")
    await page.screenshot({ path: `${dir}/${name}.png` });
};

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

test.describe("FR4-03 Showcase on the phone Finish scope sheet", () => {
  test.afterEach(measureEach);
  test.beforeEach(() => {
    test.skip(!test.info().project.name.startsWith("phone"), "phone scope");
  });

  test("fr4-03 Showcase is the last pinned control, one chip, not a check-box row", async ({
    page,
  }) => {
    await openVault(page, "#/vault?sheet=scope");
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const tree = document.querySelector(".m-sheet-layer--scope .m-ftree")!;
      const kids = [...tree.children] as HTMLElement[];
      const divider = kids.findIndex((k) => k.classList.contains("m-fdivider"));
      const row = kids[divider - 1];
      const chips = [...row.querySelectorAll("button")];
      const chip = chips[0];
      const b = chip.getBoundingClientRect();
      const pair = (
        tree.querySelector('[data-scope="Weekly Play Foil"]') as HTMLElement
      ).getBoundingClientRect();
      const cs = getComputedStyle(chip);
      return {
        pinned: kids.slice(0, divider).map((k) => k.dataset.row),
        next: kids[divider + 1].className.includes("m-scopemenu__more"),
        expanded: kids[divider + 1].getAttribute("aria-expanded"),
        rowClass: row.className,
        label: row.querySelector(".m-ffin__label")!.textContent,
        chips: chips.length,
        chipClass: chip.className,
        chipText: chip.textContent,
        scope: chip.dataset.scope,
        pressed: chip.getAttribute("aria-pressed"),
        checkRow: !!row.closest(".m-check") || !!row.querySelector(".m-check, .m-check__box"),
        w: b.width >= 44,
        h: b.height,
        // Same chip drawing as the pair rows above it: height, right edge, colours.
        sameH: b.height === pair.height,
        sameRight: Math.abs(b.right - pair.right) < 0.5,
        border: cs.borderTopColor,
        bg: cs.backgroundColor,
        visible: b.bottom <= innerHeight,
      };
    });
    expect(r).toEqual({
      pinned: ["Standard", "Hyperspace", "Prestige", "Weekly Play", "Showcase"],
      next: true,
      expanded: "false",
      rowClass: "m-ffin m-ffin--pair m-ffin--single",
      label: "Showcase",
      chips: 1,
      chipClass: "m-chip m-ffin__chip",
      chipText: "Showcase",
      scope: "Showcase",
      pressed: "false",
      checkRow: false,
      w: true,
      h: 44,
      sameH: true,
      sameRight: true,
      border: "rgb(30, 39, 72)",
      bg: "rgb(15, 21, 40)",
      visible: true,
    });
    await shot(page, "phone-sheet-unscoped");
  });

  test("fr4-03 picking Showcase closes the sheet and scopes the Vault", async ({ page }) => {
    await openVault(page);
    await page.locator(".m-scopechip").click();
    await page.waitForTimeout(300);
    await page.locator('.m-sheet-layer--scope [data-scope="Showcase"]').click();
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const c = document.querySelector(".m-scopechip")!;
      const be = getComputedStyle(c, "::before");
      return {
        sheet: !!document.querySelector(".m-sheet-layer"),
        on: c.classList.contains("m-scopechip--on"),
        text: c.querySelector(".m-scopechip__t")!.textContent,
        glyph: !!c.querySelector(".m-pipsglyph"),
        color: getComputedStyle(c).color,
        line: be.borderTopColor,
        wash: be.backgroundColor,
        count: document.querySelector(".m-count")!.textContent!.trim(),
        badge: document.querySelector(".m-filterbtn__n")?.textContent,
      };
    });
    expect(withFinish("Showcase")).toBeGreaterThan(0);
    expect(r).toEqual({
      sheet: false,
      on: true,
      text: "Showcase",
      glyph: true,
      color: "rgb(242, 193, 78)",
      line: "rgba(217, 154, 31, 0.4)",
      wash: "rgba(217, 154, 31, 0.16)",
      count: `${withFinish("Showcase")} cards`,
      badge: "1",
    });
    // The Finish facet holds exactly Showcase (the scope wrote it), amber.
    await page.locator(".m-filterbtn").click();
    const facet = page.locator('.m-sheet-layer--filters [data-facet="finish"] .m-fsel');
    await expect(facet).toHaveCount(1);
    await expect(facet).toHaveText("Showcase");
    await expect(facet).toHaveClass(/m-fsel--scoped/);
    await page.locator(".m-sheet-layer--filters .m-sheet__close").click();
    await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
    // Reopened: the chip reads selected, the sub-title names the scope, and
    // nothing else is selected (single-select).
    await page.locator(".m-scopechip").click();
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const layer = document.querySelector(".m-sheet-layer--scope")!;
      const chip = layer.querySelector('[data-scope="Showcase"]')!;
      return {
        sub: layer.querySelector(".m-sheet__sub")?.textContent,
        pressed: chip.getAttribute("aria-pressed"),
        on: chip.classList.contains("m-chip--on"),
        selected: layer.querySelectorAll('[aria-pressed="true"]').length,
        allLive: !(layer.querySelector(".m-scopemenu__all") as HTMLButtonElement).disabled,
      };
    });
    expect(s).toEqual({
      sub: "Scoped · Showcase",
      pressed: "true",
      on: true,
      selected: 1,
      allLive: true,
    });
    await shot(page, "phone-sheet-showcase");
    await page.locator(".m-sheet-layer--scope .m-sheet__close").click();
    await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
    await shot(page, "phone-vault-showcase");
  });

  test("fr4-03 the expanded tail keeps its four check-box rows", async ({ page }) => {
    await openVault(page, "#/vault?sheet=scope");
    await page.waitForTimeout(300);
    await page.locator(".m-scopemenu__more").click();
    const tail = await page.evaluate(() =>
      [...document.querySelectorAll(".m-sheet-layer--scope .m-check.m-ffin--plain")].map(
        (e) => (e as HTMLElement).dataset.scope
      )
    );
    expect(tail).toEqual([
      "Convention Exclusive",
      "Event Exclusive",
      "Prerelease Promo",
      "Movie Promo",
    ]);
  });
});

test.describe("FR4-02 Showcase in the desktop scope menu (real app)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop-1440", "desktop scope menu");
  });
  test.use({ storageState: "e2e/.auth/phone.json" });
  test.afterEach(async ({ page }) => {
    const rec = recorderFor(page);
    expect(rec.pageErrors, "pageerror").toEqual([]);
    expect(rec.consoleErrors, "console errors").toEqual([]);
    expect(rec.failed, "failed requests").toEqual([]);
  });

  test("fr4-02 the Showcase chip scopes the table; keyboard picks it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("tbody tr").nth(5)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const trigger = page.locator(".vs-header-scope__trigger");
    await trigger.click();
    const chip = page.locator('.vs-scope-menu [data-scope="Showcase"]');
    await expect(chip).toBeVisible();
    const r = await page.evaluate(() => {
      const items = document.querySelector(".vs-scope-menu__items")!;
      const kids = [...items.children] as HTMLElement[];
      const divider = kids.findIndex((k) => k.classList.contains("ifp-multi__pin-divider"));
      const row = kids[divider - 1];
      const c = row.querySelector("button")!.getBoundingClientRect();
      const wp = document
        .querySelector('.vs-scope-menu [data-scope="Weekly Play Foil"]')!
        .getBoundingClientRect();
      return {
        last: row.dataset.row,
        check: !!row.querySelector(".ifp-multi__check"),
        sameH: c.height === wp.height,
        sameRight: Math.abs(c.right - wp.right) < 0.5,
      };
    });
    expect(r).toEqual({ last: "Showcase", check: false, sameH: true, sameRight: true });
    await shot(page, "desktop-menu-unscoped");
    // Keyboard: focus the chip, Enter picks it (a native button).
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".vs-scope-menu")).toHaveCount(0);
    await expect(trigger).toHaveText(/PIPS · Showcase/);
    await expect(trigger).toHaveClass(/vs-header-scope__trigger--on/);
    await trigger.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toHaveClass(/ifp-finish-pair__chip--on/);
    await expect(page.locator('.vs-scope-menu [aria-pressed="true"]')).toHaveCount(1);
    await shot(page, "desktop-menu-showcase");
  });
});
