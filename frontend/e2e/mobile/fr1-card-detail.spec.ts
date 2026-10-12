import type { Page } from "@playwright/test";
import { expect, measureEach, test } from "./helpers";
import { byNum, fin, openCard, scrollDetail } from "./card-helpers";

// FR1 stage 1b (BL-257): the card-detail items of the mobile 2.0 finish round
// (FR1-07 plate, FR1-08 caption, FR1-09 collapsed row). Stage 1a's items are
// in fr1-finish-round.spec.ts. One named test per item.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

// ── FR1-07: the card-detail plate is the gallery plate, scoped to the printing ──
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

test("fr1-07 card-detail plate = the gallery plate scoped to the selected printing", async ({
  page,
}) => {
  // ASH 52 Chimaera (playset 3): only its one Hyperspace printing is owned,
  // at each quantity in turn, so the gallery tile of a Hyperspace-scoped Vault
  // and the detail's plate describe the same number.
  const c = byNum("ASH", 52);
  const hs = c.variants.find((v) => fin(v) === "Hyperspace")!;
  let q = 0;
  await page.route(
    (u) => u.pathname === "/api/inventory/quantities",
    (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ variant_id: hs.variant_id, quantity: q }]),
      })
  );
  const cell = `.m-cell[data-card="${c.id}"]`;
  for (q of [0, 1, 3, 4]) {
    await page.goto("about:blank");
    await page.goto("/#/vault?view=gallery&finish=Hyperspace");
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
    await expect(page.locator(".m-print.cp-rail__item--active")).toHaveAttribute(
      "data-variant",
      String(hs.variant_id)
    );
    const own = await plateShape(page, ".m-cardlayer .m-dreg3__own");
    const mini = await plateShape(page, ".m-cardlayer .m-dreg3__mini");
    const n = q;
    await test.step(`quantity ${n}`, () => {
      expect(own.hasPips).toBe(1);
      expect(own.total).toBe(String(n));
      expect(own.oldIdiom + mini.oldIdiom).toBe(0);
      // Same classes and total as the gallery tile, in both plates.
      expect(own).toEqual(tile);
      expect(mini).toEqual(tile);
      // And the states themselves: amber (scoped) pips, complete at a playset.
      expect(own.pips).toHaveLength(3);
      expect(own.pips.filter((p) => p.includes("gallery-plate__pip--scoped"))).toHaveLength(
        Math.min(3, n)
      );
      expect(own.plate.includes("gallery-plate--complete")).toBe(n >= 3);
      expect(own.totalCls).toBe(
        "gallery-plate__total" +
          (n >= 3
            ? " gallery-plate__total--complete"
            : n === 0
              ? " gallery-plate__total--empty"
              : "")
      );
    });
    await expect(page.locator(".m-dreg3__own .m-plate-hit--btn")).toHaveAttribute(
      "data-plate-qty",
      String(n)
    );
  }
  // The plate is still the button that opens Owned by finish.
  const btn = page.locator(".m-dreg3__own .m-plate-hit--btn");
  await expect(btn).toHaveAttribute("aria-label", /Show owned by finish$/);
  await btn.click();
  await expect(page.locator(".m-sheet-layer--finish")).toBeVisible();
  await page.locator(".m-sheet-layer--finish .m-sheet__close").click();
  await expect(page.locator(".m-sheet-layer--finish")).toHaveCount(0);
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
  expect(m.own.height).toBeLessThanOrEqual(52);
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
    expect(g.segDrawn).toBe(34);
    for (const h of g.segBtns) expect(h).toBeGreaterThanOrEqual(44);
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
