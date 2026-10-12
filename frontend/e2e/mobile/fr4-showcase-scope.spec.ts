import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import type { Page } from "@playwright/test";

// FR4 (BL-259, owner decision 2026-10-12): Showcase is back in the finish
// scope picker as the last pinned row, drawn with one chip (the picker's
// single-select idiom), never a check-box row. Ports s1-16-scope patterns.
// The finish_scope_changed event is asserted in vitest (the harness runs
// with analytics off): filters/filterAnalytics.test.tsx "fr4-03".

interface FxVariant {
  variant_id: number;
  finish: string | null;
  variant_type: string;
  source_set_code: string;
  card_number: string;
}
const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
  id: number;
  set_code: string;
  base_card_number: string;
  type: string;
  variants: FxVariant[];
}[];
const withFinish = (f: string) =>
  CARDS.filter((c) => c.variants.some((v) => (v.finish ?? v.variant_type) === f)).length;

/** The four extra finishes behind "Show all finishes…": raw value -> the
 * text on its one chip (the chip repeats the row's label, as Showcase's). */
const EXTRA_CHIP: Record<string, string> = {
  "Convention Exclusive": "Convention Exclusive",
  "Event Exclusive": "Event Exclusive",
  "Prerelease Promo": "Prerelease Promo",
  "Movie Promo": "Movie Promo",
};
/** Desktop's short names, as the status-row chip and the Finish facet show them. */
const SHORT: Record<string, string> = {
  "Convention Exclusive": "Conv. Excl.",
  "Event Exclusive": "Event Excl.",
  "Prerelease Promo": "Prerelease",
  "Movie Promo": "Movie Promo",
};

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
        // (Sizes compared to 0.5 px: a rect at a fractional offset can report
        // 44.00003 or 43.99997 for the same box -- PR #226 CI fix run.)
        w: b.width >= 43.5,
        h: Math.round(b.height),
        // Same chip drawing as the pair rows above it: height, right edge, colours.
        sameH: Math.abs(b.height - pair.height) < 0.5,
        sameRight: Math.abs(b.right - pair.right) < 0.5,
        border: cs.borderTopColor,
        bg: cs.backgroundColor,
        visible: b.bottom <= innerHeight + 0.5,
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

  // REPLACE (BL-259 fix run, owner decision 2026-10-12: whole scope picker
  // single-select chips): was "the expanded tail keeps its four check-box
  // rows". The four extra finishes are now the same one-chip row as Showcase;
  // their order, raw values and the expander are unchanged.
  test("fr4-03 the expanded tail is four one-chip rows; no check-box row in the sheet", async ({
    page,
  }) => {
    await openVault(page, "#/vault?sheet=scope");
    await page.waitForTimeout(300);
    await page.locator(".m-scopemenu__more").click();
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const layer = document.querySelector(".m-sheet-layer--scope")!;
      const tree = layer.querySelector(".m-ftree")!;
      const kids = [...tree.children] as HTMLElement[];
      const more = kids.findIndex((k) => k.classList.contains("m-scopemenu__more"));
      const show = tree.querySelector('[data-row="Showcase"]') as HTMLElement;
      const showChip = show.querySelector("button")!.getBoundingClientRect();
      const showH = show.getBoundingClientRect().height;
      const body = tree.getBoundingClientRect();
      return {
        checks: layer.querySelectorAll(".m-check, .m-check__box, .m-ffin--plain").length,
        expander: kids[more].getAttribute("aria-expanded"),
        expanderText: kids[more].textContent,
        tail: kids.slice(more + 1).map((row) => {
          const label = row.querySelector(".m-ffin__label") as HTMLElement;
          const chips = [...row.querySelectorAll("button")];
          const b = chips[0].getBoundingClientRect();
          const lb = label.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(label);
          return {
            row: row.dataset.row,
            cls: row.className,
            label: label.textContent,
            chips: chips.length,
            chipClass: chips[0].className,
            chip: chips[0].textContent,
            scope: chips[0].dataset.scope,
            aria: chips[0].getAttribute("aria-label"),
            pressed: chips[0].getAttribute("aria-pressed"),
            h: Math.round(b.height),
            w44: b.width >= 43.5,
            // Same drawing as the Showcase row: row height, chip right edge;
            // the label sits on one line and clears the chip; nothing spills.
            sameRowH: Math.abs(row.getBoundingClientRect().height - showH) < 0.5,
            sameRight: Math.abs(b.right - showChip.right) < 0.5,
            oneLine: range.getClientRects().length === 1,
            clear: range.getBoundingClientRect().right <= b.left,
            inside: lb.left >= body.left - 0.5 && b.right <= body.right + 0.5,
          };
        }),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const tailRow = (row: string, chip: string) => ({
      row,
      cls: "m-ffin m-ffin--pair m-ffin--single",
      label: row,
      chips: 1,
      chipClass: "m-chip m-ffin__chip",
      chip,
      scope: row,
      aria: row,
      pressed: "false",
      h: 44,
      w44: true,
      sameRowH: true,
      sameRight: true,
      oneLine: true,
      clear: true,
      inside: true,
    });
    expect(r).toEqual({
      checks: 0,
      expander: "true",
      expanderText: "Hide extra finishes",
      tail: [
        tailRow("Convention Exclusive", EXTRA_CHIP["Convention Exclusive"]),
        tailRow("Event Exclusive", EXTRA_CHIP["Event Exclusive"]),
        tailRow("Prerelease Promo", EXTRA_CHIP["Prerelease Promo"]),
        tailRow("Movie Promo", EXTRA_CHIP["Movie Promo"]),
      ],
      overflow: false,
    });
    await shot(page, "fix-phone-sheet-expanded");
  });

  for (const raw of Object.keys(EXTRA_CHIP)) {
    test(`fr4-03 picking ${raw} by its chip scopes the Vault`, async ({ page }) => {
      await openVault(page);
      await page.locator(".m-scopechip").click();
      await page.waitForTimeout(300);
      await page.locator(".m-scopemenu__more").click();
      await page.locator(`.m-sheet-layer--scope button.m-chip[data-scope="${raw}"]`).click();
      await page.waitForTimeout(400);
      // A scope with no card in the fixture leaves the list empty (no .m-row).
      const n = withFinish(raw);
      const r = await page.evaluate(() => {
        const c = document.querySelector(".m-scopechip")!;
        return {
          sheet: !!document.querySelector(".m-sheet-layer"),
          on: c.classList.contains("m-scopechip--on"),
          text: c.querySelector(".m-scopechip__t")!.textContent,
          color: getComputedStyle(c).color,
          rows: document.querySelectorAll(".m-row[data-card]").length,
          badge: document.querySelector(".m-filterbtn__n")?.textContent,
        };
      });
      expect(r).toEqual({
        sheet: false,
        on: true,
        text: SHORT[raw],
        color: "rgb(242, 193, 78)",
        rows: n,
        badge: "1",
      });
      // The Finish facet holds exactly the unchanged raw value.
      await page.locator(".m-filterbtn").click();
      const facet = page.locator('.m-sheet-layer--filters [data-facet="finish"] .m-fsel');
      await expect(facet).toHaveCount(1);
      await expect(facet).toHaveText(SHORT[raw]);
      await expect(facet).toHaveClass(/m-fsel--scoped/);
      await page.locator(".m-sheet-layer--filters .m-sheet__close").click();
      await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
      // Reopened: the tail opens itself (a selected value is never hidden),
      // that chip alone reads selected, the sub-title carries the raw value.
      await page.locator(".m-scopechip").click();
      await page.waitForTimeout(300);
      const s = await page.evaluate((raw) => {
        const layer = document.querySelector(".m-sheet-layer--scope")!;
        const chip = layer.querySelector(`[data-scope="${raw}"]`);
        return {
          open: layer.querySelector(".m-scopemenu__more")!.getAttribute("aria-expanded"),
          sub: layer.querySelector(".m-sheet__sub")?.textContent,
          pressed: chip?.getAttribute("aria-pressed"),
          on: chip?.classList.contains("m-chip--on"),
          selected: layer.querySelectorAll('[aria-pressed="true"]').length,
        };
      }, raw);
      expect(s).toEqual({
        open: "true",
        sub: "Scoped · " + raw,
        pressed: "true",
        on: true,
        selected: 1,
      });
      if (raw === "Prerelease Promo") await shot(page, "fix-phone-sheet-prerelease");
    });
  }

  // N6 (review): the ?finish= deep link scopes to Showcase like any value.
  test("fr4-03 the ?finish=Showcase deep link scopes the Vault", async ({ page }) => {
    await openVault(page, "#/vault?finish=Showcase");
    const r = await page.evaluate(() => {
      const c = document.querySelector(".m-scopechip")!;
      return {
        on: c.classList.contains("m-scopechip--on"),
        text: c.querySelector(".m-scopechip__t")!.textContent,
        count: document.querySelector(".m-count")!.textContent!.trim(),
        badge: document.querySelector(".m-filterbtn__n")?.textContent,
      };
    });
    expect(r).toEqual({
      on: true,
      text: "Showcase",
      count: `${withFinish("Showcase")} cards`,
      badge: "1",
    });
    await page.locator(".m-scopechip").click();
    await expect(
      page.locator('.m-sheet-layer--scope [data-scope="Showcase"][aria-pressed="true"]')
    ).toHaveCount(1);
  });

  // N7 (review): a Showcase leader's row reads scoped against playset 1 --
  // measured, not screenshot-only. The fixture owns no Showcase printing, so
  // this test serves the fixture quantities plus one Showcase copy of ASH 5.
  test("fr4-03 a Showcase leader's pips and count read scoped (playset 1)", async ({ page }) => {
    const fin = (v: FxVariant) => v.finish ?? v.variant_type;
    const byNum = (set: string, n: string) =>
      CARDS.find((c) => c.set_code === set && c.base_card_number === n)!;
    const luke = byNum("ASH", "5");
    const mando = byNum("ASH", "14");
    const sc = luke.variants.find((v) => fin(v) === "Showcase")!;
    expect(luke.type).toBe("Leader");
    expect(mando.type).toBe("Leader");
    const base = JSON.parse(readFileSync("e2e/mobile/fixtures/quantities.json", "utf8")) as {
      variant_id: number;
      quantity: number;
    }[];
    const ownedBase = (c: (typeof CARDS)[number]) =>
      c.variants.reduce(
        (s, v) => s + (base.find((q) => q.variant_id === v.variant_id)?.quantity ?? 0),
        0
      );
    expect(base.find((q) => q.variant_id === sc.variant_id)?.quantity ?? 0).toBe(0);
    expect(ownedBase(luke)).toBe(1);
    expect(ownedBase(mando)).toBe(0);
    await page.route(
      (u) => u.pathname === "/api/inventory/quantities",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            ...base.filter((q) => q.variant_id !== sc.variant_id),
            { variant_id: sc.variant_id, quantity: 1 },
          ]),
        })
    );
    await openVault(page, "#/vault?finish=Showcase");
    const read = (id: number) =>
      page.evaluate((id) => {
        const el = document.querySelector(`.m-row[data-card="${id}"]`)!;
        const box = el.querySelector(".playset__pips")!;
        const bs = getComputedStyle(box);
        return {
          chip: el.querySelector(".playset-chip")!.textContent,
          pips: [...el.querySelectorAll(".playset__pip")].map(
            (p) => getComputedStyle(p).backgroundColor
          ),
          plate: { border: bs.borderTopColor, bg: bs.backgroundColor },
          num: el.querySelector(".m-row__num")!.textContent,
          scoped: !!el.querySelector(".m-row__own--scoped"),
        };
      }, id);
    await page.locator(`.m-row[data-card="${luke.id}"]`).scrollIntoViewIfNeeded();
    // Owned leader: ONE pip (playset 1), filled green inside the amber plate
    // (scoped-complete); the chip is the all-printings count (1 Standard + 1
    // Showcase); the number is the Showcase printing's.
    expect(await read(luke.id)).toEqual({
      chip: "2",
      pips: ["rgb(23, 138, 58)"],
      plate: { border: "rgba(217, 154, 31, 0.6)", bg: "rgba(217, 154, 31, 0.08)" },
      num: `${sc.source_set_code} ${sc.card_number}`,
      scoped: true,
    });
    // Unowned Showcase leader: one empty pip, no amber plate.
    await page.locator(`.m-row[data-card="${mando.id}"]`).scrollIntoViewIfNeeded();
    const m = await read(mando.id);
    expect(m.chip).toBe("0");
    expect(m.pips).toEqual(["rgba(0, 0, 0, 0)"]);
    expect(m.plate.border).not.toBe("rgba(217, 154, 31, 0.6)");
    expect(m.scoped).toBe(true);
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
        sameH: Math.abs(c.height - wp.height) < 0.5,
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

  // BL-259 fix run (owner decision 2026-10-12: whole scope picker
  // single-select chips): the four extra finishes are one-chip rows too.
  test("fr4-02 the extra finishes are chip rows; no check-box in the menu; one scopes the table", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("tbody tr").nth(5)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const trigger = page.locator(".vs-header-scope__trigger");
    await trigger.click();
    await page.locator(".vs-scope-menu__expander").click();
    const r = await page.evaluate(() => {
      const menu = document.querySelector(".vs-scope-menu")!;
      const items = menu.querySelector(".vs-scope-menu__items")!;
      const show = menu.querySelector('[data-scope="Showcase"]')!.getBoundingClientRect();
      return {
        checks: menu.querySelectorAll(".ifp-multi__check, .ifp-multi__item, [role=option]").length,
        scopes: menu.querySelectorAll("button.ifp-finish-pair__chip[data-scope]").length,
        tail: [...menu.querySelectorAll(".vs-scope-menu__expander ~ [data-row]")].map((row) => {
          const label = row.querySelector(".vs-scope-menu__row-label") as HTMLElement;
          const chip = row.querySelector("button")!;
          const b = chip.getBoundingClientRect();
          return {
            row: (row as HTMLElement).dataset.row,
            chip: chip.textContent,
            // The label is not ellipsised; the chip is the Showcase chip's size and edge.
            full: label.scrollWidth <= label.clientWidth,
            sameH: Math.abs(b.height - show.height) < 0.5,
            sameRight: Math.abs(b.right - show.right) < 0.5,
          };
        }),
        // Expanded, the list is taller than the menu's shared 320 px cap and
        // scrolls inside it (as it did with the old rows); never sideways.
        scrollsY: items.scrollHeight > items.clientHeight,
        overflowX: items.scrollWidth > items.clientWidth,
      };
    });
    const tailRow = (row: string) => ({
      row,
      chip: EXTRA_CHIP[row],
      full: true,
      sameH: true,
      sameRight: true,
    });
    expect(r).toEqual({
      checks: 0,
      scopes: 14,
      tail: Object.keys(EXTRA_CHIP).map(tailRow),
      scrollsY: true,
      overflowX: false,
    });
    // The last row is reachable: scrolled into view it sits inside the list.
    const last = page.locator('.vs-scope-menu button[data-scope="Movie Promo"]');
    await last.scrollIntoViewIfNeeded();
    const reach = await page.evaluate(() => {
      const items = document.querySelector(".vs-scope-menu__items")!.getBoundingClientRect();
      const b = document
        .querySelector('.vs-scope-menu button[data-scope="Movie Promo"]')!
        .getBoundingClientRect();
      return b.top >= items.top - 0.5 && b.bottom <= items.bottom + 0.5;
    });
    expect(reach).toBe(true);
    await shot(page, "fix-desktop-menu-expanded");
    // Keyboard pick of an extra finish (a native button).
    const chip = page.locator('.vs-scope-menu button[data-scope="Prerelease Promo"]');
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".vs-scope-menu")).toHaveCount(0);
    await expect(trigger).toHaveText(/PIPS · Prerelease/);
    await expect(trigger).toHaveClass(/vs-header-scope__trigger--on/);
    await expect(page.locator("tbody tr")).toHaveCount(withFinish("Prerelease Promo"));
    await trigger.click();
    await page.locator(".vs-scope-menu__expander").click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('.vs-scope-menu [aria-pressed="true"]')).toHaveCount(1);
    await chip.scrollIntoViewIfNeeded();
    await shot(page, "fix-desktop-menu-prerelease");
  });
});
