import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import { byNum, fin, openCard, scrollDetail } from "./card-helpers";

// S2-06: the card text (rev4 card-text) and the pinned price line
// (card-price-pinned: the collapsed region's price + Market / Low stays at
// the top while the body scrolls; segment drawn 34 / tapped 44; em dash).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

test("s2-06-text-and-price", async ({ page }) => {
  // card-text: SOR 10 Darth Vader (leader), with a detail payload carrying
  // text (the committed fixture's detail rows have none).
  const vader = byNum("SOR", 10);
  const raw = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
    id: number;
    [k: string]: unknown;
  }[];
  const slim = raw.find((x) => x.id === vader.id)!;
  await page.route(
    (u) => u.pathname === `/api/base-cards/${vader.id}`,
    (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...slim,
          set_name: "Spark of Rebellion",
          type2: "Leader Unit",
          double_sided: true,
          is_unique: true,
          front_text: "Action [1 resource]: Deal 1 damage to a unit.",
          back_text: "On Attack: You may deal 1 damage to a unit.",
          epic_action: "If you have 6 or more resources, deploy this leader.",
          artist: "Borja Pindado",
          variants: (slim.variants as object[]).map((v) => ({
            ...v,
            stamped: false,
            source_set_name: "",
            stamp_group: null,
            quantity: 0,
          })),
        }),
      })
  );
  await openCard(page, "SOR", 10);
  const text = page.locator(".m-info .cp-text");
  await text.scrollIntoViewIfNeeded();
  await expect(text.locator(".cp-text__body").first()).toHaveText(
    "Action [1 resource]: Deal 1 damage to a unit."
  );
  await expect(text.locator(".cp-text__epic-label")).toHaveText("Epic Action:");
  await expect(text.locator(".cp-text__header")).toHaveText(["Leader", "Leader Unit"]);
  await expect(text.locator(".cp-text__back .cp-text__body")).toHaveText(
    "On Attack: You may deal 1 damage to a unit."
  );
  // Desktop's steel ring + inner panel.
  const ring = await text.evaluate((e) => ({
    bg: getComputedStyle(e).backgroundColor,
    inner: getComputedStyle(e.firstElementChild!).backgroundColor,
  }));
  expect(ring).toEqual({ bg: "rgba(211, 211, 212, 0.28)", inner: "rgb(13, 16, 28)" });
  await expect(page.locator(".m-info__setname")).toHaveText("Spark of Rebellion");
  await expect(page.locator(".m-facts__row", { hasText: "Artist" }).locator("dd")).toHaveText(
    "Borja Pindado"
  );

  // card-price-pinned on ASH 112 (long enough to collapse by scrolling).
  const c = await openCard(page, "ASH", 112);
  await scrollDetail(page, 300);
  const mini = page.locator(".m-dreg3__mini");
  const y0 = (await mini.boundingBox())!.y;
  await scrollDetail(page, 400);
  expect((await mini.boundingBox())!.y).toBe(y0);
  const std = c.variants.find((v) => fin(v) === "Standard")!;
  await expect(mini.locator(".m-dreg__pval")).toHaveText(`$${std.price!.market!.toFixed(2)}`);
  // Segment drawn 34, every button a 44 px target.
  const seg = await mini.locator(".m-seg").evaluate((e) => {
    const b = e.getBoundingClientRect();
    const before = getComputedStyle(e, "::before");
    return {
      drawn: b.height - parseFloat(before.top) - parseFloat(before.bottom),
      btns: [...e.querySelectorAll("button")].map((x) => x.getBoundingClientRect().height),
    };
  });
  expect(seg.drawn).toBe(34);
  for (const h of seg.btns) expect(h).toBeGreaterThanOrEqual(44);
  // No price -> an em dash in the muted colour (Serialized Prestige).
  const ser = c.variants.find((v) => fin(v) === "Serialized Prestige")!;
  expect(ser.price?.market ?? null).toBeNull();
  await page.locator(`.m-print[data-variant="${ser.variant_id}"] .m-print__main`).click();
  await expect(mini.locator(".m-dreg__pval")).toHaveText("—");
  expect(await mini.locator(".m-dreg__pval").evaluate((e) => getComputedStyle(e).color)).toBe(
    "rgb(107, 122, 153)"
  );
  await expect(
    page.locator(`.m-print[data-variant="${ser.variant_id}"] .m-print__price`)
  ).toHaveText("—");
});
