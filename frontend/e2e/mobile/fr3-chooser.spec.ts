import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { SET_LOGO_ART, SET_LOGO_BOX } from "../../src/mobile/setLogoArt";
import { DECK_ART } from "../../src/mobile/tool/deckArtModel";
import { BASE_SET_ORDER } from "../../src/utils/setGrouping";
import { expect, measureEach, test } from "./helpers";
import { openPad } from "./tool-helpers";

// BL-257 FR3 (owner finish round, 2026-10-12): the keypad's "Choose a set"
// sheet. FR3-01 set logos centred and optically even (also on the
// "Completion by set" sheet); FR3-02 the Set / Precon deck headers are a
// pinned two-way accordion, both collapsed on open; FR3-03 precon deck rows
// carry the deck's leader and base art.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

const openChooser = async (page: Page) => {
  await openPad(page);
  await page.locator(".m-pad__entry .m-padset").click();
  await expect(page.locator(".m-sheet-layer--setpick")).toBeVisible();
  await page.waitForTimeout(260); // the sheet's rise
};
const SET_HEAD = '.m-setchooser[aria-controls="m-setchooser-set"]';
const DECK_HEAD = '.m-setchooser[aria-controls="m-setchooser-precon"]';

// ── FR3-01 ──────────────────────────────────────────────────────────────────

interface LogoProbe {
  code: string;
  box: { x: number; y: number; w: number; h: number };
  img: { x: number; y: number; w: number; h: number };
  natural: [number, number];
}

const probeLogos = (page: Page, scope: string) =>
  page.locator(`${scope} .m-setlogo`).evaluateAll(async (els) => {
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const out = [];
    for (const e of els) {
      const img = e.querySelector("img")!;
      await img.decode().catch(() => undefined);
      out.push({
        code: (e as HTMLElement).dataset.logo!,
        box: rect(e),
        img: rect(img),
        natural: [img.naturalWidth, img.naturalHeight] as [number, number],
      });
    }
    return out;
  });

/** The artwork's rendered rect = the <img> rect x the table's trim fractions. */
function artRect(p: LogoProbe) {
  const a = SET_LOGO_ART[p.code];
  return {
    x: p.img.x + a.l * p.img.w,
    y: p.img.y + a.t * p.img.h,
    w: a.aw * p.img.w,
    h: a.ah * p.img.h,
  };
}

/** Artworks the box holds under the common area, with the reason. Everything
 * else must sit within +/-20 % of the median area. */
const CAPPED: Record<string, string> = {
  SOR: "11 : 1 wordmark -- at the box's full width its height is under a third of the others'",
};

function assertLogos(probes: LogoProbe[], box: { w: number; h: number }, where: string) {
  expect(probes.map((p) => p.code).sort(), where).toEqual([...BASE_SET_ORDER].sort());
  const areas: Record<string, number> = {};
  for (const p of probes) {
    const label = `${where} ${p.code}`;
    const a = SET_LOGO_ART[p.code];
    // The trims describe THIS file (a replaced PNG must be re-measured).
    expect(p.natural, label).toEqual([a.w, a.h]);
    expect(p.box.w, label).toBeCloseTo(box.w, 1);
    expect(p.box.h, label).toBeCloseTo(box.h, 1);
    const art = artRect(p);
    // Centred in the logo box on both axes, within 1 px.
    expect(Math.abs(art.x + art.w / 2 - (p.box.x + p.box.w / 2)), label).toBeLessThanOrEqual(1);
    expect(Math.abs(art.y + art.h / 2 - (p.box.y + p.box.h / 2)), label).toBeLessThanOrEqual(1);
    // The artwork never overflows its box.
    expect(art.x, label).toBeGreaterThanOrEqual(p.box.x - 0.5);
    expect(art.y, label).toBeGreaterThanOrEqual(p.box.y - 0.5);
    expect(art.x + art.w, label).toBeLessThanOrEqual(p.box.x + p.box.w + 0.5);
    expect(art.y + art.h, label).toBeLessThanOrEqual(p.box.y + p.box.h + 0.5);
    areas[p.code] = art.w * art.h;
  }
  const sorted = Object.values(areas).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  for (const [code, area] of Object.entries(areas)) {
    const ratio = area / median;
    if (code in CAPPED) expect(ratio, `${where} ${code} is the cap case`).toBeLessThan(0.8);
    else {
      expect(ratio, `${where} ${code} area vs median`).toBeGreaterThanOrEqual(0.8);
      expect(ratio, `${where} ${code} area vs median`).toBeLessThanOrEqual(1.2);
    }
  }
}

test.describe("FR3-01 set logos centred and optically even", () => {
  test("fr3-01 chooser set rows: 11 logos centred, even, inside the box; rows stay 52 px", async ({
    page,
  }) => {
    await openChooser(page);
    await page.locator(SET_HEAD).click();
    await expect(page.locator(".m-setpick")).toBeVisible();
    assertLogos(await probeLogos(page, ".m-setpick"), SET_LOGO_BOX.chooser, "chooser");
    const heights = await page
      .locator(".m-setpick .m-setpick__row")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights)).toEqual(new Set([52]));
    // The logo boxes share one left edge (a column).
    const lefts = await page
      .locator(".m-setpick .m-setlogo")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(lefts).size).toBe(1);
  });

  test("fr3-01 Completion by set rows: 11 logos centred, even, inside the box", async ({
    page,
  }) => {
    await page.goto("/#/vault?sheet=sets");
    await expect(page.locator(".m-sheet .m-setrow--r2").first()).toBeVisible();
    await page.waitForTimeout(260);
    assertLogos(await probeLogos(page, ".m-setrows"), SET_LOGO_BOX.sets, "by-set");
  });

  test("fr3-01 deck rows: the set logo is centred in its (smaller) box", async ({ page }) => {
    await openChooser(page);
    await page.locator(DECK_HEAD).click();
    const probes = await probeLogos(page, ".m-d2-decks");
    expect(probes).toHaveLength(23);
    for (const p of probes) {
      const art = artRect(p);
      expect(p.box.w).toBeCloseTo(SET_LOGO_BOX.deck.w, 1);
      expect(Math.abs(art.x + art.w / 2 - (p.box.x + p.box.w / 2)), p.code).toBeLessThanOrEqual(1);
      expect(Math.abs(art.y + art.h / 2 - (p.box.y + p.box.h / 2)), p.code).toBeLessThanOrEqual(1);
      expect(art.w, p.code).toBeLessThanOrEqual(p.box.w + 0.5);
      expect(art.h, p.code).toBeLessThanOrEqual(p.box.h + 0.5);
    }
  });
});

// ── FR3-02 ──────────────────────────────────────────────────────────────────

const geometry = (page: Page) =>
  page.evaluate(() => {
    const r = (sel: string) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height };
    };
    const body = document.querySelector(".m-sheet-layer--setpick .m-sheet__body")!;
    const cs = getComputedStyle(body);
    const bb = body.getBoundingClientRect();
    return {
      set: r('.m-setchooser[aria-controls="m-setchooser-set"]')!,
      deck: r('.m-setchooser[aria-controls="m-setchooser-precon"]')!,
      foot: r(".m-sheet-layer--setpick .m-sheet__foot"),
      sheet: r(".m-sheet-layer--setpick .m-sheet")!,
      // The panel = the body's content box.
      panelTop: bb.top + parseFloat(cs.paddingTop),
      panelBottom: bb.bottom - parseFloat(cs.paddingBottom),
      bodyScroll: body.scrollTop,
      bodyOverflow: cs.overflowY,
      viewport: window.innerHeight,
    };
  });

test.describe("FR3-02 Set / Precon deck are a pinned two-way accordion", () => {
  test("fr3-02 both collapsed on open; open one and both headers stay pinned; the list scrolls", async ({
    page,
  }) => {
    await openChooser(page);
    const sheet = page.locator(".m-sheet-layer--setpick");
    const setHead = page.locator(SET_HEAD);
    const deckHead = page.locator(DECK_HEAD);

    // On open: neither list rendered, both headers visible, the short sheet.
    await expect(sheet.locator(".m-setchooser__list")).toHaveCount(0);
    await expect(setHead).toBeVisible();
    await expect(deckHead).toBeVisible();
    await expect(setHead).toHaveAttribute("aria-expanded", "false");
    await expect(deckHead).toHaveAttribute("aria-expanded", "false");
    await expect(sheet).not.toHaveClass(/m-sheet-layer--setpick-long/);
    const closed = await geometry(page);
    expect(closed.foot).toBeNull();
    expect(Math.abs(closed.deck.top - closed.set.bottom)).toBeLessThanOrEqual(1);
    expect(closed.sheet.height).toBeLessThan(closed.viewport * 0.5);

    // Set expanded: Set header at the panel top, Precon header's bottom edge
    // at the panel bottom, directly above the foot; the sheet is long.
    await setHead.click();
    await expect(setHead).toHaveAttribute("aria-expanded", "true");
    await expect(sheet).toHaveClass(/m-sheet-layer--setpick-long/);
    const list = page.locator("#m-setchooser-set");
    await expect(list).toBeVisible();
    await expect(page.locator(".m-setpick__all")).toHaveText("Show all sets");
    await page.locator(".m-setpick__all").click(); // the long view: certain to overflow
    await expect(page.locator(".m-setpick")).toHaveAttribute("data-view", "all");
    await page.waitForTimeout(200);
    const a = await geometry(page);
    expect(Math.abs(a.sheet.height - a.viewport * 0.86)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.set.top - a.panelTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.deck.bottom - a.panelBottom)).toBeLessThanOrEqual(1);
    expect(a.foot).not.toBeNull();
    expect(Math.abs(a.deck.bottom - a.foot!.top)).toBeLessThanOrEqual(1);
    expect(a.bodyOverflow).toBe("hidden");
    // The list fills the space between the two headers and is the scroller.
    const lr = await list.evaluate((e) => {
      const b = e.getBoundingClientRect();
      return {
        top: b.top,
        bottom: b.bottom,
        overflow: getComputedStyle(e).overflowY,
        scrollH: e.scrollHeight,
        clientH: e.clientHeight,
      };
    });
    expect(Math.abs(lr.top - a.set.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(lr.bottom - a.deck.top)).toBeLessThanOrEqual(1);
    expect(lr.overflow).toBe("auto");
    expect(lr.scrollH).toBeGreaterThan(lr.clientH + 100);
    await list.evaluate((e) => void (e.scrollTop = 180));
    await page.waitForTimeout(120);
    expect(await list.evaluate((e) => e.scrollTop)).toBe(180);
    const b = await geometry(page);
    near(b.set.top, a.set.top);
    near(b.deck.top, a.deck.top);
    expect(b.bodyScroll).toBe(0);
    // Both headers are real 44 px+ targets and the controlled list exists.
    expect(b.set.height).toBeGreaterThanOrEqual(44);
    expect(b.deck.height).toBeGreaterThanOrEqual(44);

    // Tapping Precon folds Set and puts the Precon header directly under it.
    await deckHead.click();
    await expect(setHead).toHaveAttribute("aria-expanded", "false");
    await expect(deckHead).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#m-setchooser-set")).toHaveCount(0);
    await expect(page.locator(".m-setpick__all")).toHaveCount(0); // foot link: Set only
    const decks = page.locator("#m-setchooser-precon");
    await expect(decks).toBeVisible();
    await page.waitForTimeout(200);
    const c = await geometry(page);
    expect(Math.abs(c.set.top - c.panelTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.deck.top - c.set.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.sheet.height - c.viewport * 0.86)).toBeLessThanOrEqual(2);
    const dr = await decks.evaluate((e) => ({
      top: e.getBoundingClientRect().top,
      overflow: getComputedStyle(e).overflowY,
      scrolls: e.scrollHeight > e.clientHeight + 100,
    }));
    expect(Math.abs(dr.top - c.deck.bottom)).toBeLessThanOrEqual(1);
    expect(dr).toMatchObject({ overflow: "auto", scrolls: true });

    // Tapping the open header returns to both collapsed, the short sheet.
    await deckHead.click();
    await expect(sheet.locator(".m-setchooser__list")).toHaveCount(0);
    await expect(deckHead).toHaveAttribute("aria-expanded", "false");
    await expect(sheet).not.toHaveClass(/m-sheet-layer--setpick-long/);
    await page.waitForTimeout(120);
    const d = await geometry(page);
    expect(Math.abs(d.sheet.height - closed.sheet.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(d.deck.top - d.set.bottom)).toBeLessThanOrEqual(1);
    // ...and Set opens and folds on its own header the same way.
    await setHead.click();
    await expect(page.locator(".m-setpick")).toHaveAttribute("data-view", "all");
    await setHead.click();
    await expect(sheet.locator(".m-setchooser__list")).toHaveCount(0);
  });

  test("fr3-02 the entering list animates opacity + transform for 0.15 s", async ({ page }) => {
    await openChooser(page);
    await page.locator(SET_HEAD).click();
    const anim = await page.locator("#m-setchooser-set").evaluate((e) => {
      const cs = getComputedStyle(e);
      // The keyframes rule itself (the 0.15 s run may already be over).
      const props = new Set<string>();
      for (const sheet of document.styleSheets)
        for (const rule of sheet.cssRules)
          if (rule instanceof CSSKeyframesRule && rule.name === cs.animationName)
            for (const frame of rule.cssRules)
              for (const p of (frame as CSSKeyframeRule).style) props.add(p);
      return {
        name: cs.animationName,
        duration: cs.animationDuration,
        props: [...props].sort(),
      };
    });
    expect(anim.name).toBe("m-setchooser-in");
    expect(anim.duration).toBe("0.15s");
    expect(anim.props).toEqual(["opacity", "transform"]);
  });

  test("fr3-02 reduced motion: the entering list has no animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openChooser(page);
    for (const [head, id] of [
      [SET_HEAD, "#m-setchooser-set"],
      [DECK_HEAD, "#m-setchooser-precon"],
    ]) {
      await page.locator(head).click();
      await expect(page.locator(id)).toBeVisible();
      expect(await page.locator(id).evaluate((e) => getComputedStyle(e).animationName)).toBe(
        "none"
      );
      expect(await page.locator(id).evaluate((e) => e.getAnimations().length)).toBe(0);
    }
  });
});

// ── FR3-03 ──────────────────────────────────────────────────────────────────

// The shared fixture catalogue holds few deck leaders. precon-art.json adds
// the real catalogue rows (leader / base, Standard printing) that complete
// three decks: SHD-MANDO (single), TS26-DOOKU (Twin Suns, dual) and the Hoth
// box (ibh). HMW-CHEWBACCA's leader is in neither file.
async function withDeckArt(page: Page) {
  const read = (f: string) => JSON.parse(readFileSync(`e2e/mobile/fixtures/${f}`, "utf8"));
  const cards = [...read("base-cards.json"), ...read("precon-art.json")];
  await page.route(
    (u) => u.pathname === "/api/base-cards",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cards) })
  );
}

/** Scroll a deck row into view and wait for its (lazy) art to load. */
async function showDeck(page: Page, deck: string) {
  const row = page.locator(`.m-d2-deck[data-deck="${deck}"]`);
  await row.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      row
        .locator(".m-deckart img")
        .evaluateAll((is) =>
          is.every((i) => (i as HTMLImageElement).complete && !!(i as HTMLImageElement).currentSrc)
        )
    )
    .toBe(true);
}

const near = (a: number, b: number, tol = 0.1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

const probeDeck = (page: Page, deck: string) =>
  page.locator(`.m-d2-deck[data-deck="${deck}"]`).evaluate((row) => {
    const rect = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
    };
    const imgs = [...row.querySelectorAll("img")];
    return {
      row: rect(row)!,
      logo: rect(row.querySelector(".m-setlogo"))!,
      art: rect(row.querySelector(".m-deckart")),
      kind: row.querySelector(".m-deckart")?.getAttribute("data-art") ?? null,
      artHidden: row.querySelector(".m-deckart")?.getAttribute("aria-hidden") ?? null,
      leaders: [...row.querySelectorAll(".m-deckart__leader")].map((e) => rect(e)!),
      bases: [...row.querySelectorAll(".m-deckart__base")].map((e) => rect(e)!),
      text: rect(row.querySelector(".m-d2-deck__text"))!,
      artImgs: [...row.querySelectorAll(".m-deckart img")].map((i) => ({
        alt: i.getAttribute("alt"),
        loading: i.getAttribute("loading"),
        w: i.getAttribute("width"),
        h: i.getAttribute("height"),
        // (The fixture image is 1 px: with width descriptors its naturalWidth
        // rounds to 0, so "loaded" is read from complete + currentSrc.)
        ok: (i as HTMLImageElement).complete,
        src: (i as HTMLImageElement).currentSrc,
      })),
      imgCount: imgs.length,
      label: row.getAttribute("aria-label"),
      lines: [".m-d2-deck__product", ".m-d2-deck__name"].map((s) => {
        const e = row.querySelector(s) as HTMLElement;
        return { h: e.getBoundingClientRect().height, clipped: e.scrollWidth > e.clientWidth };
      }),
    };
  });

test.describe("FR3-03 precon deck rows show the deck's leader and base", () => {
  test("fr3-03 single / Twin Suns / Hoth art, between logo and text, rows <= 76 px", async ({
    page,
  }) => {
    await withDeckArt(page);
    await openChooser(page);
    await page.locator(DECK_HEAD).click();
    const list = page.locator("#m-setchooser-precon");
    await expect(page.locator(".m-d2-decks .m-d2-deck")).toHaveCount(23);
    const { leaderW, leaderH, peek, gap } = DECK_ART;

    // Single leader: one landscape leader in front, one base behind it,
    // raised by the peek and mostly covered.
    await showDeck(page, "SHD-MANDO");
    const s = await probeDeck(page, "SHD-MANDO");
    expect(s.kind).toBe("single");
    expect(s.leaders).toHaveLength(1);
    expect(s.bases).toHaveLength(1);
    const sl = s.leaders[0];
    const sb = s.bases[0];
    near(sl.w, leaderW);
    near(sl.h, leaderH);
    expect(sl.w).toBeGreaterThan(sl.h);
    const rise = sl.y - sb.y;
    near(rise, peek);
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThanOrEqual(sb.h * 0.25);
    const covered =
      (Math.min(sb.r, sl.r) - Math.max(sb.x, sl.x)) * (Math.min(sb.b, sl.b) - Math.max(sb.y, sl.y));
    expect(covered / (sb.w * sb.h)).toBeGreaterThan(0.75);
    // Art sits between the logo and the text; decorative; no layout shift.
    expect(s.art!.x).toBeGreaterThanOrEqual(s.logo.r - 0.1);
    expect(s.text.x).toBeGreaterThanOrEqual(s.art!.r - 0.1);
    expect(s.artHidden).toBe("true");
    for (const i of s.artImgs) {
      expect(i).toMatchObject({ alt: "", loading: "lazy", ok: true });
      expect(i.src).toMatch(/_320\.webp$/); // the small rendition, at 3x
      expect(Number(i.w) > 0 && Number(i.h) > 0).toBe(true);
    }
    expect(s.label).toBe("Two-Player Starter — The Mandalorian");

    // Twin Suns: two leaders side by side at the single row's size, one base
    // behind and between them.
    await showDeck(page, "TS26-DOOKU");
    const d = await probeDeck(page, "TS26-DOOKU");
    expect(d.kind).toBe("dual");
    expect(d.leaders).toHaveLength(2);
    expect(d.bases).toHaveLength(1);
    for (const l of d.leaders) {
      near(l.w, sl.w);
      near(l.h, sl.h);
    }
    near(d.leaders[0].y, d.leaders[1].y);
    near(d.leaders[1].x - d.leaders[0].r, gap);
    const db = d.bases[0];
    const mid = (d.leaders[0].r + d.leaders[1].x) / 2;
    expect(Math.abs(db.x + db.w / 2 - mid)).toBeLessThanOrEqual(1);
    expect(db.x).toBeGreaterThan(d.leaders[0].x);
    expect(db.r).toBeLessThan(d.leaders[1].r);
    near(d.leaders[0].y - db.y, peek);
    expect(d.art!.x).toBeGreaterThanOrEqual(d.logo.r - 0.1);
    expect(d.text.x).toBeGreaterThanOrEqual(d.art!.r - 0.1);
    // The text keeps its two lines and a usable width at this viewport.
    expect(d.lines.every((l) => l.h > 0 && l.h < 24)).toBe(true);
    expect(d.text.w).toBeGreaterThanOrEqual(150);

    // The Hoth box: two leaders and two bases, each base behind its leader.
    await showDeck(page, "IBH");
    const h = await probeDeck(page, "IBH");
    expect(h.kind).toBe("ibh");
    expect(h.leaders).toHaveLength(2);
    expect(h.bases).toHaveLength(2);
    for (const [i, l] of h.leaders.entries()) {
      near(l.w, sl.w);
      near(l.h, sl.h);
      near(h.bases[i].x, l.x);
      near(l.y - h.bases[i].y, peek);
    }
    near(h.leaders[1].x - h.leaders[0].r, gap);
    near(h.art!.w, d.art!.w);

    // Every row: height within the cap, nothing past the sheet's edge.
    const rows = await page.locator(".m-d2-decks .m-d2-deck").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const t = e.querySelector(".m-d2-deck__text")!.getBoundingClientRect();
        return { h: r.height, right: Math.max(r.right, t.right) };
      })
    );
    const vw = page.viewportSize()!.width;
    for (const r of rows) {
      expect(r.h).toBeGreaterThanOrEqual(58);
      expect(r.h).toBeLessThanOrEqual(76);
      expect(r.right).toBeLessThanOrEqual(vw + 0.1);
    }
    // One row height for every kind.
    expect(new Set(rows.map((r) => Math.round(r.h * 10))).size).toBe(1);
    expect(await list.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });

  test("fr3-03 a deck whose leader is not in the catalogue renders no art and no error", async ({
    page,
  }) => {
    await openChooser(page);
    await page.locator(DECK_HEAD).click();
    await expect(page.locator(".m-d2-decks .m-d2-deck")).toHaveCount(23);
    const c = await probeDeck(page, "HMW-CHEWBACCA");
    expect(c.art).toBeNull();
    expect(c.imgCount).toBe(1); // the set logo only
    expect(c.text.x).toBeGreaterThanOrEqual(c.logo.r - 0.1);
    expect(c.label).toBe("Spotlight Deck — Chewbacca");
    expect(c.row.h).toBeLessThanOrEqual(76);
    // (afterEach: no page error, console error or failed request.)
  });

  test("fr3-03 an image that fails to load removes the art, never a broken image", async ({
    page,
  }) => {
    await withDeckArt(page);
    // The Mandalorian's leader image fails to decode on both the rendition
    // and the stored CDN URL; Remote Village (its base) loads.
    const dead = (url: URL) => /Mandalorian/i.test(url.pathname);
    await page.route(
      (u) => dead(u),
      (r) => r.fulfill({ status: 200, contentType: "image/webp", body: "not an image" })
    );
    await openChooser(page);
    await page.locator(DECK_HEAD).click();
    const row = page.locator('.m-d2-deck[data-deck="SHD-MANDO"]');
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator(".m-deckart")).toHaveCount(0);
    await expect(row.locator("img")).toHaveCount(1);
    // Its neighbour keeps its art.
    await expect(page.locator('.m-d2-deck[data-deck="TS26-DOOKU"] .m-deckart')).toHaveCount(1);
  });
});
