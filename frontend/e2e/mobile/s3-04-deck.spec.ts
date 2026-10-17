import type { Page } from "@playwright/test";
import { expect, measureEach, test } from "./helpers";
import { deckMetrics, foldTab, key, openPad, typeNum } from "./tool-helpers";

// S3-04 (R4-6 parts 2-3, ADR-0032 / BL-270): the deck KEEPS its size when a
// result shows (58 px keys, 56 px entry row); the Card details / Add row is
// pinned at the result zone's bottom and the zone scrolls; when the zone's
// content does not fit, a fold tab on the deck's top edge shrinks the deck
// (44 / 48 px, one class flip, no height transition) and restores it; the
// choice sticks for the session. A shared number compacts the panel; a
// finish-only share keeps desktop's non-foil default (BL-191) with the verify
// cue and a Change link. Seeded from rev4 r4-6-add-row-visible-worst-case
// (-h714). Dispositions (BL-270): s3-04-deck-shrinks -> replaced by
// s3-04-deck-keeps-size; s3-04-deck-restores -> replaced by
// s3-04-fold-sticky; the worst-case pair ported (full deck; the unscrolled
// choices guarantee now follows a Shrink tap).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

/** Geometry of the zone, its pinned Add row and the fold tab. */
function zoneGeometry(page: Page) {
  return page.evaluate(() => {
    const zone = document.querySelector(".m-pad__zone")!;
    const z = zone.getBoundingClientRect();
    const add = document.querySelector(".m-pad__zone .m-ident__add")!.getBoundingClientRect();
    const btn = document
      .querySelector(".m-pad__zone .m-ident__add .swu-btn")!
      .getBoundingClientRect();
    const tab = document.querySelector(".m-padfold__tab")?.getBoundingClientRect() ?? null;
    const face = document.querySelector(".m-padfold__face")?.getBoundingClientRect() ?? null;
    const deck = document.querySelector(".m-pad__deck")!.getBoundingClientRect();
    return {
      zoneTop: z.top,
      zoneBottom: z.bottom,
      addTop: add.top,
      addBottom: add.bottom,
      btnBottom: btn.bottom,
      tabTop: tab ? tab.top : null,
      tabBottom: tab ? tab.bottom : null,
      tabW: tab ? Math.round(tab.width) : null,
      faceBottom: face ? face.bottom : null,
      deckTop: deck.top,
      overflows: zone.scrollHeight > zone.clientHeight + 1,
      scrollTop: zone.scrollTop,
    };
  });
}

test("s3-04-deck-keeps-size", async ({ page }) => {
  await openPad(page);
  const before = await deckMetrics(page);
  await typeNum(page, 2);
  await page.waitForTimeout(200);
  const after = await deckMetrics(page);
  expect(before).toMatchObject({ key: 58, num: 56, compact: false, tab: false });
  // A resolved number no longer shrinks the deck (ADR-0032 decision 1).
  expect(after).toMatchObject({ key: 58, num: 56, compact: false });
  expect(after.deck).toBe(before.deck);
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
      const panel = await page.evaluate(() => {
        const chips = [...document.querySelectorAll(".m-pad__zone .m-chip--print")].map((c) =>
          c.getBoundingClientRect()
        );
        return {
          chips: chips.length,
          chipH: Math.min(...chips.map((c) => c.height)),
          art: Math.round(document.querySelector(".m-ident__art")!.getBoundingClientRect().width),
          twoCol:
            getComputedStyle(
              document.querySelector(".m-ident__chiprow")!
            ).gridTemplateColumns.split(" ").length === 2,
          sticky: getComputedStyle(document.querySelector(".m-pad__zone .m-ident__add")!).position,
        };
      });
      expect(panel.chips).toBe(3);
      expect(panel.chipH).toBeGreaterThanOrEqual(44);
      expect(panel.art).toBe(92);
      expect(panel.twoCol).toBe(true);
      expect(panel.sticky).toBe("sticky");
      // Full-size deck: the Add row is pinned inside the zone.
      expect(await deckMetrics(page)).toMatchObject({ key: 58, compact: false });
      const g = await zoneGeometry(page);
      expect(g.addTop).toBeGreaterThanOrEqual(g.zoneTop);
      expect(g.addBottom).toBeLessThanOrEqual(g.zoneBottom + 0.5);
      expect(g.btnBottom).toBeLessThanOrEqual(g.zoneBottom + 0.5);
      if (g.overflows) {
        // The tab shows, stands on the deck's top edge (its 44 px tap area
        // reaches 6 px into the deck's top padding) and never covers the Add
        // button.
        await expect(foldTab(page)).toHaveAttribute("aria-label", "Shrink keypad");
        expect(Math.abs(g.faceBottom! - g.deckTop)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(g.tabBottom! - (g.deckTop + 6))).toBeLessThanOrEqual(0.5);
        expect(g.tabTop!).toBeGreaterThanOrEqual(g.btnBottom - 0.5);
        expect(g.tabW).toBe(76);
      } else await expect(foldTab(page)).toHaveCount(0);
      if (!h) {
        // 844: after Shrink, the hint and every choice sit above the pinned
        // row, unscrolled (+12.5: the row's fade band) -- R4-6's guarantee,
        // now the user's choice.
        if (g.overflows) await foldTab(page).click();
        const r = await page.evaluate(() => ({
          lastChipBottom: Math.max(
            ...[...document.querySelectorAll(".m-pad__zone .m-chip--print")].map(
              (c) => c.getBoundingClientRect().bottom
            )
          ),
          hintTop: document.querySelector(".m-ident__choicehint")!.getBoundingClientRect().top,
        }));
        const g2 = await zoneGeometry(page);
        expect(r.lastChipBottom).toBeLessThanOrEqual(g2.addTop + 12.5);
        expect(r.hintTop).toBeGreaterThanOrEqual(g2.zoneTop);
        expect(g2.scrollTop).toBe(0);
        expect(g2.btnBottom).toBeLessThanOrEqual(g2.zoneBottom + 0.5);
      }
      if (h) await page.setViewportSize(vp);
    }
  );
}

test("s3-04-zone-scrolls-with-add-pinned", async ({ page }) => {
  // 714 tall: SOR 2 does not fit above the full deck -- the zone scrolls and
  // the Add row stays in view while it does (shrinking is optional).
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: 714 });
  await openPad(page, "#/pad?set=SOR&num=2");
  await page.waitForTimeout(250);
  const g = await zoneGeometry(page);
  expect(g.overflows).toBe(true);
  await page.locator(".m-pad__zone").evaluate((z) => (z.scrollTop = 10000));
  const s = await zoneGeometry(page);
  expect(s.scrollTop).toBeGreaterThan(0);
  expect(s.btnBottom).toBeLessThanOrEqual(s.zoneBottom + 0.5);
  expect(await deckMetrics(page)).toMatchObject({ key: 58, compact: false });
  await page.setViewportSize(vp);
});

test("s3-04-fold-sticky", async ({ page }) => {
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: 714 });
  await openPad(page);
  expect(await deckMetrics(page)).toMatchObject({ key: 58, tab: false }); // idle fits
  await typeNum(page, 2);
  await expect(foldTab(page)).toHaveAttribute("aria-pressed", "false");
  await foldTab(page).click();
  const shrunk = await deckMetrics(page);
  expect(shrunk).toMatchObject({ key: 44, num: 48, compact: true, tab: true });
  expect(shrunk.tr).not.toMatch(/height|all/);
  await expect(foldTab(page)).toHaveAttribute("aria-label", "Restore keypad");
  await expect(foldTab(page)).toHaveAttribute("aria-pressed", "true");
  // Sticks across Clear (idle content fits; the tab stays to restore) ...
  await key(page, "Clear number");
  expect(await deckMetrics(page)).toMatchObject({ key: 44, compact: true, tab: true });
  // ... a new card and an Add.
  await typeNum(page, 87);
  expect(await deckMetrics(page)).toMatchObject({ key: 44, compact: true });
  await page.locator(".m-ident__add .swu-btn").click();
  await expect(page.locator(".m-ident__add")).toContainText("Add another");
  expect(await deckMetrics(page)).toMatchObject({ key: 44, compact: true });
  // Restore: full size, and it stays full on the next card.
  await foldTab(page).click();
  expect(await deckMetrics(page)).toMatchObject({ key: 58, num: 56, compact: false });
  await key(page, "Clear number");
  await typeNum(page, 2);
  expect(await deckMetrics(page)).toMatchObject({ key: 58, compact: false, tab: true });
  // A fresh load starts at full size (a real reload: a hash-only goto keeps
  // the document and its module state).
  await foldTab(page).click();
  expect(await deckMetrics(page)).toMatchObject({ compact: true });
  await page.reload();
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  expect(await deckMetrics(page)).toMatchObject({ key: 58, compact: false });
  await page.setViewportSize(vp);
});

test("s3-04-fold-precon-and-miss", async ({ page }) => {
  // The tab rule applies to every zone content: "Not in this set" and the
  // precon panel never shrink the deck on their own.
  await openPad(page);
  await typeNum(page, 57);
  await expect(page.locator(".m-padmsg__err")).toHaveText("Not in this set");
  expect(await deckMetrics(page)).toMatchObject({ key: 58, compact: false });
  await page.locator(".m-pad__entry .m-padset").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-precon"]').click();
  await page.locator('.m-d2-deck[data-deck="SOR-VADER"]').click();
  await expect(page.locator(".m-d2-precon")).toBeVisible();
  expect(await deckMetrics(page)).toMatchObject({ key: 58, compact: false });
  const pinned = await page.evaluate(() => {
    const z = document.querySelector(".m-pad__zone")!.getBoundingClientRect();
    const a = document.querySelector(".m-pad__zone .m-d2-precon__actions")!.getBoundingClientRect();
    return a.bottom <= z.bottom + 0.5 && a.top >= z.top;
  });
  expect(pinned).toBe(true);
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
