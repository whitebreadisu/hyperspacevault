import type { Page } from "@playwright/test";
import { expect, measureEach, test, wideText } from "./helpers";
import { byNum, fin, openCard, scrollDetail } from "./card-helpers";
import type { FxCard } from "./card-helpers";

// FR1 stage 1b (BL-257): the card-detail items of the mobile 2.0 finish round
// (FR1-07 plate, FR1-08 caption, FR1-09 collapsed row). Stage 1a's items are
// in fr1-finish-round.spec.ts. One named test per item.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

// ── FR1-07: the card-detail plate is the gallery plate, scoped to the printing's finish ──
const plateShape = (page: Page, root: string) =>
  page.evaluate((root) => {
    const el = document.querySelector(root)!;
    const plate = el.querySelector(".gallery-plate")!;
    const tot = plate.querySelector(".gallery-plate__total");
    return {
      plate: [...plate.classList].filter((c) => c.startsWith("gallery-plate")).sort(),
      pips: [...plate.querySelectorAll(".gallery-plate__pip")].map((p) =>
        [...p.classList].sort().join(" ")
      ),
      total: tot?.textContent ?? null,
      totalCls: tot ? [...tot.classList].sort().join(" ") : null,
      hasPips: plate.querySelectorAll(".gallery-plate__pips").length,
      oldIdiom: el.querySelectorAll(".playset-chip, .playset__pips").length,
    };
  }, root);

/** The collapsed row's boxes (FR1-09), read from the live page. */
const miniGeom = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector(".m-cardlayer .m-page:not(.m-page--ghost) .m-dreg3")!;
    const r = (s: string) => root.querySelector(s)!.getBoundingClientRect();
    const seg = root.querySelector(".m-dreg3__mini .m-seg")!;
    const before = getComputedStyle(seg, "::before");
    const mini = root.querySelector(".m-dreg3__mini")!;
    return {
      vw: innerWidth,
      regionH: (root as HTMLElement).offsetHeight,
      regionTop: root.getBoundingClientRect().top,
      art: r(".m-dreg3__art"),
      mini: mini.getBoundingClientRect(),
      inv: r(".m-dreg3__mini .m-dreg__inv"),
      label: r(".m-dreg3__mini .m-dreg__minilab"),
      labelText: root.querySelector(".m-dreg3__mini .m-dreg__minilab")!.textContent,
      plate: r(".m-dreg3__mini .gallery-plate"),
      price: r(".m-dreg3__mini .m-dreg__price"),
      seg: seg.getBoundingClientRect(),
      segDrawn:
        seg.getBoundingClientRect().height - parseFloat(before.top) - parseFloat(before.bottom),
      segBtns: [...seg.querySelectorAll("button")].map((b) => b.getBoundingClientRect().height),
      pval: r(".m-dreg3__mini .m-dreg__pval"),
      pvalText: root.querySelector(".m-dreg3__mini .m-dreg__pval")!.textContent,
      miniText: mini.textContent ?? "",
      numInMini: mini.querySelectorAll(".m-dreg__num").length,
      kids: [...mini.querySelectorAll("*")].map((e) => {
        const b = e.getBoundingClientRect();
        return [b.top, b.bottom];
      }),
    };
  });

// FR1-07, second owner decision 2026-10-12 ("plate exactly like the gallery"):
// the detail plate is compared with the gallery tile of the same card while
// the Vault is scoped to the selected printing's finish.
type Owned = Record<number, number>;
type Want = { size: number; total: number; scoped: number };
/** Serve these quantities (and nothing else) as the signed-in inventory. */
async function serveQuantities(page: Page, get: () => Owned) {
  await page.route(
    (u) => u.pathname === "/api/inventory/quantities",
    (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          Object.entries(get()).map(([id, quantity]) => ({ variant_id: Number(id), quantity }))
        ),
      })
  );
}
/** What a finish-scoped gallery tile must show (vault/GalleryCell.tsx). */
const want = (c: FxCard, scope: string, owned: Owned): Want => {
  const size = c.type === "Leader" || c.type === "Base" ? 1 : 3;
  const total = c.variants.reduce((s, v) => s + (owned[v.variant_id] ?? 0), 0);
  const scoped = c.variants
    .filter((v) => fin(v) === scope)
    .reduce((s, v) => s + (owned[v.variant_id] ?? 0), 0);
  return { size, total, scoped };
};
function expectPlate(r: Awaited<ReturnType<typeof plateShape>>, w: Want) {
  expect(r.hasPips).toBe(1);
  expect(r.oldIdiom).toBe(0);
  // Pips: the scoped finish's sum, in the amber (scoped) idiom.
  const lit = Math.min(w.size, w.scoped);
  expect(r.pips).toHaveLength(w.size);
  expect(r.pips.filter((p) => p.includes("gallery-plate__pip--filled"))).toHaveLength(lit);
  expect(r.pips.filter((p) => p.includes("gallery-plate__pip--scoped"))).toHaveLength(lit);
  // Complete state: the SCOPED sum is a playset.
  expect(r.plate.includes("gallery-plate--complete")).toBe(w.scoped >= w.size);
  // The number: the card's total across all printings, the gallery's classes.
  expect(r.total).toBe(String(w.total));
  expect(r.totalCls).toBe(
    "gallery-plate__total" +
      (w.total >= w.size
        ? " gallery-plate__total--complete"
        : w.total === 0
          ? " gallery-plate__total--empty"
          : "")
  );
}
const OWN = ".m-cardlayer .m-dreg3__own";
const MINI = ".m-cardlayer .m-dreg3__mini";
const ACTIVE = ".m-print.cp-rail__item--active";
/** Read the card's tile in the gallery of a Vault scoped to `scope`, tap it,
 * and return the tile's plate + the printing the detail opened on. */
async function openFromScopedTile(page: Page, c: FxCard, scope: string) {
  const cell = `.m-cell[data-card="${c.id}"]`;
  await page.goto("about:blank");
  await page.goto(`/#/vault?view=gallery&finish=${encodeURIComponent(scope)}`);
  await expect(page.locator(".m-cell").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (let i = 0; i < 80 && !(await page.locator(cell).count()); i++) {
    await page.locator(".m-vault__scroll").evaluate((e) => void (e.scrollTop += 300));
    await page.waitForTimeout(60);
  }
  await page.locator(cell).scrollIntoViewIfNeeded();
  const tile = await plateShape(page, cell);
  await page.locator(cell).click();
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  const id = Number(await page.locator(ACTIVE).getAttribute("data-variant"));
  const selected = c.variants.find((v) => v.variant_id === id)!;
  // The detail opened on a printing of the scoped finish: its finish is the
  // plate's scope, so tile and plate describe the same thing.
  expect(fin(selected)).toBe(scope);
  return { tile, selected };
}
async function pickRow(page: Page, id: number) {
  await page.locator(`.m-print[data-variant="${id}"] .m-print__main`).click();
  await expect(page.locator(ACTIVE)).toHaveAttribute("data-variant", String(id));
}

test("fr1-07 card-detail plate = the gallery tile scoped to the selected printing's finish", async ({
  page,
}) => {
  // ASH 52 Chimaera (playset 3): only its one Hyperspace printing is owned,
  // at 0 / partial / playset / over a playset.
  const c = byNum("ASH", 52);
  const hs = c.variants.find((v) => fin(v) === "Hyperspace")!;
  let owned: Owned = {};
  // Four full gallery loads: over the 30 s default when the machine is busy.
  test.setTimeout(75_000);
  await serveQuantities(page, () => owned);
  for (const q of [0, 1, 3, 4]) {
    owned = { [hs.variant_id]: q };
    const { tile, selected } = await openFromScopedTile(page, c, "Hyperspace");
    expect(selected.variant_id).toBe(hs.variant_id);
    const own = await plateShape(page, OWN);
    const mini = await plateShape(page, MINI);
    const w = want(c, "Hyperspace", owned);
    await test.step(`quantity ${q}`, () => {
      expect(w).toEqual({ size: 3, total: q, scoped: q });
      // Same classes and total as the gallery tile, in both plates.
      expect(own).toEqual(tile);
      expect(mini).toEqual(tile);
      expectPlate(own, w);
    });
    // data-plate-qty carries the number drawn (the card total).
    await expect(page.locator(`${OWN} .m-plate-hit--btn`)).toHaveAttribute(
      "data-plate-qty",
      String(q)
    );
  }
  // The plate is still the button that opens Owned by finish; its label says
  // what it shows: the card total, then the selected finish's count.
  const btn = page.locator(`${OWN} .m-plate-hit--btn`);
  await expect(btn).toHaveAttribute(
    "aria-label",
    `${c.name}: 4 owned, 4 Hyperspace. Show owned by finish`
  );
  await btn.click();
  await expect(page.locator(".m-sheet-layer--finish")).toBeVisible();
  await page.locator(".m-sheet-layer--finish .m-sheet__close").click();
  await expect(page.locator(".m-sheet-layer--finish")).toHaveCount(0);
});

// The first FR1-07 build drew the SELECTED PRINTING's quantity in pips, ring
// and number. Owner decision 2026-10-12: exactly like the gallery -- pips =
// every printing of the selected finish, number = the card total. These are
// the cases where the two differ, in two tests of three gallery loads each.
type Case = [string, FxCard, string, Owned, Want];
/** Each case: tile and both detail plates agree, and show `expected`.
 * `pair` = two printings of the scoped finish: selecting the other one must
 * not change the plate. */
async function compareWithTile(page: Page, cases: Case[], pair?: [number, number]) {
  // Three full gallery loads: near the 30 s default when the machine is busy.
  test.setTimeout(75_000);
  let owned: Owned = {};
  await serveQuantities(page, () => owned);
  for (const [name, c, scope, q, expected] of cases) {
    owned = q;
    const { tile, selected } = await openFromScopedTile(page, c, scope);
    const own = await plateShape(page, OWN);
    const mini = await plateShape(page, MINI);
    await test.step(name, () => {
      // The case really has the shape it names.
      expect(want(c, scope, q)).toEqual(expected);
      expect(own).toEqual(tile);
      expect(mini).toEqual(tile);
      expectPlate(own, expected);
      // ... and the first build's number (the selected printing's) differs.
      expect(String(q[selected.variant_id] ?? 0)).not.toBe(own.total);
    });
    const btn = page.locator(`${OWN} .m-plate-hit--btn`);
    await expect(btn).toHaveAttribute("data-plate-qty", String(expected.total));
    await expect(btn).toHaveAttribute("data-plate-scoped", String(expected.scoped));
    if (pair) {
      // The other printing of the same finish: same scope, same plate.
      await pickRow(page, selected.variant_id === pair[0] ? pair[1] : pair[0]);
      expect(await plateShape(page, OWN)).toEqual(tile);
      await pickRow(page, selected.variant_id);
    }
  }
}

test("fr1-07 plate = gallery tile when another finish is owned, and when the owned printing is not the selected one", async ({
  page,
}) => {
  const chim = byNum("ASH", 52);
  const cStd = chim.variants.find((v) => fin(v) === "Standard")!.variant_id;
  const cHs = chim.variants.find((v) => fin(v) === "Hyperspace")!.variant_id;
  await compareWithTile(page, [
    // (a) another finish is also owned: the number counts it, the pips do not.
    [
      "a: 1 Hyperspace + 2 Standard",
      chim,
      "Hyperspace",
      { [cHs]: 1, [cStd]: 2 },
      { size: 3, total: 3, scoped: 1 },
    ],
    [
      "a: 3 Hyperspace + 1 Standard",
      chim,
      "Hyperspace",
      { [cHs]: 3, [cStd]: 1 },
      { size: 3, total: 4, scoped: 3 },
    ],
    // (c) the owned printing is not the selected one: empty pips, its number.
    [
      "c: 2 Standard, Hyperspace selected",
      chim,
      "Hyperspace",
      { [cStd]: 2 },
      { size: 3, total: 2, scoped: 0 },
    ],
  ]);
});

test("fr1-07 plate = gallery tile when two printings share the selected finish; + moves the plate at once", async ({
  page,
}) => {
  // JTL 147 Black One has TWO Standard printings (JTL 147 and P25 167).
  const black = byNum("JTL", 147);
  const [s1, s2] = black.variants.filter((v) => fin(v) === "Standard").map((v) => v.variant_id);
  expect(s2).toBeDefined();
  const bHs = black.variants.find((v) => fin(v) === "Hyperspace")!.variant_id;
  // (b) two printings share the selected finish: the pips sum both.
  const cases: Case[] = [
    [
      "b: 1 + 2 Standard",
      black,
      "Standard",
      { [s1]: 1, [s2]: 2 },
      { size: 3, total: 3, scoped: 3 },
    ],
    [
      "b: 2 + 2 Standard + 1 Hyperspace",
      black,
      "Standard",
      { [s1]: 2, [s2]: 2, [bHs]: 1 },
      { size: 3, total: 5, scoped: 4 },
    ],
    [
      "b: 1 + 1 Standard",
      black,
      "Standard",
      { [s1]: 1, [s2]: 1 },
      { size: 3, total: 2, scoped: 2 },
    ],
  ];
  await compareWithTile(page, cases, [s1, s2]);

  // Still on Black One, 1 + 1 Standard, a Standard printing selected: + moves
  // the plate at once -- from the stepper's optimistic quantity, before the
  // server has answered (the adjust call is held here and never answered).
  await page.route(
    (u) => /^\/api\/inventory\/\d+\/adjust$/.test(u.pathname),
    () => {}
  );
  const stepQty = page.locator(`${ACTIVE} .m-step__qty`);
  await expect(stepQty).toHaveText("1");
  await page.locator(`${ACTIVE} .m-step[aria-label^="Increment"]`).click();
  await expect(stepQty).toHaveText("2");
  // 2 + 1 Standard: a playset of the finish and of the card. The number (3)
  // is the card total, not the stepper's 2 (owner-accepted).
  for (const root of [OWN, MINI])
    expectPlate(await plateShape(page, root), { size: 3, total: 3, scoped: 3 });
  await expect(page.locator(`${OWN} .m-plate-hit--btn`)).toHaveAttribute(
    "aria-label",
    `${black.name}: 3 owned, 3 Standard. Show owned by finish`
  );
  await expect(page.locator(`${OWN} .m-plate-hit--btn`)).toHaveAttribute("data-plate-qty", "3");
  // Nothing was answered: the plate state above came from the shown quantity.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe("fr1-07 signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("fr1-07 signed out: the gallery's SIGN IN TO TRACK plate", async ({ page }) => {
    await openCard(page, "ASH", 112);
    const own = page.locator(".m-dreg3__own .gallery-plate");
    await expect(own.locator(".gallery-plate__sign-in")).toHaveText("SIGN IN TO TRACK");
    await expect(own.locator(".gallery-plate__inner--signed-out")).toHaveCount(1);
    await expect(own.locator(".gallery-plate__pips, .playset-chip")).toHaveCount(0);
    // Collapsed, beside a landscape thumbnail (the tightest row): the three
    // columns still do not collide.
    const leader = byNum("SOR", 10);
    await page.goto("about:blank");
    await page.goto(`/#/card/${leader.id}?collapsed=1`);
    await expect(page.locator(".m-cardlayer .m-dreg3--collapsed")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const g = await miniGeom(page);
    expect(g.art.right).toBeLessThanOrEqual(g.inv.left + 0.5);
    expect(g.inv.right).toBeLessThanOrEqual(g.price.left + 0.5);
    expect(g.price.right).toBeLessThanOrEqual(g.vw - 16 + 0.5);
  });
});

// ── FR1-08: expanded caption = "finish - SET ###" left, price right ──
test("fr1-08 caption: finish - set number at the left, the printing's price at the right", async ({
  page,
}) => {
  const c = await openCard(page, "LAW", 214);
  const active = ".m-print.cp-rail__item--active";
  const read = () =>
    page.evaluate(() => {
      const own = document.querySelector(".m-cardlayer .m-dreg3__own")!;
      const r = (s: string) => own.querySelector(s)!.getBoundingClientRect();
      const price = own.querySelector(".m-dreg__cprice")!;
      return {
        idText: own.querySelector(".m-dreg__id")!.textContent,
        fin: r(".m-dreg__fin"),
        num: r(".m-dreg__num"),
        id: r(".m-dreg__id"),
        price: price.getBoundingClientRect(),
        priceText: price.textContent,
        priceColor: getComputedStyle(price).color,
        priceFont: getComputedStyle(price).fontFamily,
        railFont: getComputedStyle(document.querySelector(".m-print__price")!).fontFamily,
        priceCut: price.scrollWidth > price.clientWidth,
        cap: r(".m-dreg__cap"),
        own: own.getBoundingClientRect(),
        plate: r(".gallery-plate"),
      };
    });
  const rowPrice = () => page.locator(`${active} .m-print__price`).textContent();
  const pick = async (finish: string) => {
    const v = c.variants.find((x) => fin(x) === finish)!;
    await page.locator(`.m-print[data-variant="${v.variant_id}"] .m-print__main`).click();
    await expect(page.locator(active)).toHaveAttribute("data-variant", String(v.variant_id));
    await page.waitForTimeout(120);
    return v;
  };
  const seg = (t: string) => page.locator(".m-printings .m-seg__btn", { hasText: t });

  // Standard, Market: text, order, and the price = the selected row's price.
  const std = c.variants.find((x) => fin(x) === "Standard")!;
  let m = await read();
  expect(m.idText).toBe(`Standard - ${std.source_set_code} ${std.card_number}`);
  expect(m.priceText).toBe(`$${std.price!.market!.toFixed(2)}`);
  expect(m.priceText).toBe(await rowPrice());
  expect(m.priceFont).toBe(m.railFont);
  expect(m.fin.right).toBeLessThanOrEqual(m.num.left);
  expect(m.id.right).toBeLessThanOrEqual(m.price.left);
  expect(Math.abs(m.id.left - m.own.left)).toBeLessThan(1);
  expect(Math.abs(m.price.right - m.own.right)).toBeLessThan(1);
  expect(m.cap.bottom).toBeLessThanOrEqual(m.plate.top);
  // It follows Market / Low.
  await seg("Low").click();
  await expect(page.locator(".m-dreg__cprice")).toHaveText(`$${std.price!.low!.toFixed(2)}`);
  expect(await rowPrice()).toBe(`$${std.price!.low!.toFixed(2)}`);
  // The longest caption in the fixtures: "Ser. Prestige" with a three-digit
  // Low price. One line; the price is whole; the plate block keeps its height.
  const ser = await pick("Serialized Prestige");
  m = await read();
  expect(m.idText).toBe(`Ser. Prestige - ${ser.source_set_code} ${ser.card_number}`);
  expect(m.priceText).toBe(`$${ser.price!.low!.toFixed(2)}`);
  expect(m.priceCut).toBe(false);
  expect(m.cap.height).toBeLessThanOrEqual(20);
  expect(m.fin.height).toBeLessThanOrEqual(20);
  expect(Math.abs(m.fin.top - m.num.top)).toBeLessThan(6);
  expect(m.id.right).toBeLessThanOrEqual(m.price.left);
  expect(m.price.right).toBeLessThanOrEqual(m.own.right + 0.5);
  // PORT (CI fix run): the plate block is 52 px in the collapse arithmetic
  // (S2-02: 14 + 392 + 12 + 52 + 12); the browser reports 52.00003 on some
  // runs, so the bound carries a sub-pixel tolerance. A second caption line
  // would add 15 px or more.
  expect(m.own.height).toBeLessThanOrEqual(52.5);
  // The same caption under the whole-pixel text condition (helpers.ts
  // wideText): still one line, the price whole and inside the block; the
  // finish - set number group is the part that may take the ellipsis.
  await wideText(page);
  m = await read();
  expect(m.cap.height).toBeLessThanOrEqual(20);
  expect(m.fin.height).toBeLessThanOrEqual(20);
  expect(m.priceCut).toBe(false);
  expect(m.id.right).toBeLessThanOrEqual(m.price.left);
  expect(m.price.right).toBeLessThanOrEqual(m.own.right + 0.5);
  expect(m.own.height).toBeLessThanOrEqual(52.5);
  // No price: an em dash in the muted colour (this printing has no Market).
  await seg("Market").click();
  await expect(page.locator(".m-dreg__cprice")).toHaveText("—");
  m = await read();
  expect(m.priceColor).toBe("rgb(107, 122, 153)");
  // "Conv. Excl." (the other long short name) also sits on one line.
  const conv = await pick("Convention Exclusive");
  m = await read();
  expect(m.idText).toBe(`Conv. Excl. - ${conv.source_set_code} ${conv.card_number}`);
  expect(m.cap.height).toBeLessThanOrEqual(20);
});

// ── FR1-09: collapsed row = thumbnail | label over plate | Market/Low over price ──
test("fr1-09 collapsed row: thumbnail, finish label over the plate, Market / Low over the price", async ({
  page,
}) => {
  const c = await openCard(page, "ASH", 112);
  const std = c.variants.find((v) => fin(v) === "Standard")!;
  // The collapse geometry is untouched: the expanded region for this card
  // still measures the S2-02 arithmetic (14 + 392 + 12 + 52 + 12 = 482).
  const full = await page
    .locator(".m-dreg3__bg")
    .first()
    .evaluate((e) => (e as HTMLElement).offsetHeight);
  expect(full).toBe(482);
  await scrollDetail(page, 300);
  await expect(page.locator(".m-dreg3--collapsed")).toBeVisible();
  const check = (g: Awaited<ReturnType<typeof miniGeom>>, label: string, price: string) => {
    // Three columns, left to right.
    expect(Math.round(g.art.height)).toBe(80);
    expect(g.art.right).toBeLessThanOrEqual(g.inv.left + 0.5);
    expect(g.inv.right).toBeLessThanOrEqual(g.price.left + 0.5);
    expect(g.price.right).toBeLessThanOrEqual(g.vw - 16 + 0.5);
    // Column two: the finish short name above the plate.
    expect(g.labelText).toBe(label);
    expect(g.label.bottom).toBeLessThanOrEqual(g.plate.top + 0.5);
    expect(Math.abs(g.label.left - g.plate.left)).toBeLessThan(1);
    // Column three: the price below the drawn segment, right-aligned with it.
    expect(g.pvalText).toBe(price);
    expect(g.pval.top).toBeGreaterThanOrEqual(g.seg.bottom - 5 - 0.5);
    expect(Math.abs(g.pval.right - g.seg.right)).toBeLessThan(1);
    // (0.5 px: a computed difference of rect sizes, PR #226 CI fix run.)
    expect(Math.abs(g.segDrawn - 34)).toBeLessThanOrEqual(0.5);
    for (const h of g.segBtns) expect(h).toBeGreaterThanOrEqual(43.5);
    // No set / number in the collapsed row.
    expect(g.numInMini).toBe(0);
    expect(g.miniText).not.toContain(c.set_code);
    // The region's box is the pre-change 100 px; the row is its 80 px band and
    // everything in it (hit boxes included) stays inside that band.
    expect(g.regionH).toBe(100);
    expect(Math.round(g.mini.height)).toBe(80);
    expect(Math.round(g.mini.top - g.regionTop)).toBe(10);
    for (const [top, bottom] of g.kids) {
      expect(top).toBeGreaterThanOrEqual(g.mini.top - 0.5);
      expect(bottom).toBeLessThanOrEqual(g.mini.bottom + 0.5);
    }
  };
  check(await miniGeom(page), "Standard", `$${std.price!.market!.toFixed(2)}`);
  // The longest label: still three columns, nothing collides.
  const ser = c.variants.find((v) => fin(v) === "Serialized Prestige")!;
  await page.locator(`.m-print[data-variant="${ser.variant_id}"] .m-print__main`).click();
  await expect(page.locator(".m-dreg3--collapsed")).toBeVisible();
  await page.waitForTimeout(150);
  check(await miniGeom(page), "Ser. Prestige", "—");
});

// ── FR5-01 (F-14): more space between Market / Low and the price ──
/** The gap between the segment's drawn bottom edge and the price's line box
 * before FR5-01 (card.css `.m-dreg__pval { margin-top: -3px }` under a 44 px
 * segment drawn 5 px in: 5 - 3 = 2 px; the pair was 59 px tall). */
const FR5_01_OLD_GAP = 2;
test("fr5-01 collapsed row: the price sits further under Market / Low, the pair still centred", async ({
  page,
}) => {
  const c = await openCard(page, "ASH", 112);
  const std = c.variants.find((v) => fin(v) === "Standard")!;
  await scrollDetail(page, 300);
  await expect(page.locator(".m-dreg3--collapsed")).toBeVisible();
  await page.waitForTimeout(350);
  const check = (g: Awaited<ReturnType<typeof miniGeom>>, price: string) => {
    expect(g.pvalText).toBe(price);
    // The gap, measured from the segment's DRAWN bottom (5 px inside its box).
    const gap = g.pval.top - (g.seg.bottom - 5);
    expect(gap).toBeGreaterThanOrEqual(FR5_01_OLD_GAP + 4 - 0.5);
    expect(gap).toBeLessThanOrEqual(FR5_01_OLD_GAP + 6 + 0.5);
    // The pair (segment box top to price bottom) is centred in the row.
    const pairMid = (g.seg.top + g.pval.bottom) / 2;
    const rowMid = (g.mini.top + g.mini.bottom) / 2;
    expect(Math.abs(pairMid - rowMid)).toBeLessThanOrEqual(0.5);
    // The row, the region and the targets are what they were.
    expect(g.regionH).toBe(100);
    expect(Math.abs(g.mini.height - 80)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g.mini.top - g.regionTop - 10)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g.art.height - 80)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g.segDrawn - 34)).toBeLessThanOrEqual(0.5);
    for (const h of g.segBtns) expect(h).toBeGreaterThanOrEqual(43.5);
    // Nothing leaves the 80 px band, and the price stays under the segment.
    expect(g.pval.bottom).toBeLessThanOrEqual(g.mini.bottom + 0.5);
    expect(g.seg.top).toBeGreaterThanOrEqual(g.mini.top - 0.5);
    expect(Math.abs(g.pval.right - g.seg.right)).toBeLessThan(1);
  };
  const market = `$${std.price!.market!.toFixed(2)}`;
  check(await miniGeom(page), market);
  // The whole-pixel text condition (helpers.ts wideText): the segment's
  // condensed labels draw wider; the vertical arrangement must not change.
  await wideText(page);
  check(await miniGeom(page), market);
  // The no-price dash, the other content the price slot can hold.
  const ser = c.variants.find((v) => fin(v) === "Serialized Prestige")!;
  await page.locator(`.m-print[data-variant="${ser.variant_id}"] .m-print__main`).click();
  await expect(page.locator(".m-dreg3--collapsed")).toBeVisible();
  await page.waitForTimeout(350);
  check(await miniGeom(page), "—");
  await wideText(page);
  check(await miniGeom(page), "—");
});
