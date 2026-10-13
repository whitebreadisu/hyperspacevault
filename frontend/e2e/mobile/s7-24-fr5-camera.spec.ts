import type { Page } from "@playwright/test";
import { expect, measureEach, samplePixels, test, wideText } from "./helpers";
import { installFakeScanner, openScanCamera, SOR_229 } from "./scan-helpers";

// FR5 (BL-257 round 2) camera items. In an s7-* file because only those run in
// the `scan` project (Chromium + fake camera).
//   fr5-02 (F-15): the camera message panel's steel ring runs along its two
//     cut corners (and the meter's, the sweep's other hit).
//   fr5-03 (F-16): from every stream start the guide is dim and the meter
//     reads "Focusing…" until the first frame that is not blurry, or 3 s.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(test.info().project.name !== "scan", "scan project only");
});

declare global {
  interface Window {
    __settleLog?: { v: string; t: number }[];
    /** performance.now() each time getUserMedia resolved (the stream is live). */
    __gumAt?: number[];
  }
}

type Rgb = [number, number, number];
const STEEL = 211.5; // rgba(211, 211, 212, 0.28)
const RING_ALPHA = 0.28;

/** The page going hidden pauses the camera ("Camera paused" + Start). */
async function pauseCamera(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    // Back to the real value: the page is "visible" again, the camera stays paused.
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "paused");
}

/** Sample points for a panel cut `cut` px on its top-left and bottom-right
 * corners with a 1 px ring: the middle of the ring on each diagonal (0.5 px
 * inside the edge, measured across it), the middle of the ring on two
 * straight edges (the control), the fill a few px inside the top-left
 * diagonal, and just outside that diagonal (the preview). */
async function ringPoints(page: Page, sel: string, cut: number) {
  const b = await page.locator(sel).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  });
  const d = 0.5 / Math.SQRT2; // 0.5 px across a 45 degree edge
  const h = cut / 2;
  return {
    box: b,
    points: [
      { x: b.x + h + d, y: b.y + h + d }, // 0 top-left diagonal, in the ring
      { x: b.r - h - d, y: b.b - h - d }, // 1 bottom-right diagonal, in the ring
      { x: b.x + b.w / 2, y: b.y + 0.5 }, // 2 top edge (control)
      { x: b.x + 0.5, y: b.y + b.h / 2 }, // 3 left edge (control)
      { x: b.x + h + 2.5, y: b.y + h + 2.5 }, // 4 the fill, inside the top-left cut
      { x: b.x + h - 1.5, y: b.y + h - 1.5 }, // 5 outside the top-left cut
      { x: b.r - h - 2.5, y: b.b - h - 2.5 }, // 6 the fill, inside the bottom-right cut
    ],
  };
}

const near = (a: Rgb, b: Rgb, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const over = (fill: Rgb): Rgb =>
  fill.map((v) => Math.round(STEEL * RING_ALPHA + v * (1 - RING_ALPHA))) as Rgb;

/** Both diagonals carry the ring colour: the steel line over the panel fill,
 * the same as the straight edges, and clearly not the bare fill. */
function expectRing(px: Rgb[], what: string) {
  const [tl, br, top, left, fillTl, , fillBr] = px;
  const msg = `${what} ${JSON.stringify(px)}`;
  // The controls are the ring colour (this is what an inset outline drew too).
  expect(near(top, over(fillTl), 12), `top edge is the ring: ${msg}`).toBe(true);
  expect(near(left, over(fillTl), 12), `left edge is the ring: ${msg}`).toBe(true);
  // The diagonals match the ring, not the fill beside them.
  expect(near(tl, over(fillTl), 12), `top-left diagonal is the ring: ${msg}`).toBe(true);
  expect(near(br, over(fillBr), 12), `bottom-right diagonal is the ring: ${msg}`).toBe(true);
  expect(near(tl, top, 12), `top-left diagonal = top edge: ${msg}`).toBe(true);
  for (const [ring, fill] of [
    [tl, fillTl],
    [br, fillBr],
  ] as const)
    for (let i = 0; i < 3; i++)
      expect(ring[i] - fill[i], `ring lighter than the fill: ${msg}`).toBeGreaterThan(30);
}

test("fr5-02 the camera message panel's ring follows its cut corners (and the meter's)", async ({
  page,
}) => {
  await installFakeScanner(page, { mode: "blur" });
  await openScanCamera(page);

  // The sweep's other hit: the meter (7 px cuts), over the live preview.
  const meter = await ringPoints(page, ".m-meter", 7);
  expectRing(await samplePixels(page, meter.points), "meter");

  // "Camera paused": the message panel (12 px cuts).
  await pauseCamera(page);
  const panel = page.locator(".m-cam__msg");
  await expect(panel.locator(".m-cam__msgline")).toHaveText("Camera paused");
  await expect(panel.locator(".swu-btn")).toHaveText("Start");
  await expect(panel.locator(".m-textbtn")).toHaveText("Use the keypad");
  const geo = await panel.evaluate((e) => {
    const cs = getComputedStyle(e);
    const ring = getComputedStyle(e, "::before");
    return {
      shadow: cs.boxShadow,
      fill: cs.backgroundColor,
      pad: cs.padding,
      clip: cs.clipPath,
      ringBg: ring.backgroundColor,
      ringClip: ring.clipPath,
      ringEvents: ring.pointerEvents,
      left: e.getBoundingClientRect().left,
      right: innerWidth - e.getBoundingClientRect().right,
    };
  });
  // The look is the old one (fill, padding, position, 12 px cuts); the outline
  // is no longer an inset shadow but a clipped layer in the same colour.
  expect(geo.shadow).toBe("none");
  expect(geo.fill).toBe("rgba(11, 14, 24, 0.86)");
  expect(geo.pad).toBe("18px 16px");
  expect(geo.clip).toContain("12px 0px");
  expect(geo.ringBg).toBe("rgba(211, 211, 212, 0.28)");
  expect(geo.ringClip).toContain("evenodd");
  expect(geo.ringEvents).toBe("none");
  expect(Math.abs(geo.left - 16)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geo.right - 16)).toBeLessThanOrEqual(0.5);
  const msg = await ringPoints(page, ".m-cam__msg", 12);
  const px = await samplePixels(page, msg.points);
  expectRing(px, "message panel");
  // ... and it is not the preview showing through the cut: the point just
  // outside the diagonal is a different colour.
  expect(near(px[0], px[5], 20), `diagonal vs outside ${JSON.stringify(px)}`).toBe(false);
  // The panel's buttons still work under the ring layer.
  await panel.locator(".swu-btn").click();
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live");
});

// ── fr5-03 ────────────────────────────────────────────────────────────────
/** Record every data-settle value the camera takes, with its time -- and, as
 * the lower reference for the 3 s limit, when each getUserMedia resolved. The
 * product starts its clock only after that (stream subscriber ->
 * settleStart(performance.now())), so "timeout" can never be committed less
 * than 3000 ms after it; unlike the gap between two DOM commits it carries no
 * render delay on the start side. Call BEFORE installFakeScanner: the wrapper
 * is an accessor that wraps whatever getUserMedia is assigned afterwards. */
async function logSettle(page: Page) {
  await page.addInitScript(() => {
    window.__settleLog = [];
    window.__gumAt = [];
    const md = navigator.mediaDevices;
    if (md) {
      let impl = md.getUserMedia.bind(md);
      Object.defineProperty(md, "getUserMedia", {
        configurable: true,
        get: () => async (c?: MediaStreamConstraints) => {
          const s = await impl(c);
          window.__gumAt!.push(performance.now());
          return s;
        },
        set: (f: typeof impl) => void (impl = f),
      });
    }
    const push = (v: string | null) => {
      const log = window.__settleLog!;
      if (v !== null && (!log.length || log[log.length - 1].v !== v))
        log.push({ v, t: performance.now() });
    };
    new MutationObserver(() => {
      push(document.querySelector(".m-cam")?.getAttribute("data-settle") ?? null);
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-settle"],
    });
  });
}

/** The earliest getUserMedia resolve after `afterT` (a page-clock time). */
const liveFrom = (gum: number[], afterT: number) => Math.min(...gum.filter((t) => t >= afterT));

const settleState = (page: Page) =>
  page.evaluate(() => {
    const q = (s: string) => document.querySelector<HTMLElement>(s);
    const rect = (s: string) => {
      const r = q(s)!.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height];
    };
    const word = q(".m-meter__word")!;
    const sub = q(".m-meter__sub")!;
    const status = q(".m-meter [role=status]")!;
    return {
      settle: q(".m-cam")!.getAttribute("data-settle"),
      corner: getComputedStyle(q(".m-guide__corner")!).opacity,
      box: getComputedStyle(q(".m-guide__box")!).opacity,
      shade: getComputedStyle(q(".m-guide__card")!).boxShadow,
      cardOpacity: getComputedStyle(q(".m-guide__card")!).opacity,
      word: word.textContent,
      sub: sub.textContent,
      // What the second line draws: its text nodes' width (0 = nothing).
      subInk: (() => {
        const r = document.createRange();
        r.selectNodeContents(sub);
        return r.getBoundingClientRect().width;
      })(),
      subChildren: sub.childNodes.length,
      label: status.getAttribute("aria-label"),
      live: status.getAttribute("aria-live"),
      statuses: document.querySelectorAll(".m-meter [role=status]").length,
      wordInStatus: status.contains(word),
      rects: {
        card: rect(".m-guide__card"),
        corner: rect(".m-guide__corner"),
        gbox: rect(".m-guide__box"),
        meter: rect(".m-meter"),
        words: rect(".m-meter__words"),
        // The word and the (empty while focusing) line under it: same boxes
        // before and after, so the word does not jump when the state clears.
        word: rect(".m-meter__word"),
        subLine: rect(".m-meter__sub"),
        keypad: rect(".m-meter__keypad"),
        align: rect(".m-cam__align"),
      },
      // The label fits: one line, inside its column, clear of the Keypad link.
      wordRight: (() => {
        const r = document.createRange();
        r.selectNodeContents(word);
        return r.getBoundingClientRect().right;
      })(),
      wordLines: (() => {
        const r = document.createRange();
        r.selectNodeContents(word);
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
      })(),
      wordsRight: q(".m-meter__words")!.getBoundingClientRect().right,
      keypadLeft: q(".m-meter__keypad")!.getBoundingClientRect().left,
      subCut: sub.scrollWidth > sub.clientWidth,
      wordFont: getComputedStyle(word).font,
    };
  });

type Settle = Awaited<ReturnType<typeof settleState>>;

function expectDim(s: Settle) {
  expect(s.settle).toBe("settling");
  expect(s.corner).toBe("0.45");
  expect(s.box).toBe("0.45");
  // The shade around the card is not part of the dimming.
  expect(s.cardOpacity).toBe("1");
  expect(s.shade).toContain("9999px");
  expect(s.word).toBe("Focusing…");
  // REPLACE (owner decision 2026-10-12 after review, T1): just "Focusing…" --
  // no second line (was "Wait to line up"). Nothing is drawn under the word,
  // and the line keeps its height (expectSameLayout: `word`, `subLine`).
  expect(s.sub).toBe("");
  expect(s.subChildren).toBe(0);
  expect(s.subInk).toBe(0);
  expect(s.rects.subLine[3]).toBeGreaterThan(10);
  // Said once, in the meter's own live region.
  expect(s.label).toBe("Focusing…");
  expect(s.live).toBe("polite");
  expect(s.statuses).toBe(1);
  expect(s.wordInStatus).toBe(true);
}

function expectFits(s: Settle) {
  expect(s.wordLines).toBe(1);
  expect(s.wordRight).toBeLessThanOrEqual(s.wordsRight + 0.5);
  expect(s.wordRight).toBeLessThanOrEqual(s.keypadLeft);
  expect(s.subCut).toBe(false);
}

function expectSameLayout(a: Settle, b: Settle) {
  for (const k of Object.keys(a.rects) as (keyof Settle["rects"])[])
    for (let i = 0; i < 4; i++)
      expect(Math.abs(a.rects[k][i] - b.rects[k][i]), `${k}[${i}]`).toBeLessThanOrEqual(0.5);
}

async function expectCleared(page: Page) {
  await expect
    .poll(async () => {
      const s = await settleState(page);
      return [s.corner, s.box].join(" ");
    })
    .toBe("1 1");
  await expect(page.locator(".m-meter__word")).not.toHaveText("Focusing…");
}

test("fr5-03 camera start: the guide is dim with Focusing… until the first sharp frame", async ({
  page,
}) => {
  await logSettle(page);
  // A blurry picture first (flat grey): the state holds while we look at it.
  await installFakeScanner(page, { mode: "blur" });
  await openScanCamera(page);
  const dim = await settleState(page);
  expectDim(dim);
  expectFits(dim);
  // The same word style as every other meter word (no new text style).
  expect(dim.wordFont).toContain("16px");
  expect(await page.evaluate(() => window.__reads)).toBe(0);

  // The picture sharpens: the guide returns at once (well inside the 3 s),
  // the label goes, and nothing on the screen moves.
  await page.evaluate(() => void (window.__fakeCam!.mode = "sharp"));
  await expect(page.locator(".m-cam")).toHaveAttribute("data-settle", "sharp");
  await expectCleared(page);
  await expect(page.locator(".m-meter__word")).toHaveText("Sharp");
  const clear = await settleState(page);
  expectSameLayout(dim, clear);
  expect(clear.wordFont).toBe(dim.wordFont);
  const log = await page.evaluate(() => window.__settleLog!);
  expect(log.map((e) => e.v)).toEqual(["off", "settling", "sharp"]);
  expect(log[2].t - log[1].t).toBeLessThan(3000);
  // A blurry frame later is the meter's "Blurry", not this state again.
  await page.evaluate(() => void (window.__fakeCam!.mode = "blur"));
  await expect(page.locator(".m-meter__word")).toHaveText("Blurry");
  const blurry = await settleState(page);
  expect(blurry.settle).toBe("sharp");
  expect([blurry.corner, blurry.box]).toEqual(["1", "1"]);
  // Reading was never held back: a card in view is read as usual.
  await page.evaluate((read) => {
    window.__fakeRead = read;
    window.__fakeCam!.mode = "sharp";
  }, SOR_229);
  await expect(page.locator(".m-cam")).toHaveAttribute("data-phase", "found");
});

test("fr5-03 no sharp frame: the guide returns at 3 s; no layout moves; Start after pause dims again", async ({
  page,
}) => {
  await logSettle(page);
  await installFakeScanner(page, { mode: "blur" });
  await openScanCamera(page);
  // The whole-pixel text condition (helpers.ts wideText) from the start: the
  // label fits, and the layout is compared dim -> clear under it.
  //
  // PORT (BL-255 part 4): the dim state exists for only 3 s from the stream
  // start, and reaching this snapshot is several runner round trips (the live
  // poll, wideText, settleState) -- on a starved machine they outlast it (6 of
  // 41 runs under load) and the screen is, correctly, already at "timeout".
  // Not a product fault, so a snapshot that arrives too late is taken again on
  // a fresh load of the camera (up to 3 tries); the state is still asserted
  // in full on a real "settling" snapshot, and a run that never gets one fails.
  let widened = await wideText(page);
  let dim = await settleState(page);
  for (let tries = 1; dim.settle === "timeout" && tries < 3; tries++) {
    await page.reload();
    await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live");
    widened = await wideText(page);
    dim = await settleState(page);
  }
  test.info().annotations.push({ type: "fr5-03", description: `wideText applied: ${widened}` });
  expectDim(dim);
  expectFits(dim);
  // An empty / blurry table: it clears by the time limit, the meter then says
  // what it always said for a blurry picture.
  await expect(page.locator(".m-cam")).toHaveAttribute("data-settle", "timeout");
  await expectCleared(page);
  await expect(page.locator(".m-meter__word")).toHaveText("Blurry");
  let log = await page.evaluate(() => window.__settleLog!);
  expect(log.map((e) => e.v)).toEqual(["off", "settling", "timeout"]);
  // REPLACE (BL-255 part 4): was `log[2].t - log[1].t >= 2990`, a gap between
  // two DOM COMMITS. The product's clock starts at the stream start, before
  // the "settling" commit (React render + commit, later on a busy machine),
  // while the 3 s timer's own commit can be prompt -- so the observed gap is
  // 3000 + 1 (timer slack) + d2 - d1 and fell to 2982.7 once (measured under
  // load: min 2997.6 over 29 runs). Same claim, no allowance: from the moment
  // getUserMedia resolved (always before the product's startedAt) the limit
  // cannot commit sooner than 3000 ms. The exact boundary itself is pinned by
  // cameraFlow.test.ts ("FR5-03": settleStatus at +2999 / +3000). The upper
  // bound stays on the DOM gap: render delay only adds to it.
  // (The camera screen may ask for the stream twice in a row, 0.3 ms apart,
  // and the first is discarded; the EARLIEST resolve after the "off" commit is
  // the sound reference, since the live one can only be at or after it.)
  const gum = await page.evaluate(() => window.__gumAt!);
  expect(
    log[2].t - liveFrom(gum, log[0].t),
    "ms from the stream going live to the guide returning"
  ).toBeGreaterThanOrEqual(3000);
  const took = log[2].t - log[1].t;
  expect(took).toBeLessThanOrEqual(3500);
  // Nothing moved when the label went and the guide came back.
  const clear = await settleState(page);
  expectSameLayout(dim, clear);
  // It does not come back while the picture stays blurry.
  await page.waitForTimeout(1200);
  expect((await settleState(page)).settle).toBe("timeout");

  // Start after "Camera paused": a new stream start, the state begins again.
  await pauseCamera(page);
  await expect(page.locator(".m-cam")).toHaveAttribute("data-settle", "off");
  await page.locator(".m-cam__msg .swu-btn").click();
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live");
  // (The meter is a new element after the pause: normal text this time.)
  const again = await settleState(page);
  expectDim(again);
  expectFits(again);
  await expect(page.locator(".m-cam")).toHaveAttribute("data-settle", "timeout");
  await expectCleared(page);
  expectSameLayout(again, await settleState(page));
  log = await page.evaluate(() => window.__settleLog!);
  expect(log.map((e) => e.v)).toEqual(["off", "settling", "timeout", "off", "settling", "timeout"]);
  // The second start runs the same 3 s from its own stream start.
  const gum2 = await page.evaluate(() => window.__gumAt!);
  expect(
    log[5].t - liveFrom(gum2, log[3].t),
    "ms from the restart going live to the guide returning"
  ).toBeGreaterThanOrEqual(3000);
});

test("fr5-03 the default fake camera (Chromium's test pattern): the guide is back within 3.5 s", async ({
  page,
}) => {
  await logSettle(page);
  await page.goto("/scan/#/camera");
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live", { timeout: 20000 });
  await expect(page.locator(".m-cam")).toHaveAttribute("data-settle", /^(sharp|read|timeout)$/);
  await expectCleared(page);
  const log = await page.evaluate(() => window.__settleLog!);
  const start = log.find((e) => e.v === "settling")!;
  const end = log.find((e) => e.v !== "settling" && e.t > start.t)!;
  expect(end.t - start.t).toBeLessThanOrEqual(3500);
  // Which trigger cleared it is recorded on the run (it depends on whether the
  // generated pattern's crop passes the sharpness gate).
  test.info().annotations.push({
    type: "fr5-03",
    description: `default fake camera cleared by "${end.v}" after ${Math.round(end.t - start.t)} ms`,
  });
  console.log(
    `fr5-03 default fake camera: cleared by "${end.v}" after ${Math.round(end.t - start.t)} ms`
  );
});
