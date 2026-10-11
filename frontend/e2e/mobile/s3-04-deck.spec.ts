import { expect, measureEach, test } from "./helpers";
import { deckMetrics, key, openPad, typeNum } from "./tool-helpers";

// S3-04 (R4-6, collide=deck): while a result shows the deck shrinks (keys
// 44 px, entry row 48 px, one class flip, no height transition) and the
// Card details / Add row is pinned at the result zone's bottom; a shared
// number compacts the panel; a finish-only share keeps desktop's non-foil
// default (BL-191) with the verify cue and a Change link. Seeded from rev4
// r4-6-deck-shrinks, r4-6-add-row-visible-worst-case(-h714),
// r4-6-deck-restores.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

test("s3-04-deck-shrinks", async ({ page }) => {
  await openPad(page);
  const before = await deckMetrics(page);
  await typeNum(page, 2);
  await page.waitForTimeout(200);
  const after = await deckMetrics(page);
  expect(before).toMatchObject({ key: 58, num: 56, result: false });
  expect(after).toMatchObject({ key: 44, num: 48, result: true });
  expect(after.deck).toBeLessThan(before.deck - 40);
  expect(after.tr).not.toMatch(/height|all/);
});

for (const h of [0, 714]) {
  test(
    h ? "s3-04-add-row-visible-worst-case-h714" : "s3-04-add-row-visible-worst-case",
    async ({ page }) => {
      // Worst case in the catalogue: SOR 2 -- three cards share the number
      // (desktop's Which card? axis: two Darth Vaders + Luke Skywalker).
      const vp = page.viewportSize()!;
      if (h) await page.setViewportSize({ width: vp.width, height: h });
      await openPad(page, "#/pad?set=SOR&num=2");
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const zone = document.querySelector(".m-pad__zone")!.getBoundingClientRect();
        const add = document.querySelector(".m-pad__zone .m-ident__add")!.getBoundingClientRect();
        const btn = document
          .querySelector(".m-pad__zone .m-ident__add .swu-btn")!
          .getBoundingClientRect();
        const chips = [...document.querySelectorAll(".m-pad__zone .m-chip--print")].map((c) =>
          c.getBoundingClientRect()
        );
        const hint = document.querySelector(".m-ident__choicehint")!.getBoundingClientRect();
        const art = document.querySelector(".m-ident__art")!.getBoundingClientRect();
        return {
          zoneTop: zone.top,
          zoneBottom: zone.bottom,
          addTop: add.top,
          addBottom: add.bottom,
          btnBottom: btn.bottom,
          chips: chips.length,
          chipH: Math.min(...chips.map((c) => c.height)),
          lastChipBottom: Math.max(...chips.map((c) => c.bottom)),
          hintTop: hint.top,
          art: Math.round(art.width),
          twoCol:
            getComputedStyle(
              document.querySelector(".m-ident__chiprow")!
            ).gridTemplateColumns.split(" ").length === 2,
          scrollTop: document.querySelector(".m-pad__zone")!.scrollTop,
          sticky: getComputedStyle(document.querySelector(".m-pad__zone .m-ident__add")!).position,
        };
      });
      expect(r.chips).toBe(3);
      expect(r.chipH).toBeGreaterThanOrEqual(44);
      expect(r.art).toBe(92);
      expect(r.twoCol).toBe(true);
      expect(r.sticky).toBe("sticky");
      expect(r.addTop).toBeGreaterThanOrEqual(r.zoneTop);
      expect(r.addBottom).toBeLessThanOrEqual(r.zoneBottom + 0.5);
      expect(r.btnBottom).toBeLessThanOrEqual(r.zoneBottom + 0.5);
      if (!h) {
        // 844: the hint and every choice sit above the pinned row, unscrolled
        // (+12.5: the row's fade band).
        expect(r.lastChipBottom).toBeLessThanOrEqual(r.addTop + 12.5);
        expect(r.hintTop).toBeGreaterThanOrEqual(r.zoneTop);
        expect(r.scrollTop).toBe(0);
      }
      if (h) await page.setViewportSize(vp);
    }
  );
}

test("s3-04-deck-restores", async ({ page }) => {
  await openPad(page);
  const idle = await deckMetrics(page);
  await typeNum(page, 2);
  const shrunk = await deckMetrics(page);
  await key(page, "Clear number");
  const cleared = await deckMetrics(page);
  await typeNum(page, 87);
  const shrunk2 = await deckMetrics(page);
  await page.locator(".m-ident__add .swu-btn").click();
  const added = await deckMetrics(page);
  expect(idle).toMatchObject({ key: 58, result: false });
  expect(shrunk).toMatchObject({ key: 44, result: true });
  expect(cleared).toMatchObject({ key: 58, num: 56, result: false });
  expect(shrunk2.result).toBe(true);
  expect(added).toMatchObject({ key: 58, num: 56, result: false });
  // The card just added shows with "Add another", its row still in the zone.
  const addRow = page.locator(".m-pad__zone .m-ident__add");
  await expect(addRow).toContainText("Add another");
  const inZone = await page.evaluate(
    () =>
      document.querySelector(".m-pad__zone .m-ident__add")!.getBoundingClientRect().bottom <=
      document.querySelector(".m-pad__zone")!.getBoundingClientRect().bottom + 0.5
  );
  expect(inZone).toBe(true);
});

test("s3-04-finish-share-nonfoil-default", async ({ page }) => {
  // SOR 35: Standard and Standard Foil share the number; Hyperspace is 301.
  await openPad(page, "#/pad?set=SOR&num=35");
  await expect(page.locator(".m-ident__meta")).toHaveText("SOR 35 · Standard");
  const note = page.locator(".m-ident__note .m-ident__notel--attn");
  await expect(note).toContainText("Card number is shared across variants. Verify selection.");
  expect(await note.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(217, 154, 31)");
  await expect(page.locator(".m-chip--print")).toHaveCount(0);
  await expect(page.locator(".m-ident__add .swu-btn")).toHaveText("Add to batch");
  await page.locator(".m-ident__change").click();
  const chips = page.locator(".m-ident__axis[data-axis=finish] .m-chip--print");
  await expect(chips).toHaveText(["Standard", "Standard Foil"]);
  await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(chips.nth(0)).toHaveClass(/m-chip--attn/);
  await chips.nth(1).click();
  await expect(page.locator(".m-ident__meta")).toHaveText("SOR 35 · Standard Foil");
  await expect(page.locator(".m-ident__choicehint--attn")).toHaveCount(0);
});
