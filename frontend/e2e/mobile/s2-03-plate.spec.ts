import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";
import { byNum, fin, openCard, openVault, QTY, tapRow } from "./card-helpers";

// S2-03 (R5-5): the card-detail plate follows the SELECTED printing --
// REPLACES rev4 r4-7-detail-plate-states + b2-detail-scoped-printing (both
// asserted the card-total / scoped plate R5-5 retired). Computed colours =
// cards.css literals (rev4 r47Check table) for empty / short / complete
// printings of SOR 87 Darth Vader and ASH 52 Chimaera, in the expanded and
// the collapsed plate.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone detail");
});

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

const readPlate = (page: Page, root: string) =>
  page.evaluate((root) => {
    const el = document.querySelector(root)!;
    const chip = el.querySelector(".playset-chip")!;
    const cs = getComputedStyle(chip);
    const box = el.querySelector(".playset__pips")!;
    const bs = getComputedStyle(box);
    const frame = el.querySelector(".gallery-plate")!;
    return {
      chip: {
        text: chip.textContent,
        russo12: /Russo One/.test(cs.fontFamily) && cs.fontSize === "12px",
        color: cs.color,
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        glow: cs.boxShadow,
      },
      chipLeft: chip.getBoundingClientRect().right <= box.getBoundingClientRect().left + 0.5,
      plate: { border: bs.borderTopColor, bg: bs.backgroundColor },
      frameRing: getComputedStyle(frame).backgroundColor,
      pips: [...el.querySelectorAll(".playset__pip")].map((p) => {
        const ps = getComputedStyle(p);
        return { w: ps.width, fill: ps.backgroundColor, line: ps.borderTopColor };
      }),
      text: el.textContent,
    };
  }, root);

type State = "empty" | "short" | "complete";
function expectState(r: Awaited<ReturnType<typeof readPlate>>, q: number, size: number, s: State) {
  expect(r.chip.text).toBe(String(q));
  expect(r.chip.russo12).toBe(true);
  expect(r.chip.bg).toBe(T.surf);
  expect(r.chip.color).toBe(s === "complete" ? T.green : s === "empty" ? T.muted : T.text);
  expect(r.chip.border).toBe(s === "complete" ? T.greenRing : T.border);
  expect(r.chip.glow).toBe(s === "complete" ? T.greenGlow : "none");
  expect(r.chipLeft).toBe(true);
  // The amber-outlined plate only at a playset (playset__pips--scoped-complete).
  expect(r.plate.border === T.amberLine && r.plate.bg === T.amberWash).toBe(s === "complete");
  // The steel frame never takes the gallery's green ring.
  expect(r.frameRing).toBe("rgba(211, 211, 212, 0.35)");
  expect(r.pips.length).toBe(size);
  r.pips.forEach((p, i) => {
    const on = i < Math.min(q, size);
    expect(p.w).toBe("10px");
    const want = !on ? T.none : s === "complete" ? T.green : T.amber;
    expect(p.fill).toBe(want);
    expect(p.line).toBe(on ? want : s === "empty" ? T.border : T.muted);
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
