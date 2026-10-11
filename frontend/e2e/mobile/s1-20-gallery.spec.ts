import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-20: the gallery -- desktop's console plate with cards.css literals at the
// phone scale (8 / 13 / 28 px), scoped plates (rev4 r4-7-plate-states,
// b2-gallery-plates) and the 1 / 2 / 3 grid.
test.afterEach(measureEach);

test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone gallery");
});

interface FxVariant {
  variant_id: number;
  variant_type: string;
  finish: string | null;
  card_number: string;
}
interface FxCard {
  id: number;
  set_code: string;
  base_card_number: string;
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

const G = {
  text: "rgb(230, 230, 230)",
  green: "rgb(31, 163, 71)",
  muted: "rgb(107, 122, 153)",
  pipLine: "rgba(230, 230, 230, 0.45)",
  ring: "rgba(211, 211, 212, 0.35)",
  ringDone: "rgba(31, 163, 71, 0.55)",
  inner: "rgb(11, 14, 24)",
  amber: "rgb(217, 154, 31)",
  amberWash: "rgba(217, 154, 31, 0.08)",
  none: "rgba(0, 0, 0, 0)",
};

async function openVault(page: Page, hash: string) {
  await page.goto("/" + hash);
  await expect(page.locator(".m-cell").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

async function bringCell(page: Page, id: number) {
  const sel = `.m-cell[data-card="${id}"]`;
  await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop = 0));
  await page.waitForTimeout(150);
  for (let i = 0; i < 80 && !(await page.locator(sel).count()); i++) {
    await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop += 300));
    await page.waitForTimeout(60);
  }
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  return sel;
}

const readPlate = (page: Page, sel: string) =>
  page.evaluate((sel) => {
    const cell = document.querySelector(sel)!;
    const plate = cell.querySelector(".gallery-plate")!;
    const inner = plate.querySelector(".gallery-plate__inner")!;
    const tot = plate.querySelector(".gallery-plate__total")!;
    return {
      ring: getComputedStyle(plate).backgroundColor,
      inner: getComputedStyle(inner).backgroundColor,
      plateH: plate.getBoundingClientRect().height,
      total: tot.textContent,
      totalColor: getComputedStyle(tot).color,
      totalSize: getComputedStyle(tot).fontSize,
      complete: plate.classList.contains("gallery-plate--complete"),
      shown: Number((cell as HTMLElement).dataset.shown),
      pips: [...plate.querySelectorAll(".gallery-plate__pip")].map((p) => {
        const s = getComputedStyle(p);
        return { w: s.width, fill: s.backgroundColor, line: s.borderTopColor };
      }),
      text: cell.textContent,
    };
  }, sel);

test("s1-20-plate-states", async ({ page }) => {
  const states: [string, FxCard, string | null][] = [
    ["empty", pick((o) => o === 0), null],
    ["partial", pick((o) => o > 0 && o < 3), null],
    ["complete", pick((o) => o === 3), null],
    ["scoped-partial", byNum("SOR", "87"), "Hyperspace"],
    ["scoped-complete", byNum("ASH", "52"), "Hyperspace"],
  ];
  for (const [name, c, scope] of states) {
    await openVault(
      page,
      `#/vault?view=gallery${scope ? "&finish=" + encodeURIComponent(scope) : ""}`
    );
    const r = await readPlate(page, await bringCell(page, c.id));
    await test.step(name, () => {
      const o = owned(c);
      const l = size(c);
      const complete = o >= l;
      const so = scope ? scopedOwned(c, scope) : o;
      const filled = Math.min(l, so);
      const pipsComplete = scope ? so >= l : complete;
      expect(r.ring).toBe(pipsComplete ? G.ringDone : G.ring);
      expect(r.inner).toBe(pipsComplete ? G.amberWash : G.inner);
      expect(r.total).toBe(String(o));
      expect(r.totalColor).toBe(complete ? G.green : o === 0 ? G.muted : G.text);
      expect(r.text).not.toMatch(/\d\s*\/\s*\d/);
      // Phone scale: 28 px plate, 8 px pips, 13 px total.
      expect(r.plateH).toBe(28);
      expect(r.totalSize).toBe("13px");
      expect(r.pips).toHaveLength(l);
      r.pips.forEach((p, i) => {
        const on = i < filled;
        const want = !on ? G.none : pipsComplete ? G.green : scope ? G.amber : G.text;
        expect(p.w).toBe("8px");
        expect(p.fill, `pip ${i}`).toBe(want);
        expect(p.line, `pip ${i} line`).toBe(on ? want : G.pipLine);
      });
    });
  }
});

test("s1-20-gallery-plates-scoped", async ({ page }) => {
  const ch = byNum("SOR", "35");
  const hsLow = ch.variants
    .filter((v) => fin(v) === "Hyperspace")
    .sort((a, b) => +a.card_number - +b.card_number)[0];
  await openVault(page, "#/vault?view=gallery&finish=Hyperspace");
  const a = await readPlate(page, await bringCell(page, ch.id));
  expect(a.pips.filter((p) => p.fill !== G.none)).toHaveLength(0);
  expect(a.total).toBe("3");
  expect(a.complete).toBe(false);
  expect(a.shown).toBe(hsLow.variant_id);
  const b = await readPlate(page, await bringCell(page, byNum("ASH", "52").id));
  expect(b.complete).toBe(true);
  const v = await readPlate(page, await bringCell(page, byNum("SOR", "87").id));
  expect(v.pips[0].fill).toBe(G.amber);
});

test("s1-20-gsize-grid", async ({ page }) => {
  for (const n of [1, 2, 3]) {
    await openVault(page, `#/vault?view=gallery&gsize=${n}`);
    const r = await page.evaluate(() => {
      const line = document.querySelector(".m-gline")!;
      const cells = [...line.querySelectorAll(".m-cell")].map((c) => c.getBoundingClientRect());
      const frame = line.querySelector(".m-cell__frame")!.getBoundingClientRect();
      return {
        iw: innerWidth,
        widths: cells.map((c) => c.width),
        lefts: cells.map((c) => c.left),
        gap: getComputedStyle(line).columnGap,
        ratio: frame.height / frame.width,
      };
    });
    const gap = parseFloat(r.gap);
    const inner = r.iw - 32;
    const want = n === 1 ? Math.min(330, inner) : (inner - gap * (n - 1)) / n;
    expect(r.widths).toHaveLength(n);
    for (const w of r.widths) expect(Math.abs(w - want)).toBeLessThanOrEqual(1);
    if (n > 1) expect(Math.abs(r.lefts[0] - 16)).toBeLessThanOrEqual(1);
    else expect(Math.abs(r.lefts[0] - (r.iw - want) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.ratio - 7 / 5)).toBeLessThan(0.02);
  }
});
