import { expect, measureEach, test, wideText } from "./helpers";
import { CARDS, QTY } from "./card-helpers";
import type { Page } from "@playwright/test";

// S1-17: the icon-only Sort and its sheet (rev4 vault-sort-sheet,
// r4-1-sort-icon-only, b2-row-sort-scoped, b2-sort-scoped-across-sets).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone sort");
});

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

const names = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll(".m-row .m-row__name")].map((e) => e.textContent!)
  );

test("s1-17-sort-sheet", async ({ page }) => {
  await openVault(page);
  await page.locator(".m-sortbtn").click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".m-sheet-layer--sort .m-choice__row")];
    return {
      title: document.querySelector(".m-sheet-layer--sort .m-sheet__title")!.textContent,
      labels: rows.map((b) => b.querySelector("span")!.textContent),
      on: rows
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.querySelector("span")!.textContent),
      minH: Math.min(...rows.map((b) => b.getBoundingClientRect().height)),
    };
  });
  expect(r.title).toBe("Sort");
  // REPLACE (BL-257 FR5-05, owner decision 2026-10-12, F-17): the phone's own
  // list -- most-used sorts first, "#" reads "Set | #", "Variants" reads
  // "Cards Owned", no Set row. (Was desktop's ten columns under its headers.)
  expect(r.labels).toEqual(SORT_ROWS);
  expect(r.on).toEqual(["Set | #"]);
  expect(r.minH).toBeGreaterThanOrEqual(44);
});

// ── FR5-05 (F-17) ─────────────────────────────────────────────────────────
const SORT_ROWS = [
  "Set | #",
  "Value",
  "Playset",
  "Name",
  "Cards Owned",
  "Rarity",
  "Cost",
  "Power",
  "HP",
];

async function openSort(page: Page) {
  await page.locator(".m-sortbtn").click();
  await expect(page.locator(".m-sheet-layer--sort")).toBeVisible();
  await page.waitForTimeout(300);
}
async function pick(page: Page, column: string) {
  await openSort(page);
  await page.locator(`.m-choice__row[data-sort="${column}"]`).click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
}

/** The Sort sheet's rows as drawn. */
const sortRows = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-primary)";
    document.querySelector(".m-app")!.append(probe);
    const primary = getComputedStyle(probe).color;
    probe.remove();
    // The reference border: a playset pip drawn in the same document. A
    // fractional border width is snapped by the renderer (to whole device
    // pixels; this emulated 3x Chromium snaps 1.5 px to 1 px, an iPhone draws
    // 4 of its 3x pixels), so the used width is compared pip to badge and the
    // 1.5 px itself is read from the two style rules.
    const pip = document.createElement("span");
    pip.className = "playset__pip";
    document.querySelector(".m-app")!.append(pip);
    const pipWidth = getComputedStyle(pip).borderTopWidth;
    const pipStyle = getComputedStyle(pip).borderTopStyle;
    pip.remove();
    const declared = (selector: string) => {
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // a cross-origin sheet (the fonts)
        }
        for (const rule of rules)
          if (rule instanceof CSSStyleRule && rule.selectorText === selector)
            // The shorthand as written: its longhands read "" while it holds
            // a var().
            return rule.style.getPropertyValue("border");
      }
      return null;
    };
    const rows = [...document.querySelectorAll(".m-sheet-layer--sort .m-choice__row")];
    return {
      primary,
      pipWidth,
      pipStyle,
      declaredBadge: declared(".m-app .m-sortdir"),
      declaredPip: declared(".m-app .playset__pip"),
      dpr: window.devicePixelRatio,
      rows: rows.map((row) => {
        const label = row.querySelector("span")!;
        const badge = row.querySelector(".m-sortdir");
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        const rb = row.getBoundingClientRect();
        const cs = badge ? getComputedStyle(badge) : null;
        const bb = badge ? badge.getBoundingClientRect() : null;
        return {
          sort: (row as HTMLElement).dataset.sort,
          label: label.textContent,
          pressed: row.getAttribute("aria-pressed"),
          aria: row.getAttribute("aria-label"),
          svgs: row.querySelectorAll("svg").length,
          h: rb.height,
          labelLines: new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size,
          badge: badge
            ? {
                text: badge.textContent,
                color: cs!.color,
                border: [cs!.borderTopColor, cs!.borderRightColor, cs!.borderBottomColor].join(),
                borderLeft: cs!.borderLeftColor,
                width: [cs!.borderTopWidth, cs!.borderLeftWidth].join(),
                style: cs!.borderTopStyle,
                radius: parseFloat(cs!.borderTopLeftRadius),
                fill: cs!.backgroundColor,
                transform: cs!.textTransform,
                h: bb!.height,
                spare: bb!.left - text.right,
                insideRow: bb!.top >= rb.top && bb!.bottom <= rb.bottom && bb!.right <= rb.right,
                cut: badge.scrollWidth > badge.clientWidth,
              }
            : null,
        };
      }),
    };
  });

test("fr5-05 Sort sheet: nine rows in the owner's order, a text direction badge on the active row", async ({
  page,
}) => {
  await openVault(page, "#/vault?size=none");
  await openSort(page);
  let s = await sortRows(page);
  expect(s.rows.map((x) => x.label)).toEqual(SORT_ROWS);
  expect(s.rows.map((x) => x.sort)).toEqual([
    "number",
    "value",
    "playset",
    "name",
    "owned",
    "rarity",
    "cost",
    "power",
    "hp",
  ]);
  expect(s.rows.some((x) => x.label === "Set" || x.sort === "set")).toBe(false);
  expect(s.rows.some((x) => x.label === "Variants" || x.sort === "variants")).toBe(false);
  // The default: "Set | #" active, reading Ascending; no other row has a badge;
  // no chevron (or any icon) in any row.
  expect(s.rows.filter((x) => x.badge).map((x) => [x.label, x.badge!.text])).toEqual([
    ["Set | #", "Ascending"],
  ]);
  expect(s.rows.map((x) => x.svgs)).toEqual(SORT_ROWS.map(() => 0));
  expect(s.rows[0].pressed).toBe("true");
  expect(s.rows[0].aria).toBe("Set | #, ascending");
  expect(s.rows[4].aria).toBe("Cards Owned");
  const rowH = s.rows[1].h;
  const badgeLook = (b: NonNullable<(typeof s.rows)[number]["badge"]>) => {
    // Text and border are the app blue (the computed --color-primary); the
    // border is the playset pip's: 1.5 px solid (both rules say 1.5 px, and
    // the badge draws at exactly the width a pip draws at), fully rounded, no
    // fill.
    expect(s.declaredBadge).toBe("1.5px solid var(--color-primary)");
    expect(s.declaredPip).toBe("1.5px solid var(--color-text-muted)");
    expect(b.color).toBe(s.primary);
    expect(b.border).toBe([s.primary, s.primary, s.primary].join());
    expect(b.borderLeft).toBe(s.primary);
    expect(b.width).toBe([s.pipWidth, s.pipWidth].join());
    expect(b.style).toBe(s.pipStyle);
    expect(b.style).toBe("solid");
    expect(b.radius).toBeGreaterThanOrEqual(b.h / 2);
    expect(b.fill).toBe("rgba(0, 0, 0, 0)");
    expect(b.transform).toBe("uppercase");
    expect(b.insideRow).toBe(true);
    expect(b.cut).toBe(false);
  };
  expect(s.primary).toBe("rgb(37, 99, 235)");
  badgeLook(s.rows[0].badge!);
  // The badge does not make its row taller than the others.
  for (const x of s.rows) expect(Math.abs(x.h - rowH)).toBeLessThanOrEqual(0.5);
  expect(rowH).toBeGreaterThanOrEqual(44);

  // A new row sorts ascending and closes; the active row flips its direction.
  console.log(
    `fr5-05 ${test.info().project.name} border: declared ${s.declaredBadge} (pip ${s.declaredPip}), drawn ${s.rows[0].badge!.width} (pip ${s.pipWidth}) at devicePixelRatio ${s.dpr}`
  );
  await page.locator('.m-choice__row[data-sort="owned"]').click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
  await expect(page.locator(".m-sortbtn")).toHaveAttribute(
    "aria-label",
    "Sort: Cards Owned, ascending"
  );
  await openSort(page);
  s = await sortRows(page);
  expect(s.rows.filter((x) => x.badge).map((x) => [x.label, x.badge!.text])).toEqual([
    ["Cards Owned", "Ascending"],
  ]);
  await page.locator('.m-choice__row[data-sort="owned"]').click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
  await expect(page.locator(".m-sortbtn")).toHaveAttribute(
    "aria-label",
    "Sort: Cards Owned, descending"
  );

  // The longest pair, "Cards Owned" + "Descending": one line, the badge whole,
  // >= 6 px between the label's text and the badge -- under normal text and
  // under the whole-pixel text condition (helpers.ts wideText).
  await openSort(page);
  const fit = async (cond: string) => {
    const t = await sortRows(page);
    const row = t.rows[4];
    expect(row.label).toBe("Cards Owned");
    expect(row.aria).toBe("Cards Owned, descending");
    expect(row.badge!.text).toBe("Descending");
    badgeLook(row.badge!);
    expect(row.labelLines).toBe(1);
    expect(row.badge!.spare, cond).toBeGreaterThanOrEqual(6);
    for (const x of t.rows) expect(Math.abs(x.h - rowH)).toBeLessThanOrEqual(0.5);
    console.log(
      `fr5-05 ${test.info().project.name} ${cond}: spare ${row.badge!.spare.toFixed(1)} px, badge ${row.badge!.h.toFixed(1)} px in a ${row.h.toFixed(1)} px row`
    );
  };
  await fit("normal text");
  const widened = await wideText(page);
  await fit(widened ? "wideText" : "wideText (browser already snaps: same run)");
});

/** Every Vault row top to bottom (the list is virtualised: scroll and collect). */
async function allRows(page: Page) {
  const seen = new Map<string, { set: string; n: number; y: number }>();
  const sc = page.locator(".m-vault__scroll");
  await sc.evaluate((e) => void (e.scrollTop = 0));
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(60);
    const got = await sc.evaluate((e) => {
      const top = e.getBoundingClientRect().top;
      return {
        rows: [...e.querySelectorAll<HTMLElement>(".m-row")].map((r) => ({
          id: r.dataset.card!,
          set: r.dataset.set!,
          n: parseInt(r.querySelector(".m-row__num")!.textContent!.trim().split(" ").pop()!, 10),
          y: r.getBoundingClientRect().top - top + e.scrollTop,
        })),
        end: e.scrollTop + e.clientHeight >= e.scrollHeight - 1,
      };
    });
    for (const r of got.rows) seen.set(r.id, r);
    if (got.end) break;
    await sc.evaluate((e) => void (e.scrollTop += e.clientHeight * 0.7));
  }
  await sc.evaluate((e) => void (e.scrollTop = 0));
  return [...seen.values()].sort((a, b) => a.y - b.y);
}

test("fr5-05 Set | # keeps the sets newest first in both directions; only the numbers reverse", async ({
  page,
}) => {
  // The fixture catalogue: the newest main set WITH cards is ASH (HMW is in
  // the set list but has no cards here); IBH and TS26 are the two non-main
  // base sets that always follow the main block.
  const TAIL = ["IBH", "TS26"];
  const inSet = (code: string) =>
    CARDS.filter((c) => c.set_code === code).map((c) => parseInt(c.base_card_number, 10));
  await openVault(page, "#/vault?size=none");
  const asc = await allRows(page);
  expect(asc.length).toBe(CARDS.length);
  const newest = asc[0].set;
  expect(newest).toBe("ASH");
  expect(TAIL).not.toContain(newest);
  expect(asc[0].n).toBe(Math.min(...inSet(newest)));

  await pick(page, "number"); // the active row: flips to descending
  await expect(page.locator(".m-sortbtn")).toHaveAttribute(
    "aria-label",
    "Sort: Set | #, descending"
  );
  const desc = await allRows(page);
  expect(desc.length).toBe(CARDS.length);
  // Still the newest set first -- at its highest number.
  expect(desc[0].set).toBe(newest);
  expect(desc[0].n).toBe(Math.max(...inSet(newest)));

  const groups = (rows: typeof asc) => {
    const g: { set: string; ns: number[] }[] = [];
    for (const r of rows) {
      if (!g.length || g[g.length - 1].set !== r.set) g.push({ set: r.set, ns: [] });
      g[g.length - 1].ns.push(r.n);
    }
    return g;
  };
  const ga = groups(asc);
  const gd = groups(desc);
  // The set order is the same in both directions, each set one contiguous group.
  expect(gd.map((g) => g.set)).toEqual(ga.map((g) => g.set));
  expect(new Set(ga.map((g) => g.set)).size).toBe(ga.length);
  // Numbers ascend inside each group one way and descend the other.
  for (const g of ga) expect(g.ns.every((x, i) => i === 0 || x >= g.ns[i - 1])).toBe(true);
  for (const g of gd) expect(g.ns.every((x, i) => i === 0 || x <= g.ns[i - 1])).toBe(true);
  // Intro Battle: Hoth and Twin Suns come after every main-set row, both ways.
  for (const order of [ga, gd]) {
    const sets = order.map((g) => g.set);
    expect(sets.filter((x) => TAIL.includes(x)).sort()).toEqual([...TAIL].sort());
    const firstTail = sets.findIndex((x) => TAIL.includes(x));
    expect(sets.slice(firstTail).every((x) => TAIL.includes(x))).toBe(true);
    expect(sets.slice(0, firstTail).some((x) => TAIL.includes(x))).toBe(false);
  }
  console.log(
    `fr5-05 set order asc ${ga.map((g) => g.set).join(" ")} | first asc ${asc[0].set} ${asc[0].n}, first desc ${desc[0].set} ${desc[0].n}`
  );
});

test("fr5-05 Cards Owned sorts by copies owned: most-owned card first when descending", async ({
  page,
}) => {
  // Copies owned per card, from the fixtures (all printings; no finish scope).
  const owned = new Map(
    CARDS.map((c) => [
      String(c.id),
      c.variants.reduce((n, x) => n + (QTY.get(x.variant_id) ?? 0), 0),
    ])
  );
  const most = Math.max(...owned.values());
  expect(most).toBeGreaterThan(0);
  expect(new Set(owned.values()).size).toBeGreaterThan(2);
  await openVault(page, "#/vault?size=none");
  const base = (await allRows(page)).map((r) => r.id);

  await pick(page, "owned"); // a new row: ascending, fewest first
  await expect(page.locator(".m-sortbtn")).toHaveAttribute(
    "aria-label",
    "Sort: Cards Owned, ascending"
  );
  const asc = (await allRows(page)).map((r) => r.id);
  expect(asc.length).toBe(CARDS.length);
  expect(owned.get(asc[0])).toBe(Math.min(...owned.values()));
  expect(asc.every((id, i) => i === 0 || owned.get(id)! >= owned.get(asc[i - 1])!)).toBe(true);

  await pick(page, "owned"); // the active row: descending, most first
  await expect(page.locator(".m-sortbtn")).toHaveAttribute(
    "aria-label",
    "Sort: Cards Owned, descending"
  );
  const desc = (await allRows(page)).map((r) => r.id);
  expect(desc.length).toBe(CARDS.length);
  expect(owned.get(desc[0])).toBe(most);
  // The first row is the most-owned card that comes first in the default order.
  expect(desc[0]).toBe(base.find((id) => owned.get(id) === most));
  expect(desc.every((id, i) => i === 0 || owned.get(id)! <= owned.get(desc[i - 1])!)).toBe(true);
  // Equal counts keep the default order, in both directions.
  const pos = new Map(base.map((id, i) => [id, i]));
  for (const order of [asc, desc])
    expect(
      order.every(
        (id, i) =>
          i === 0 ||
          owned.get(id) !== owned.get(order[i - 1]) ||
          pos.get(id)! > pos.get(order[i - 1])!
      )
    ).toBe(true);
  const top = CARDS.find((c) => String(c.id) === desc[0])!;
  console.log(
    `fr5-05 Cards Owned: desc first ${top.set_code} ${top.base_card_number} (${most} owned), asc first owns ${owned.get(asc[0])}; distinct counts ${new Set(owned.values()).size}`
  );
});

test("fr5-05 the phone has no way into a Set or Variants sort: a sort parameter is not read", async ({
  page,
}) => {
  // The Vault reads ?set= ?finish= ?q= ?view= ?size= ?gsize= and no sort
  // parameter; the sort is plain session state written only by the sheet (the
  // model-level set / variants -> "Set | #" ascending mapping is unit-tested
  // in vaultModel.test.ts). A link that names one leaves the default order.
  await openVault(page, "#/vault?size=none");
  const base = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".m-row")].map((r) => r.dataset.card)
  );
  for (const column of ["set", "variants"]) {
    await openVault(page, `#/vault?size=none&sort=${column}&dir=desc`);
    await expect(page.locator(".m-sortbtn")).toHaveAttribute(
      "aria-label",
      "Sort: Set | #, ascending"
    );
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".m-row")].map((r) => r.dataset.card)
      )
    ).toEqual(base);
    await openSort(page);
    const s = await sortRows(page);
    expect(s.rows.filter((x) => x.badge).map((x) => [x.sort, x.badge!.text])).toEqual([
      ["number", "Ascending"],
    ]);
    expect(s.rows.some((x) => x.sort === column)).toBe(false);
    await page.locator(".m-sheet-layer--sort .m-sheet__close").click();
    await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
  }
});

test("s1-17-sort-icon-only", async ({ page }) => {
  await openVault(page, "#/vault?size=none");
  const b = await page.evaluate(() => {
    const e = document.querySelector(".m-vault__status .m-sortbtn")!;
    const r = e.getBoundingClientRect();
    return {
      text: e.textContent!.trim(),
      svg: !!e.querySelector("svg"),
      label: e.getAttribute("aria-label"),
      w: r.width,
      h: r.height,
    };
  });
  // PORT (BL-257 FR5-05, owner decision 2026-10-12, F-17): "#" reads "Set | #".
  expect(b).toEqual({ text: "", svg: true, label: "Sort: Set | #, ascending", w: 44, h: 44 });
  // A new column lands ascending (nextSortState) and the sheet closes.
  await page.locator(".m-sortbtn").click();
  await page.waitForTimeout(300);
  await page.locator('.m-choice__row[data-sort="name"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator(".m-sheet-layer").count()).toBe(0);
  expect(await page.locator(".m-sortbtn").getAttribute("aria-label")).toBe("Sort: Name, ascending");
  expect((await page.locator(".m-sortbtn").textContent())!.trim()).toBe("");
  const asc = await names(page);
  expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
  // The active column flips direction.
  await page.locator(".m-sortbtn").click();
  await page.waitForTimeout(300);
  await page.locator('.m-choice__row[data-sort="name"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator(".m-sortbtn").getAttribute("aria-label")).toBe(
    "Sort: Name, descending"
  );
  const desc = await names(page);
  expect(desc[0].localeCompare(desc[desc.length - 1])).toBeGreaterThan(0);
});

test("s1-17-sort-scoped", async ({ page }) => {
  // b2-row-sort-scoped: default order = scoped-number order within the set.
  await openVault(page, "#/vault?finish=Hyperspace&set=SOR&size=none");
  const one = await page.evaluate(() => {
    const nums = [...document.querySelectorAll(".m-row .m-row__num")].map((e) => e.textContent!);
    return { nums, scoped: document.querySelectorAll(".m-row__num--scoped").length };
  });
  const n = one.nums.map((s) => parseInt(s.split(" ").pop()!, 10));
  expect(n.length).toBeGreaterThan(2);
  expect(n.every((x, i) => i === 0 || x >= n[i - 1])).toBe(true);
  expect(one.scoped).toBe(n.length);

  // b2-sort-scoped-across-sets: contiguous set groups, ordered inside each.
  await openVault(page, "#/vault?finish=Hyperspace&set=SOR,ASH&size=none");
  const r = await page.evaluate(() =>
    [...document.querySelectorAll(".m-row")].map((row) => {
      // Group by the card's set (a SORP printing still belongs to SOR's group).
      const e = row.querySelector(".m-row__num")!;
      const num = e.textContent!.trim().split(" ").pop()!;
      return {
        set: (row as HTMLElement).dataset.set!,
        n: parseInt(num, 10),
        scoped: e.classList.contains("m-row__num--scoped"),
      };
    })
  );
  const groups: { set: string; ns: number[] }[] = [];
  for (const x of r) {
    if (!groups.length || groups[groups.length - 1].set !== x.set)
      groups.push({ set: x.set, ns: [] });
    groups[groups.length - 1].ns.push(x.n);
  }
  expect(groups.length).toBeGreaterThanOrEqual(2);
  expect(new Set(groups.map((g) => g.set)).size).toBe(groups.length);
  for (const g of groups) expect(g.ns.every((x, i) => i === 0 || x >= g.ns[i - 1])).toBe(true);
  expect(r.every((x) => x.scoped)).toBe(true);
});
