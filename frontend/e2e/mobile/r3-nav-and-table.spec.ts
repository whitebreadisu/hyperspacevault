import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";

// Owner round 3 (2026-11-09, BL-344):
//   R3-6 phone: the Vault menu's blue underline under the lit entry
//        (Collection or Stashes) spans that label's text exactly.
//   R3-7 desktop: a fast pointer sweep over the Vault table -- through the
//        Variants and Playset popups -- never leaves a Name (or Playset)
//        cell lit once the pointer has left the table.
test.use({ storageState: "e2e/.auth/phone.json" });
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
});

test.describe("phone Vault menu underline", () => {
  test.beforeEach(() => {
    test.skip(!test.info().project.name.startsWith("phone"), "phone");
  });
  test.use({
    stashSeed: {
      stashes: [
        { id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" },
      ],
      stashItems: [],
    },
  });

  async function underline(page: Page, label: string) {
    const head = page.locator(".m-navmenu__head", { hasText: label });
    await expect(head).toHaveClass(/m-navmenu__head--on/);
    return head.locator(".m-navmenu__headtext").evaluate((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      const text = range.getBoundingClientRect();
      const line = getComputedStyle(span, "::after");
      const box = span.getBoundingClientRect();
      // The glyphs end the label's trailing letter-spacing before the text box.
      const spacing = parseFloat(getComputedStyle(span).letterSpacing) || 0;
      return {
        text: text.width - spacing,
        line: parseFloat(line.width),
        lineLeft: box.left + parseFloat(line.left),
        textLeft: text.left,
        lineTop: box.bottom - parseFloat(line.bottom) - parseFloat(line.height),
        textBottom: text.bottom,
      };
    });
  }

  for (const [route, label] of [
    ["/#/vault", "Collection"],
    ["/#/stashes", "Stashes"],
  ])
    test(`r3-06-underline-spans-${label.toLowerCase()}`, async ({ page }) => {
      await page.goto(route);
      const vault = page.locator(".m-nav .m-tab").first();
      await expect(vault).toHaveAttribute("aria-current", "page");
      await vault.click();
      await expect(page.locator(".m-navmenu")).toBeVisible();
      const m = await underline(page, label);
      // Within half a pixel: the old line ran ~1.8 px past the last letter.
      expect(Math.abs(m.line - m.text), JSON.stringify(m)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.lineLeft - m.textLeft), JSON.stringify(m)).toBeLessThanOrEqual(0.5);
      // Under the text, not through it.
      expect(m.lineTop, JSON.stringify(m)).toBeGreaterThanOrEqual(m.textBottom);
    });
});

test.describe("desktop Vault table hover", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop-1440", "desktop");
  });

  /** The fast sweep, through the popups: returns the cells left lit (computed
   * style) and the rows whose Name cell is painted unlike its # cell. Along
   * the way it asserts that the Playset dossier really opened and that a
   * Name cell was reached while a Variants popover lay over it. */
  async function sweep(page: Page) {
    await page.goto("/");
    await expect(page.locator("tbody tr").nth(10)).toBeVisible();
    const rows = page.locator("tbody tr:not([aria-hidden])");
    // A Name cell reached under an open Variants popover (row 0's popover
    // opens over the rows below it).
    await page.locator(".vt-button").first().hover();
    const pop = page.locator(".vt-popover");
    await expect(pop).toBeVisible();
    const under = await page.evaluate(() => {
      const p = document.querySelector(".vt-popover")!.getBoundingClientRect();
      const cells = [...document.querySelectorAll("tbody tr:not([aria-hidden]) td.td-name")];
      for (const td of cells.slice(1)) {
        const b = td.getBoundingClientRect();
        const x = Math.min(b.right - 6, p.right - 6);
        const y = b.top + b.height / 2;
        if (x > p.left && x < p.right && y > p.top && y < p.bottom) return { x, y };
      }
      return null;
    });
    expect(under, "a Name cell lies under the open popover").not.toBeNull();
    await page.mouse.move(under!.x, under!.y, { steps: 1 });
    // The Playset dossier opens on its count chip.
    await rows.nth(2).locator(".playset-chip").hover();
    await expect(rows.nth(2).locator(".gallery-dossier")).toBeVisible();
    // Then the sweep: #, Name, Variants, Playset chip, Value, 14 rows, fast
    // single steps, pausing now and then so popups open over the rows below.
    const grid = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr:not([aria-hidden])")].slice(0, 14).map((r) => {
        const tds = [...r.querySelectorAll("td")].slice(0, 5);
        return tds.map((td, c) => {
          const el = c === 3 ? (td.querySelector(".playset-chip") ?? td) : td;
          const b = el.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        });
      })
    );
    let dossiers = 0;
    for (let rep = 0; rep < 4; rep++) {
      for (let i = 0; i < grid.length; i++) {
        const row = rep % 2 ? [...grid[i]].reverse() : grid[i];
        for (let c = 0; c < row.length; c++) {
          await page.mouse.move(row[c].x, row[c].y, { steps: 1 });
          if ((i + rep + c) % 4 === 0) {
            await page.waitForTimeout(150);
            if (await page.locator(".td-playset .gallery-dossier").count()) dossiers += 1;
          }
        }
      }
      for (let i = 0; i < grid.length; i++) {
        const p = grid[(i * 5) % grid.length][(i + rep) % 5];
        await page.mouse.move(p.x, p.y, { steps: 1 });
      }
    }
    expect(dossiers, "the Playset dossier opened during the sweep").toBeGreaterThan(0);
    await page.mouse.move(4, 4, { steps: 1 });
    // Well past the old 120 ms fade: what is still lit now is stuck.
    await page.waitForTimeout(600);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    const lit = await page.evaluate(() =>
      [...document.querySelectorAll("td.td-name, td.td-playset")]
        .map((td, i) => `${i}:${getComputedStyle(td).backgroundColor}`)
        .filter((s) => !s.endsWith("rgba(0, 0, 0, 0)"))
    );
    const pts = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr:not([aria-hidden])")].slice(0, 14).map((r) => {
        const a = r.querySelector("td")!.getBoundingClientRect();
        const n = r.querySelector("td.td-name")!.getBoundingClientRect();
        return [
          { x: a.x + 3, y: a.y + 3 },
          { x: n.x + n.width - 6, y: n.y + 3 },
        ];
      })
    );
    const shot = (await page.screenshot()).toString("base64");
    const colors = await page.evaluate(
      async ({ b64, pts }) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const at = (p: { x: number; y: number }) =>
          [...g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data.slice(0, 3)].join(",");
        return pts.map(([a, n]) => [at(a), at(n)]);
      },
      { b64: shot, pts }
    );
    // Within 4 per channel (the page's circuit texture shows through the
    // translucent rows); a stuck wash adds ~20 to blue.
    const near = (a: string, b: string) => {
      const x = a.split(",").map(Number);
      const y = b.split(",").map(Number);
      return x.every((v, k) => Math.abs(v - y[k]) <= 4);
    };
    const painted = colors
      .map(([num, name], i) => (near(num, name) ? null : `row ${i}: # ${num} vs Name ${name}`))
      .filter((x) => x);
    return { lit, painted };
  }

  // Reproduces the owner's stuck Name cell (screenshot, 2026-11-09) with the
  // old CSS re-injected (the cells' 0.12 s background transition, popups
  // taking the pointer): 6 of 6 runs left row 9's Name cell painted lit
  // (15,22,44 against 11,15,31) while its computed background was already
  // clear -- a stale paint, still there 600 ms after the pointer left. With
  // today's CSS it is clean.
  test("r3-07-fast-sweep-leaves-no-cell-lit", async ({ page }) => {
    test.setTimeout(90_000);
    const { lit, painted } = await sweep(page);
    expect(lit).toEqual([]);
    expect(painted).toEqual([]);
  });

  test("r3-07-popups-never-take-the-pointer-and-the-wash-has-no-transition", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("tbody tr").nth(5)).toBeVisible();
    const name = page.locator("td.td-name").first();
    expect(await name.evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0s");
    await page.locator(".vt-button").first().hover();
    await expect(page.locator(".vt-popover")).toBeVisible();
    expect(
      await page.locator(".vt-popover").evaluate((e) => getComputedStyle(e).pointerEvents)
    ).toBe("none");
    // The Name cell of the next row, under the open popover, takes the hover.
    const next = page.locator("tbody tr:not([aria-hidden])").nth(1).locator("td.td-name");
    const box = (await next.boundingBox())!;
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 1 });
    await expect.poll(() => next.evaluate((e) => e.matches(":hover"))).toBe(true);
  });
});
