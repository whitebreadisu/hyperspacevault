import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";
import { byNum, fin, openCard, openVault, QTY, tapRow } from "./card-helpers";

// S2-03: the card-detail plate follows the SELECTED printing. BL-257 FR1-07
// (owner decision 2026-10-12, ADR-0030) REPLACED the R5-5 idiom this spec
// first asserted (the vault-list count chip + 10 px pips inside the steel
// frame): the plate is now the gallery plate scoped to the selected printing.
// Computed colours = cards.css gallery-plate literals (the s1-20 table) for
// empty / short / complete printings of SOR 87 Darth Vader and ASH 52
// Chimaera, in the expanded and the collapsed plate.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

const T = {
  text: "rgb(230, 230, 230)",
  muted: "rgb(107, 122, 153)",
  green: "rgb(31, 163, 71)",
  ring: "rgba(211, 211, 212, 0.35)",
  ringDone: "rgba(31, 163, 71, 0.55)",
  inner: "rgb(11, 14, 24)",
  amber: "rgb(217, 154, 31)",
  amberWash: "rgba(217, 154, 31, 0.08)",
  pipLine: "rgba(230, 230, 230, 0.45)",
  none: "rgba(0, 0, 0, 0)",
};

const readPlate = (page: Page, root: string) =>
  page.evaluate((root) => {
    const el = document.querySelector(root)!;
    const frame = el.querySelector(".gallery-plate")!;
    const inner = frame.querySelector(".gallery-plate__inner")!;
    const tot = frame.querySelector(".gallery-plate__total")!;
    const ts = getComputedStyle(tot);
    const pipsBox = frame.querySelector(".gallery-plate__pips")!;
    return {
      total: {
        text: tot.textContent,
        russo13: /Russo One/.test(ts.fontFamily) && ts.fontSize === "13px",
        color: ts.color,
      },
      pipsLeft: pipsBox.getBoundingClientRect().right <= tot.getBoundingClientRect().left + 0.5,
      frameRing: getComputedStyle(frame).backgroundColor,
      inner: getComputedStyle(inner).backgroundColor,
      plateH: frame.getBoundingClientRect().height,
      oldIdiom: el.querySelectorAll(".playset-chip, .playset__pips").length,
      pips: [...frame.querySelectorAll(".gallery-plate__pip")].map((p) => {
        const ps = getComputedStyle(p);
        return { w: ps.width, fill: ps.backgroundColor, line: ps.borderTopColor };
      }),
      text: frame.textContent,
    };
  }, root);

type State = "empty" | "short" | "complete";
function expectState(r: Awaited<ReturnType<typeof readPlate>>, q: number, size: number, s: State) {
  // The number = the selected printing's count, Russo One at the phone scale.
  expect(r.total.text).toBe(String(q));
  expect(r.total.russo13).toBe(true);
  expect(r.total.color).toBe(s === "complete" ? T.green : s === "empty" ? T.muted : T.text);
  expect(r.pipsLeft).toBe(true);
  // The gallery's complete state at a playset: green ring + amber inner wash.
  expect(r.frameRing).toBe(s === "complete" ? T.ringDone : T.ring);
  expect(r.inner).toBe(s === "complete" ? T.amberWash : T.inner);
  expect(r.plateH).toBe(28);
  // The vault-list idiom is gone from the plate.
  expect(r.oldIdiom).toBe(0);
  expect(r.pips.length).toBe(size);
  r.pips.forEach((p, i) => {
    const on = i < Math.min(q, size);
    expect(p.w).toBe("8px");
    // Scoped idiom: amber while short, green at a playset.
    const want = !on ? T.none : s === "complete" ? T.green : T.amber;
    expect(p.fill).toBe(want);
    expect(p.line).toBe(on ? want : T.pipLine);
  });
  // No fraction on the card surface.
  expect(r.text).not.toMatch(/\d\s*\/\s*\d/);
}

async function select(page: Page, variantId: number) {
  await page.locator(`.m-print[data-variant="${variantId}"] .m-print__main`).click();
  await page.waitForTimeout(120);
}

const OWN = ".m-cardlayer .m-dreg3__own";
const MINI = ".m-cardlayer .m-dreg3__mini";

test("s2-03-plate-follows-printing", async ({ page }) => {
  for (const [set, n, cases] of [
    [
      "SOR",
      87,
      [
        ["Standard", "short"],
        ["Standard Foil", "empty"],
        ["Hyperspace", "short"],
      ],
    ],
    [
      "ASH",
      52,
      [
        ["Standard", "empty"],
        ["Hyperspace", "complete"],
      ],
    ],
  ] as const) {
    const c = await openCard(page, set, n);
    for (const [finish, state] of cases) {
      const v = c.variants.find((x) => fin(x) === finish)!;
      const q = QTY.get(v.variant_id) ?? 0;
      await select(page, v.variant_id);
      // The rail's selection, the caption and both plates agree at once.
      await expect(page.locator(".m-print.cp-rail__item--active")).toHaveAttribute(
        "data-variant",
        String(v.variant_id)
      );
      await expect(page.locator(".m-dreg__num")).toHaveText(
        `${v.source_set_code} ${v.card_number}`
      );
      expectState(await readPlate(page, OWN), q, 3, state);
      expectState(await readPlate(page, MINI), q, 3, state);
    }
  }
});

test("s2-03-no-scope-marker", async ({ page }) => {
  // From a Hyperspace-scoped Vault the scope only picks the default printing:
  // no "◂ scope" marker, no amber row edge, no amber anywhere in the rail;
  // the plate reads the selected (Hyperspace) printing, and a different
  // printing re-reads it.
  await openVault(page, "#/vault?finish=Hyperspace");
  const c = byNum("SOR", 87);
  await tapRow(page, c.id);
  const hs = c.variants.find((v) => fin(v) === "Hyperspace")!;
  await expect(page.locator(".m-print.cp-rail__item--active")).toHaveAttribute(
    "data-variant",
    String(hs.variant_id)
  );
  await expect(page.getByText(/scope/i)).toHaveCount(0);
  const amberInRail = await page.evaluate(() =>
    [...document.querySelectorAll(".m-printings *, .m-printings")].some((e) => {
      const cs = getComputedStyle(e);
      return [cs.color, cs.borderLeftColor, cs.backgroundColor].some((c) =>
        /rgba?\((217, 154, 31|242, 193, 78)/.test(c)
      );
    })
  );
  expect(amberInRail).toBe(false);
  expectState(await readPlate(page, OWN), 1, 3, "short");
  const foil = c.variants.find((v) => fin(v) === "Standard Foil")!;
  await select(page, foil.variant_id);
  expectState(await readPlate(page, OWN), 0, 3, "empty");
});
