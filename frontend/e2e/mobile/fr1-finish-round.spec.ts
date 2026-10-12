import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { center, expect, measureEach, scrollBy, test } from "./helpers";
import { fin, openCard, QTY, scrollDetail } from "./card-helpers";
import { addTimes, openPad, openVerify } from "./tool-helpers";

// FR1 (BL-257): mobile 2.0 finish round, slice 1. One named test per item.
test.afterEach(measureEach);

test("fr1-01 search hint fits beside Filters + Clear; clear button clears the text", async ({
  page,
}) => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone search");
  await page.goto("/#/vault?set=SOR");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".m-clearbtn")).toBeVisible();
  await expect(page.locator(".m-filterbtn__n")).toBeVisible();
  const m = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(".m-search__input")!;
    const cs = getComputedStyle(el);
    const ph = getComputedStyle(el, "::placeholder");
    const c = document.createElement("canvas").getContext("2d")!;
    c.font = `${ph.fontStyle} ${ph.fontWeight} ${ph.fontSize} ${ph.fontFamily}`;
    const text = c.measureText(el.placeholder).width;
    const content =
      el.getBoundingClientRect().width -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight) -
      parseFloat(cs.borderLeftWidth) -
      parseFloat(cs.borderRightWidth);
    return { text, content, padR: cs.paddingRight, phSize: ph.fontSize };
  });
  console.log("fr1-01 measure", JSON.stringify(m));
  expect(m.text).toBeLessThanOrEqual(m.content);
  // FR1-01b: a real iPhone's font metrics differ from Chromium's, so the hint
  // needs room to spare, not a bare fit: >= 6 px at 390 (and so at 430).
  expect(m.content - m.text).toBeGreaterThanOrEqual(6);
  // With a value the clear button does not overlap the text area.
  await page.locator(".m-search__input").fill("luke skywalker and a long query string");
  const o = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(".m-search__input")!;
    const cs = getComputedStyle(el);
    const inputR = el.getBoundingClientRect();
    const btn = document.querySelector(".m-search__clear")!.getBoundingClientRect();
    return {
      textRight: inputR.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth),
      btnLeft: btn.left,
    };
  });
  expect(o.textRight).toBeLessThanOrEqual(o.btnLeft + 0.5);
});

// ── FR1-02: one shared pull bar, app blue, scaleX fill, same on both screens ──
const barProbe = (page: Page, sel: string) =>
  page.evaluate((sel) => {
    const bar = document.querySelector<HTMLElement>(sel)!;
    const cs = getComputedStyle(bar);
    const probe = document.createElement("i");
    probe.style.color = "var(--color-primary)";
    document.body.append(probe);
    const primary = getComputedStyle(probe).color;
    probe.remove();
    const pr = bar.parentElement!.getBoundingClientRect();
    const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform);
    return {
      ratio: bar.getBoundingClientRect().width / pr.width,
      layoutW: bar.offsetWidth,
      parentW: bar.parentElement!.offsetWidth,
      bg: cs.backgroundColor,
      primary,
      op: cs.opacity,
      scaleX: m.a,
    };
  }, sel);

/** Finger down at (x, y), dragged `dist` px, left down; call the returned fn to lift. */
async function holdPull(page: Page, x: number, y: number, dist: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (dist * i) / 10 }],
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(450);
  };
}

test("fr1-02 pull bar: app blue, scaleX fill, full layout width, same on vault and card detail", async ({
  page,
}) => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone header");
  // Vault.
  await page.goto("/#/vault");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await scrollBy(page, ".m-vault__scroll", 420);
  await scrollBy(page, ".m-vault__scroll", -900);
  const c = await center(page, ".m-vault__scroll");
  const liftV = await holdPull(page, c.x, c.y, 46);
  const v = await barProbe(page, ".m-vh .m-pullbar");
  await liftV();
  const vAfter = await barProbe(page, ".m-vh .m-pullbar");
  // Card detail.
  await openCard(page, "ASH", 112);
  await scrollDetail(page, 300);
  await scrollDetail(page, -900);
  const b = (await page.locator(".m-detail__body").boundingBox())!;
  const liftD = await holdPull(page, Math.round(b.x + b.width / 2), Math.round(b.y + 120), 46);
  const d = await barProbe(page, ".m-dreg3 .m-pullbar");
  await liftD();
  const dAfter = await barProbe(page, ".m-dreg3 .m-pullbar");
  for (const m of [v, d]) {
    expect(m.ratio).toBeGreaterThan(0.05);
    expect(m.ratio).toBeLessThan(1);
    expect(Math.abs(m.ratio - m.scaleX)).toBeLessThan(0.02);
    expect(m.bg).toBe(m.primary);
    expect(m.layoutW).toBe(m.parentW);
    expect(m.op).toBe("0.9");
  }
  for (const m of [vAfter, dAfter]) {
    expect(m.op).toBe("0");
    expect(m.scaleX).toBe(0);
    expect(m.layoutW).toBe(m.parentW);
  }
});

// ── FR1-03: the Verify sheet's remove control is desktop's x, not a stepper ──
test("fr1-03 verify remove control is a muted x (no stepper look), 44 px, removes one copy", async ({
  page,
}) => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 2);
  await openVerify(page);
  const rm = page.locator('.m-sheet-layer--verify .m-vsec[data-section="add"] .m-vfyrow__remove');
  await expect(rm).toHaveCount(2);
  await expect(rm.first()).toHaveText("×");
  expect(await rm.first().evaluate((e) => e.classList.contains("m-step"))).toBe(false);
  const box = (await rm.first().boundingBox())!;
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  const css = await rm.first().evaluate((e) => {
    const cs = getComputedStyle(e);
    return { bg: cs.backgroundColor, clip: cs.clipPath, radius: cs.borderTopLeftRadius };
  });
  expect(css.bg).toBe("rgba(0, 0, 0, 0)");
  expect(css.clip).toBe("none");
  expect(css.radius).toBe("3px");
  await rm.first().click();
  await expect(page.locator(".m-sheet-layer--verify .m-sheet__sub")).toHaveText(
    "1 card in this batch"
  );
  await expect(rm).toHaveCount(1);
});

// ── FR1-06: tapping anywhere on a variant row selects it ──
/** A real tap at the element's centre (Playwright's click() refuses targets
 * the stretched button covers, which is exactly the point of the change). */
async function tapCentre(page: Page, sel: string) {
  const loc = page.locator(sel);
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(250);
}

test("fr1-06 a tap anywhere on a variant row selects it; the stepper keeps its own action", async ({
  page,
}) => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
  const c = await openCard(page, "ASH", 112);
  await scrollDetail(page, 520);
  const ids = c.variants.map((v) => v.variant_id);
  const row = (id: number) => `.m-print[data-variant="${id}"]`;
  const selectedId = () =>
    page.locator(".m-print.cp-rail__item--active").getAttribute("data-variant");
  const start = Number(await selectedId());
  const [a, b] = ids.filter((id) => id !== start);
  // Price cell of an unselected row selects it; art/plate follow.
  const artBefore = await page.locator(".m-dreg__img").getAttribute("src");
  await tapCentre(page, `${row(a)} .m-print__price`);
  expect(Number(await selectedId())).toBe(a);
  await expect(page.locator(`${row(a)} .m-print__main`)).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".m-dreg__img").getAttribute("src")).not.toBe(artBefore);
  await expect(page.locator(".m-dreg3__own .gallery-plate__total")).toHaveText(
    String(QTY.get(a) ?? 0)
  );
  await expect(page.locator(".m-dreg__fin")).not.toHaveText("");
  // x N cell of another unselected row selects it.
  await scrollDetail(page, 0);
  await tapCentre(page, `${row(b)} .m-print__qtyslot`);
  expect(Number(await selectedId())).toBe(b);
  // + and - on the selected row keep their own action and do not change the
  // selection. Deterministic target: the Hyperspace Foil printing (owned 1,
  // hard limit 3 in the fixtures), so + is always enabled.
  const hf = c.variants.find((v) => fin(v) === "Hyperspace Foil")!.variant_id;
  expect(QTY.get(hf)).toBe(1);
  await scrollDetail(page, 0);
  // (The x N slot exists only while the row is unselected.)
  if (Number(await selectedId()) !== hf) await tapCentre(page, `${row(hf)} .m-print__qtyslot`);
  expect(Number(await selectedId())).toBe(hf);
  const qtyEl = page.locator(`${row(hf)} .m-step__qty`);
  await expect(qtyEl).toHaveText("1");
  const inc = page.locator(`${row(hf)} .m-step[aria-label^="Increment"]`);
  const dec = page.locator(`${row(hf)} .m-step[aria-label^="Decrement"]`);
  await expect(inc).toBeEnabled();
  await tapCentre(page, `${row(hf)} .m-step[aria-label^="Increment"]`);
  await expect(qtyEl).toHaveText("2");
  expect(Number(await selectedId())).toBe(hf);
  await tapCentre(page, `${row(hf)} .m-step[aria-label^="Decrement"]`);
  await expect(qtyEl).toHaveText("1");
  await expect(dec).toBeEnabled();
  expect(Number(await selectedId())).toBe(hf);
});

test("fr1-06 the read-only (shared) row still selects from its price cell", async ({ page }) => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone shared vault");
  const SH = '.m-app__screen[data-pane="shared"]';
  await page.goto("/shared/tok-1#/vault");
  await expect(page.locator(`${SH} .m-row`).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.locator(`${SH} .m-row .m-row__main`).first().click();
  const rows = page.locator(".m-cardlayer .m-page:not(.m-page--ghost) .m-print");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  test.skip(n < 2, "fixture card has one printing");
  await expect(page.locator(".m-cardlayer .m-step")).toHaveCount(0);
  const target = rows.nth(1);
  await target.scrollIntoViewIfNeeded();
  const b = (await target.locator(".m-print__price").boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(target).toHaveClass(/cp-rail__item--active/);
});

// ── FR1-05: red only PAST the limit (the phone half of the surviving rule) ──
test("fr1-05 hard cap past the limit is red", async ({ page }) => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
  // Hard cap, Standard keep-limit lowered to 1 beneath the 2 copies of ASH 112
  // Standard: the count is past its limit, so it is red (--color-danger).
  const limits = JSON.parse(readFileSync("e2e/mobile/fixtures/limits.json", "utf8")) as {
    cap_mode: string;
    limits: { type_category: string; limit_bucket: string; max_quantity: number }[];
  };
  limits.cap_mode = "hard";
  for (const l of limits.limits)
    if (l.type_category === "standard" && l.limit_bucket === "Standard") l.max_quantity = 1;
  await page.route(
    (u) => u.pathname === "/api/settings/limits",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(limits) })
  );
  await openCard(page, "ASH", 112);
  const active = ".m-print.cp-rail__item--active";
  const qty = page.locator(`${active} .m-step__qty`);
  await expect(qty).toHaveText("2");
  const danger = await page.evaluate(() => {
    const el = document.createElement("span");
    el.style.color = "var(--color-danger)";
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  });
  expect(danger).toBe("rgb(248, 113, 113)");
  expect(await qty.evaluate((e) => getComputedStyle(e).color)).toBe(danger);
  await expect(page.locator(`${active} .m-step[aria-label^="Increment"]`)).toBeDisabled();
  await expect(page.locator(".cp-plate__over-limit-tag")).toHaveCount(0);
});
