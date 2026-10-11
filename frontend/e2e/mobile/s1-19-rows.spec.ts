import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-19: the Vault rows -- desktop's count chip + 10 px pips with cards.css
// literals (rev4 r4-7-row-chip-states, r4-7-no-fraction-on-card-surfaces,
// b2-row-pips-number-price, b2-row-pips-amber-complete, b2-row-price-emdash)
// and virtualisation over 600 cards.
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone rows");
});

interface FxVariant {
  variant_id: number;
  variant_type: string;
  finish: string | null;
  source_set_code: string;
  card_number: string;
  front_image_url: string | null;
  price: { market: number | null } | null;
}
interface FxCard {
  id: number;
  set_code: string;
  base_card_number: string;
  name: string;
  type: string;
  variants: FxVariant[];
}
const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as FxCard[];
const QTY = new Map(
  (
    JSON.parse(readFileSync("e2e/mobile/fixtures/quantities.json", "utf8")) as {
      variant_id: number;
      quantity: number;
    }[]
  ).map((q) => [q.variant_id, q.quantity])
);
const fin = (v: FxVariant) => v.finish ?? v.variant_type;
const size = (c: FxCard) => (c.type === "Leader" || c.type === "Base" ? 1 : 3);
const owned = (c: FxCard) => c.variants.reduce((s, v) => s + (QTY.get(v.variant_id) ?? 0), 0);
const scopedOwned = (c: FxCard, f: string) =>
  c.variants.filter((v) => fin(v) === f).reduce((s, v) => s + (QTY.get(v.variant_id) ?? 0), 0);
const byNum = (set: string, n: string) =>
  CARDS.find((c) => c.set_code === set && c.base_card_number === n)!;
const pick = (f: (o: number) => boolean) => CARDS.find((c) => size(c) === 3 && f(owned(c)))!;
const money = (p: number | null | undefined) =>
  p == null ? "—" : p >= 100 ? `$${Math.round(p)}` : `$${p.toFixed(2)}`;

/** cards.css literals as computed values (rev4 r47Check table). */
const T = {
  text: "rgb(230, 230, 230)",
  surf: "rgb(15, 21, 40)",
  border: "rgb(30, 39, 72)",
  muted: "rgb(107, 122, 153)",
  green: "rgb(23, 138, 58)",
  greenRing: "rgba(23, 138, 58, 0.6)",
  greenGlow: "rgba(23, 138, 58, 0.25) 0px 0px 6px 0px",
  amber: "rgb(217, 154, 31)",
  amberLine: "rgba(217, 154, 31, 0.6)",
  amberWash: "rgba(217, 154, 31, 0.08)",
  none: "rgba(0, 0, 0, 0)",
};

/** `fresh`: reload, so view state set by an earlier hash (e.g. a scope) is gone
 * -- a hash-only navigation keeps the screen's state, as in the app. */
async function openVault(page: Page, hash = "#/vault", fresh = false) {
  await page.goto("/" + hash);
  if (fresh) await page.reload();
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** Scroll the virtualised list until the card's row is rendered. */
async function bringRow(page: Page, id: number) {
  const sel = `.m-row[data-card="${id}"]`;
  await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop = 0));
  await page.waitForTimeout(150);
  for (let i = 0; i < 80 && !(await page.locator(sel).count()); i++) {
    await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop += 240));
    await page.waitForTimeout(60);
  }
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  return sel;
}

/** Computed chip + pip styling for one row. */
const readRow = (page: Page, sel: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const chip = el.querySelector(".playset-chip")!;
    const cs = getComputedStyle(chip);
    const box = el.querySelector(".playset__pips")!;
    const bs = getComputedStyle(box);
    return {
      chip: {
        text: chip.textContent,
        font: /Russo One/.test(cs.fontFamily) && cs.fontSize === "12px",
        color: cs.color,
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        glow: cs.boxShadow,
      },
      chipLeft: chip.getBoundingClientRect().right <= box.getBoundingClientRect().left + 0.5,
      plate: { border: bs.borderTopColor, bg: bs.backgroundColor },
      pips: [...el.querySelectorAll(".playset__pip")].map((p) => {
        const ps = getComputedStyle(p);
        return { w: ps.width, fill: ps.backgroundColor, line: ps.borderTopColor };
      }),
      num: el.querySelector(".m-row__num")!.textContent,
      numColor: getComputedStyle(el.querySelector(".m-row__num")!).color,
      price: el.querySelector(".m-row__price")!.textContent,
      ownScoped: !!el.querySelector(".m-row__own--scoped"),
      thumb: el.querySelector(".m-row__thumb img")?.getAttribute("src") ?? null,
    };
  }, sel);

function expectState(r: Awaited<ReturnType<typeof readRow>>, c: FxCard, scope: string | null) {
  const o = owned(c);
  const l = size(c);
  const complete = o >= l;
  const so = scope ? scopedOwned(c, scope) : o;
  const filled = Math.min(l, so);
  const scopedComplete = !!scope && so >= l;
  expect(r.chip).toEqual({
    text: String(o),
    font: true,
    color: complete ? T.green : o === 0 ? T.muted : T.text,
    bg: T.surf,
    border: complete ? T.greenRing : T.border,
    glow: complete ? T.greenGlow : "none",
  });
  expect(r.chipLeft).toBe(true);
  expect(r.plate.border === T.amberLine && r.plate.bg === T.amberWash).toBe(scopedComplete);
  expect(r.pips).toHaveLength(l);
  r.pips.forEach((p, i) => {
    const on = i < filled;
    const want = !on
      ? T.none
      : scopedComplete
        ? T.green
        : scope
          ? T.amber
          : complete
            ? T.green
            : T.text;
    expect(p.w).toBe("10px");
    expect(p.fill, `pip ${i}`).toBe(want);
    expect(p.line, `pip ${i} line`).toBe(on ? want : o === 0 ? T.border : T.muted);
  });
}

test("s1-19-row-chip-states", async ({ page }) => {
  const states: [string, FxCard, string | null][] = [
    ["empty", pick((o) => o === 0), null],
    ["partial", pick((o) => o > 0 && o < 3), null],
    ["complete", pick((o) => o === 3), null],
    ["scoped-partial", byNum("SOR", "87"), "Hyperspace"],
    ["scoped-complete", byNum("ASH", "52"), "Hyperspace"],
  ];
  expect(scopedOwned(byNum("SOR", "87"), "Hyperspace")).toBe(1);
  expect(scopedOwned(byNum("ASH", "52"), "Hyperspace")).toBe(3);
  for (const [name, card, scope] of states) {
    await openVault(page, scope ? `#/vault?finish=${encodeURIComponent(scope)}` : "#/vault");
    const sel = await bringRow(page, card.id);
    const r = await readRow(page, sel);
    await test.step(name, () => expectState(r, card, scope));
  }
});

test("s1-19-no-fraction-on-card-surfaces", async ({ page }) => {
  for (const s of ["none", "sm", "md", "lg"]) {
    await openVault(page, `#/vault?finish=Hyperspace&view=rows&size=${s}`);
    const r = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".m-row__own")];
      return { n: els.length, hit: els.filter((e) => /\d\s*\/\s*\d/.test(e.textContent!)).length };
    });
    expect(r.n, s).toBeGreaterThan(0);
    expect(r.hit, s).toBe(0);
  }
});

test("s1-19-row-pips-number-price", async ({ page }) => {
  const c = byNum("SOR", "35");
  const hs = c.variants.find((v) => fin(v) === "Hyperspace")!;
  const std = c.variants.find((v) => v.variant_type === "Standard")!;
  expect(owned(c)).toBe(3);
  expect(scopedOwned(c, "Hyperspace")).toBe(0);
  await openVault(page, "#/vault?finish=Hyperspace");
  const r = await readRow(page, await bringRow(page, c.id));
  expect(r.pips.filter((p) => p.fill !== T.none)).toHaveLength(0);
  expect(r.chip.text).toBe("3");
  expect(r.num).toBe(`${hs.source_set_code} ${hs.card_number}`);
  expect(hs.card_number).not.toBe(c.base_card_number);
  expect(r.numColor).toBe("rgb(242, 193, 78)");
  expect(r.price).toBe(money(hs.price?.market));
  expect(r.price).not.toBe(money(std.price?.market));
  expect(r.ownScoped).toBe(true);
  const stem = new URL(hs.front_image_url!).pathname
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "");
  expect(r.thumb).toContain(stem);
  // Unscoped, the same row reads the representative printing.
  await openVault(page, "#/vault", true);
  const u = await readRow(page, await bringRow(page, c.id));
  expect(u.num).toBe(`SOR ${c.base_card_number}`);
  expect(u.price).toBe(money(std.price?.market));
  expect(u.ownScoped).toBe(false);
});

test("s1-19-row-pips-amber-complete", async ({ page }) => {
  await openVault(page, "#/vault?finish=Hyperspace");
  const v = await readRow(page, await bringRow(page, byNum("SOR", "87").id));
  expect(v.pips.map((p) => p.fill)).toEqual([T.amber, T.none, T.none]);
  expect(v.plate.border).not.toBe(T.amberLine);
  const ch = await readRow(page, await bringRow(page, byNum("ASH", "52").id));
  expect(ch.plate).toEqual({ border: T.amberLine, bg: T.amberWash });
  expect(ch.pips.map((p) => p.fill)).toEqual([T.green, T.green, T.green]);
});

test("s1-19-row-price-emdash", async ({ page }) => {
  await openVault(page, "#/vault?finish=Serialized%20Prestige&size=none");
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".m-row[data-card]")].map((r) => ({
      id: Number((r as HTMLElement).dataset.card),
      price: r.querySelector(".m-row__price")!.textContent,
      none: r.querySelector(".m-row__price")!.classList.contains("m-row__price--none"),
    }))
  );
  expect(rows.length).toBeGreaterThan(0);
  let dash = 0;
  for (const r of rows) {
    const c = CARDS.find((x) => x.id === r.id)!;
    const v = c.variants.find((x) => fin(x) === "Serialized Prestige")!;
    expect(r.price).toBe(money(v.price?.market));
    if (r.price === "—") {
      dash++;
      expect(r.none).toBe(true);
    }
  }
  expect(dash).toBeGreaterThan(0);
});

test.describe("600 cards", () => {
  test.use({ cardsFixture: "base-cards-600" });
  test("s1-19-rows-virtualised", async ({ page }) => {
    await openVault(page, "#/vault?size=md");
    const first = await page.evaluate(() => ({
      rendered: document.querySelectorAll(".m-row").length,
      count: document.querySelector(".m-count")!.textContent!.trim(),
    }));
    expect(first.count).toBe("600 cards");
    expect(first.rendered).toBeLessThan(60);
    // Scrolling to the end reveals the last card; still far fewer than 600 rows.
    for (let i = 0; i < 6; i++) {
      await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop = e.scrollHeight));
      await page.waitForTimeout(150);
    }
    const end = await page.evaluate(() => {
      const sc = document.querySelector(".m-vault__scroll")!;
      const rows = [...document.querySelectorAll(".m-row")];
      const last = rows[rows.length - 1].getBoundingClientRect();
      return {
        rendered: rows.length,
        lastVisible: last.bottom <= sc.getBoundingClientRect().bottom + 1 && last.bottom > 0,
        atEnd: Math.abs(sc.scrollTop + sc.clientHeight - sc.scrollHeight) <= 2,
        lastIndex: Number(rows[rows.length - 1].parentElement!.dataset.index),
      };
    });
    expect(end.rendered).toBeLessThan(60);
    expect(end.atEnd).toBe(true);
    expect(end.lastVisible).toBe(true);
    expect(end.lastIndex).toBe(599);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("s1-19-row-chip-signed-out", async ({ page }) => {
    await openVault(page);
    const r = await page.evaluate(() => {
      const chip = document.querySelector(".m-row .playset-chip")!;
      return {
        text: chip.textContent,
        cls: chip.className,
        color: getComputedStyle(chip).color,
        filled: document.querySelectorAll(".m-row .playset__pip--filled").length,
      };
    });
    expect(r).toEqual({
      text: "—",
      cls: "playset-chip playset-chip--signed-out",
      color: "rgb(107, 122, 153)",
      filled: 0,
    });
  });
});
