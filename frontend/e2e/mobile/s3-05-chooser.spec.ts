import { expect, measureEach, test } from "./helpers";
import { SETS } from "./fixture-cards";
import { openPad, pickSet, typeNum } from "./tool-helpers";

// S3-05 (R5-6 + F-3): the "Choose a set" sheet opens with two collapsed
// choosers (Set / Precon deck); the set list is desktop's grouping
// (setGrouping.ts; rev4 f-3-set-picker-desktop-grouping, r4-4-pad-set-all-
// toggle); the deck list is desktop's 23 entries; picking locks the keypad
// (r4-4-pad-subset-resolves). S3-06: Card details from the keypad keeps the
// batch.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

const CANON = ["SOR", "SHD", "TWI", "JTL", "LOF", "SEC", "LAW", "ASH", "HMW"];
const SECOND = ["IBH", "TS26"];
const EX: [string, string[]][] = [
  ["Convention Exclusives", ["C24", "C25", "C26"]],
  ["Judge Program", ["J24", "J25"]],
  ["Promos", ["P25", "P26"]],
  ["Other promos", ["G25", "MV26", "GG", "CST"]],
];
const HAS = new Set(SETS.map((s) => s.code));

test("s3-05-two-collapsed-choosers", async ({ page }) => {
  await openPad(page);
  await page.locator(".m-pad__entry .m-padset").click();
  const sheet = page.locator(".m-sheet-layer--setpick");
  await expect(sheet.locator(".m-sheet__title")).toHaveText("Choose a set");
  const choosers = sheet.locator(".m-setchooser");
  await expect(choosers).toHaveCount(2);
  await expect(choosers.locator(".m-setchooser__label")).toHaveText(["Set", "Precon deck"]);
  await expect(choosers.nth(0)).toHaveAttribute("aria-expanded", "false");
  await expect(choosers.nth(1)).toHaveAttribute("aria-expanded", "false");
  await expect(sheet.locator(".m-setpick, .m-d2-decks")).toHaveCount(0);
  const order = await choosers.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(order[1]).toBeGreaterThan(order[0]);
  // X top-right.
  const x = await sheet.locator(".m-sheet__close").boundingBox();
  expect(x!.x + x!.width).toBeGreaterThan(page.viewportSize()!.width - 30);
  // Tapping one expands it in place and folds the other.
  await choosers.nth(0).click();
  await expect(sheet.locator(".m-setpick")).toBeVisible();
  await choosers.nth(1).click();
  await expect(sheet.locator(".m-setpick")).toHaveCount(0);
  await expect(sheet.locator(".m-d2-decks")).toBeVisible();
});

test("s3-05-set-grouping", async ({ page }) => {
  await openPad(page);
  await page.locator(".m-pad__entry .m-padset").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-set"]').click();
  const s = page.locator(".m-setpick");
  await expect(s).toHaveAttribute("data-view", "base");
  await expect(page.locator(".m-setpick__all")).toHaveText("Show all sets");
  const base = await s.evaluate((el) => ({
    top: [...el.children]
      .filter((e) => e.classList.contains("m-setpick__row"))
      .map((b) => (b as HTMLElement).dataset.code),
    sec: [...el.querySelectorAll('[data-tail="secondary"] .m-setpick__row')].map(
      (b) => (b as HTMLElement).dataset.code
    ),
    divider: !!el.querySelector('[data-tail="secondary"] .m-fdivider'),
  }));
  expect(base.top).toEqual(CANON.filter((c) => HAS.has(c)));
  expect(base.sec).toEqual(SECOND.filter((c) => HAS.has(c)));
  expect(base.divider).toBe(true);
  await expect(s.locator('[data-code="LAWP"]')).toHaveCount(0);

  await page.locator(".m-setpick__all").click();
  await expect(s).toHaveAttribute("data-view", "all");
  await expect(page.locator(".m-setpick__all")).toHaveText("Base sets only");
  const all = await s.evaluate((el) => ({
    groups: [...el.querySelectorAll(".m-setpick__rgroup")].map((g) => ({
      base: (g as HTMLElement).dataset.base,
      codes: [...g.querySelectorAll(".m-setpick__row")].map((b) => (b as HTMLElement).dataset.code),
      sub: [...g.querySelectorAll(".m-setpick__row--sub")].map(
        (b) => (b as HTMLElement).dataset.code
      ),
    })),
    ex: [...el.querySelectorAll('[data-tail="exclusives"] .m-setpick__sub')].map((x) => ({
      g: x.querySelector(".m-setpick__g")!.textContent,
      c: [...x.querySelectorAll(".m-setpick__row")].map((b) => (b as HTMLElement).dataset.code),
    })),
    exDivider: !!el.querySelector('[data-tail="exclusives"] .m-fdivider'),
    all: [...el.querySelectorAll(".m-setpick__row")].map((b) => (b as HTMLElement).dataset.code),
  }));
  expect(all.groups).toEqual(
    [...CANON, ...SECOND]
      .filter((c) => HAS.has(c))
      .map((b) => ({
        base: b,
        codes: HAS.has(b + "P") ? [b, b + "P"] : [b],
        sub: HAS.has(b + "P") ? [b + "P"] : [],
      }))
  );
  expect(all.ex).toEqual(
    EX.map(([g, cs]) => ({ g, c: cs.filter((c) => HAS.has(c)) })).filter((x) => x.c.length)
  );
  expect(all.exDivider).toBe(true);
  // Every set the API returns is listed.
  expect([...HAS].filter((c) => !all.all.includes(c))).toEqual([]);
  // Rows are 44 px+ targets; a Weekly Play row nests under its base.
  const subH = await s.locator(".m-setpick__row--sub").first().boundingBox();
  expect(subH!.height).toBeGreaterThanOrEqual(44);
});

test("s3-05-precon-list-23", async ({ page }) => {
  await openPad(page);
  await page.locator(".m-pad__entry .m-padset").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-precon"]').click();
  const rows = page.locator(".m-d2-decks .m-d2-deck");
  await expect(rows).toHaveCount(23);
  const h = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.min(...h)).toBeGreaterThanOrEqual(58);
  await expect(rows.first().locator(".m-d2-deck__product")).toBeVisible();
  await expect(page.locator('.m-d2-deck[data-deck="IBH"] .m-d2-deck__product')).toHaveText(
    "Whole box · 2 decks"
  );
  // Picking a deck locks the keypad to it: the set button reads the deck,
  // the number field reads Deck, the keys rest.
  await page.locator('.m-d2-deck[data-deck="SOR-VADER"]').click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
  await expect(page.locator(".m-padset__code")).toHaveText("Vader");
  await expect(page.locator(".m-padnum__val")).toHaveText("Deck");
  await expect(page.locator(".m-key").first()).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".m-d2-precon__facts")).toHaveText(/^\d+ cards · \d+ distinct$/);
  // Change set returns to the two collapsed choosers; picking a set unlocks.
  await page.locator(".m-d2-precon__change").click();
  await expect(page.locator(".m-setchooser[aria-expanded=false]")).toHaveCount(2);
  await page.locator('.m-setchooser[aria-controls="m-setchooser-set"]').click();
  await page.locator('.m-setpick__row[data-code="SHD"]').click();
  await expect(page.locator(".m-padset__code")).toHaveText("SHD");
  await expect(page.locator(".m-padnum__val")).toHaveText("000");
});

test("s3-05-subset-resolves", async ({ page }) => {
  await openPad(page);
  await pickSet(page, "LAWP", true);
  await expect(page.locator(".m-padset__code")).toHaveText("LAWP");
  await expect(page.locator(".m-padset")).toHaveClass(/m-padset--sub/);
  await expect(page.locator(".m-padset__logo")).toHaveAttribute("src", "/images/set_LAW.png");
  await typeNum(page, 13);
  await expect(page.locator(".m-ident__name")).toHaveText("C-3PO");
  await expect(page.locator(".m-ident__meta")).toHaveText("LAWP 13 · Weekly Play");
  // An exclusive shows its code alone.
  await pickSet(page, "C24", true);
  await expect(page.locator(".m-padset")).toHaveClass(/m-padset--nologo/);
  await expect(page.locator(".m-padset__logo")).toHaveCount(0);
});

test("s3-06-card-details-keeps-batch", async ({ page }) => {
  await openPad(page, "#/pad?set=SOR&num=87");
  await page.locator(".m-ident__add .swu-btn").click();
  await expect(page.locator(".m-pad__entry .m-logbtn__n")).toHaveText("1");
  await typeNum(page, 229);
  await page.locator(".m-ident__details").click();
  await expect(page).toHaveURL(/#\/card\/131\?v=6571$/);
  await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  // No guard: the card layer opens straight over the tool.
  await expect(page.locator(".m-d2-confirm")).toHaveCount(0);
  await page.locator(".m-hdr__close").click();
  await expect(page).toHaveURL(/#\/pad/);
  await expect(page.locator(".m-cardlayer")).toHaveCount(0);
  await expect(page.locator(".m-pad__entry .m-logbtn__n")).toHaveText("1");
  await expect(page.locator(".m-padnum__val")).toHaveText("229");
  await expect(page.locator(".m-ident__name")).toHaveText("Cell Block Guard");
});
