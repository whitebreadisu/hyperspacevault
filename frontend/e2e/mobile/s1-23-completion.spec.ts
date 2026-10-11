import { computePanelMetrics } from "../../src/utils/completion";
import { applyFilters, DEFAULT_FILTERS } from "../../src/utils/filters";
import type { FilterState } from "../../src/utils/filters";
import type { BaseCard } from "../../src/utils/catalog";
import type { InventoryCard } from "../../src/utils/inventory";
import { BASE_SET_CODES, inventoryCards, whole } from "./fixture-cards";
import { expect, measureEach, scrollBy, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-23: the completion header (rev4 b2-header-desktop-math,
// vault-segments-short, vault-scope-toggle, vault-set-all,
// vault-set-collapsed-amber). Numbers are desktop computePanelMetrics over
// the fixture as the app merges it.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone header");
});

const ALL = inventoryCards();
const narrow = (patch: Partial<FilterState>) =>
  applyFilters(ALL as BaseCard[], { ...DEFAULT_FILTERS, ...patch }) as InventoryCard[];

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

const shown = (p: Page) =>
  p.evaluate(() => {
    const t = (s: string) => document.querySelector(s)?.textContent?.trim() ?? null;
    const vals = [...document.querySelectorAll(".m-summary .m-metric__value")].map((e) =>
      e.textContent!.trim()
    );
    return {
      vals,
      filledTicks: document.querySelectorAll(".m-summary .inv-summary__tick--filled").length,
      strip: { pct: t(".m-vh__pct"), n: t(".m-vh__n"), value: t(".m-vh__value") },
      amber: !!document.querySelector(".m-summary--amber"),
      ring: getComputedStyle(document.querySelector(".m-summary")!).backgroundColor,
      toggle: !!document.querySelector(".m-scope"),
      label: t(".m-summary__label"),
    };
  });

function expected(cards: InventoryCard[], mode: "market" | "low" = "market") {
  const m = computePanelMetrics(cards, BASE_SET_CODES, mode);
  return {
    vals: [`${m.playsetPct}%`, m.totalCopies.toLocaleString("en-US"), whole(m.value)],
    ticks: Math.round(m.playsetPct / 10),
    m,
  };
}

test("s1-23-header-desktop-math", async ({ page }) => {
  // Unnarrowed: "Your collection", no Totals switch, neutral ring.
  await openVault(page);
  const all = expected(ALL);
  let s = await shown(page);
  expect(all.m.totalCopies).toBeGreaterThan(0);
  expect(s.vals).toEqual(all.vals);
  expect(s.filledTicks).toBe(all.ticks);
  expect(s.strip).toEqual({ pct: all.vals[0], n: all.vals[1], value: all.vals[2] });
  expect(s.toggle).toBe(false);
  expect(s.label).toBe("Your collection");
  expect(s.ring).toBe("rgba(211, 211, 212, 0.28)");

  // Scoped (b2-header-desktop-math): desktop math over the narrowed rows;
  // amber ring = cards.css:286-298's rgba(217,154,31,0.4).
  await openVault(page, "#/vault?finish=Hyperspace");
  const hs = expected(narrow({ finish: new Set(["Hyperspace"]) }));
  s = await shown(page);
  expect(hs.vals).not.toEqual(all.vals);
  expect(s.vals).toEqual(hs.vals);
  expect(s.amber).toBe(true);
  expect(s.ring).toBe("rgba(217, 154, 31, 0.4)");

  // Totals All ignores the narrowing and leaves the scope engaged.
  await page.locator(".m-scope .m-seg__btn", { hasText: "All" }).click();
  await page.waitForTimeout(200);
  s = await shown(page);
  expect(s.vals).toEqual(all.vals);
  expect(s.amber).toBe(false);
  await expect(page.locator(".m-scopechip")).toHaveClass(/m-scopechip--on/);

  // Market / Low drives the value; persisted as desktop's price kind.
  await page.locator(".m-summary__head .m-priceseg .m-seg__btn", { hasText: "Low" }).click();
  await page.waitForTimeout(150);
  const low = expected(ALL, "low");
  expect(low.vals[2]).not.toBe(all.vals[2]);
  expect((await shown(page)).vals[2]).toBe(low.vals[2]);
  expect(await page.evaluate(() => localStorage.getItem("swu.cardsValue.kind"))).toBe("low");
  await openVault(page);
  await expect(page.locator(".m-summary__head .m-priceseg .m-seg__btn--on")).toHaveText("Low");
  expect((await shown(page)).vals[2]).toBe(low.vals[2]);
});

test("s1-23-segments-short", async ({ page }) => {
  await openVault(page, "#/vault?set=ASH");
  const iw = await page.evaluate(() => innerWidth);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll(".m-summary__head .m-seg")].map((s) => {
      const cs = getComputedStyle(s, "::before");
      const drawn = s.getBoundingClientRect().height - parseFloat(cs.top) - parseFloat(cs.bottom);
      return {
        drawn: Math.round(drawn),
        border: getComputedStyle(s).borderTopWidth,
        btns: [...s.querySelectorAll(".m-seg__btn")].map((b) => {
          const br = b.getBoundingClientRect();
          return [Math.round(br.width), Math.round(br.height)];
        }),
        right: s.getBoundingClientRect().right,
      };
    })
  );
  expect(r).toHaveLength(2);
  for (const seg of r) {
    expect(seg.drawn).toBe(34);
    expect(seg.border).toBe("0px");
    for (const [w, h] of seg.btns) {
      expect(w).toBeGreaterThanOrEqual(44);
      expect(h).toBeGreaterThanOrEqual(44);
    }
    expect(seg.right).toBeLessThanOrEqual(iw);
  }
  // The amber Totals switch: outline + on-state wash + amber text; the
  // Market / Low segment stays blue.
  const amber = await page.evaluate(() => {
    const seg = document.querySelector(".m-scope")!;
    const on = seg.querySelector(".m-seg__btn--on")!;
    return {
      border: getComputedStyle(seg, "::before").borderTopColor,
      wash: getComputedStyle(on, "::before").backgroundColor,
      color: getComputedStyle(on).color,
      price: getComputedStyle(document.querySelector(".m-priceseg .m-seg__btn--on")!, "::before")
        .backgroundColor,
    };
  });
  expect(amber).toEqual({
    border: "rgba(217, 154, 31, 0.4)",
    wash: "rgba(217, 154, 31, 0.16)",
    color: "rgb(242, 193, 78)",
    price: "rgba(37, 99, 235, 0.35)",
  });
});

test("s1-23-scope-toggle", async ({ page }) => {
  await openVault(page, "#/vault?set=ASH");
  const ash = expected(narrow({ set: new Set(["ASH"]) }));
  let s = await shown(page);
  expect(s.toggle && s.amber).toBe(true);
  expect(s.label).toBe("Totals");
  expect(s.vals).toEqual(ash.vals);
  await expect(page.locator(".m-scope .m-seg__btn--on")).toHaveText("Filtered");
  // vault-scope-toggle / vault-set-all: All changes the totals, neutral ring.
  await page.locator(".m-scope .m-seg__btn", { hasText: "All" }).click();
  await page.waitForTimeout(200);
  s = await shown(page);
  expect(s.vals[1]).not.toBe(ash.vals[1]);
  expect(s.vals).toEqual(expected(ALL).vals);
  expect(s.amber).toBe(false);
  await expect(page.locator(".m-scope .m-seg__btn--on")).toHaveText("All");
  // Clearing the narrowing hides the switch; hidden it reads Filtered.
  await page.locator(".m-clearbtn").click();
  await page.waitForTimeout(200);
  s = await shown(page);
  expect(s.toggle).toBe(false);
  expect(s.vals).toEqual(expected(ALL).vals);
});

test("s1-23-collapsed-amber", async ({ page }) => {
  await openVault(page);
  await scrollBy(page, ".m-vault__scroll", 360);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  await expect(page.locator(".m-vh__narrow")).toHaveCount(0);
  await openVault(page, "#/vault?set=ASH,LAW,SOR");
  await scrollBy(page, ".m-vault__scroll", 360);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  await expect(page.locator(".m-vh__narrow")).toHaveCount(1);
  const three = expected(narrow({ set: new Set(["ASH", "LAW", "SOR"]) }));
  expect((await shown(page)).strip).toEqual({
    pct: three.vals[0],
    n: three.vals[1],
    value: three.vals[2],
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("s1-23-header-signed-out", async ({ page }) => {
    await openVault(page, "#/vault?set=ASH");
    const s = await shown(page);
    // Desktop's signed-out rule: em dashes, empty ticks, no Totals switch.
    expect(s.vals).toEqual(["—", "—", "—"]);
    expect(s.filledTicks).toBe(0);
    expect(s.toggle).toBe(false);
    expect(s.amber).toBe(false);
    expect(s.strip).toEqual({ pct: "—", n: "—", value: "—" });
    // Desktop opens the breakdown only when signed in.
    expect(await page.locator(".m-summary__body").evaluate((e) => e.tagName)).toBe("DIV");
    await expect(page.locator(".m-summary .m-metric__sub").first()).toHaveText("— unique");
  });
});
