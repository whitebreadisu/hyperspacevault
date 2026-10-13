import { readFileSync } from "node:fs";
import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installApiMocks, recorderFor } from "./mock-api";
import type { CardsFixture, Recorder } from "./mock-api";

// BL-247 S1-10: shared e2e helpers -- ports of the rev4 check script's
// (.ds-sync/mobile-check-rev4.mjs) swipe / pullDown / scrollBy / wheel /
// layoutProbe / expectFn / measure, expressed against the real app.

/** The Auth emulator SDK pins a "Running in emulator mode" banner over the
 * bottom of the page (connectAuthEmulator without disableWarnings); it would
 * sit on top of the bottom bar. Hidden in the harness only. */
export function hideEmulatorBanner() {
  const add = () => {
    const st = document.createElement("style");
    st.textContent = ".firebase-emulator-warning{display:none!important}";
    document.head.append(st);
  };
  if (document.head) add();
  else document.addEventListener("DOMContentLoaded", add);
}

/** True when a Playwright storageState (a file path or the object) carries a
 * Firebase Auth session (auth.setup.ts saves one in IndexedDB). */
export function hasStoredSession(state: unknown): boolean {
  if (!state) return false;
  const text = typeof state === "string" ? readFileSync(state, "utf8") : JSON.stringify(state);
  return text.includes("firebase:authUser:");
}

/** BL-255 part 2: how the app document now in `page` came up -- "in" / "out"
 * once Firebase Auth has finished restoring the stored session (the SDK's own
 * `authStateReady()`, reached through the dev server's module for
 * src/firebase.ts, the instance the app itself uses), or "not-app" for a
 * document that does not load src/ (only index.html and scan.html do). The
 * app shows nothing but "Loading…" until then (App.tsx), so this is not a
 * wait the tests need -- it is what lets the harness say WHY a page is signed
 * out. With `keys`, also what the SDK's IndexedDB store holds at that moment. */
export async function authState(
  page: Page
): Promise<{ state: "in" | "out" | "not-app"; keys: string }> {
  for (;;) {
    try {
      return await page.evaluate(async (path) => {
        if (!document.querySelector('script[type="module"][src^="/src/"]'))
          return { state: "not-app" as const, keys: "" };
        const mod = (await import(/* @vite-ignore */ path)) as {
          auth: { authStateReady(): Promise<void>; currentUser: object | null };
        };
        await mod.auth.authStateReady();
        const keys = await new Promise<string>((resolve) => {
          const open = indexedDB.open("firebaseLocalStorageDb");
          open.onerror = () => resolve("open failed: " + String(open.error));
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
              db.close();
              return resolve("no firebaseLocalStorage store");
            }
            const req = db
              .transaction("firebaseLocalStorage")
              .objectStore("firebaseLocalStorage")
              .getAllKeys();
            req.onsuccess = () => (db.close(), resolve(JSON.stringify(req.result)));
            req.onerror = () => (db.close(), resolve("read failed: " + String(req.error)));
          };
        });
        return { state: mod.auth.currentUser ? ("in" as const) : ("out" as const), keys };
      }, "/src/firebase.ts");
    } catch (e) {
      // The document navigated under the question (e.g. the hop to /scan/):
      // ask the document that replaced it. Anything else is a real error.
      if (page.isClosed()) return { state: "not-app", keys: "" };
      if (!/Execution context was destroyed|because of a navigation/.test(String(e))) throw e;
      await page.waitForLoadState("load");
    }
  }
}

/** Everything a page of the suite gets, in one place (the `page` fixture
 * below and clip-helpers.ts's own-browser fixture both call it): the API
 * double and the no-internet stubs (mock-api.ts), the emulator banner hidden,
 * and one check. `session`: the context was created with a signed-in
 * storageState, so the first app document it opens must come up signed in.
 * If it does not (CI run 38387701220: a page signed out from its first frame,
 * cause not found), the test fails at that `page.goto`, saying so and what
 * the SDK's store held, instead of timing out 30 s later on a control that
 * only a signed-in page shows. Only the first app document is checked: a
 * test may sign out afterwards. */
export async function harnessPage(
  page: Page,
  opts: { fixture?: CardsFixture; session: boolean }
): Promise<Recorder> {
  const rec = await installApiMocks(page, { fixture: opts.fixture });
  await page.addInitScript(hideEmulatorBanner);
  if (opts.session) {
    const goto = page.goto.bind(page);
    page.goto = (async (url, options) => {
      const res = await goto(url, options);
      const { state, keys } = await authState(page);
      if (state === "not-app") return res;
      page.goto = goto;
      if (state === "out")
        throw new Error(
          "BL-255: the stored session was not restored -- this context was created with a " +
            "signed-in storageState, but Firebase Auth came up signed out on its first app " +
            `document (${page.url()}). IndexedDB firebaseLocalStorage keys: ${keys}`
        );
      return res;
    }) as Page["goto"];
  }
  return rec;
}

/** BL-255 part 2: the suite is hermetic -- a page that asked a host other
 * than this machine for something the harness does not answer fails its test. */
export function expectNoInternet(rec: Recorder): void {
  expect(
    rec.external,
    "requests to the internet (answer the host in mock-api.ts stubExternal, or drop the request)"
  ).toEqual([]);
}

/** `test` with the API mocks installed on every page; pick the catalogue with
 * `test.use({ cardsFixture: "base-cards-600" })`. */
export const test = base.extend<{ cardsFixture: CardsFixture }>({
  cardsFixture: ["base-cards", { option: true }],
  page: async ({ page, cardsFixture, storageState }, provide) => {
    const rec = await harnessPage(page, {
      fixture: cardsFixture,
      session: hasStoredSession(storageState),
    });
    await provide(page);
    expectNoInternet(rec);
  },
});
export { expect };

/** Finger swipe along x at height y (CDP touch events). */
export async function swipe(page: Page, fromX: number, toX: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fromX, y }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: fromX + ((toX - fromX) * i) / 8, y }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Vertical finger pull of `dist` px from (x, y); end=false leaves the finger down. */
export async function pullDown(page: Page, x: number, y: number, dist: number, end = true) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (dist * i) / 10 }],
    });
    await page.waitForTimeout(16);
  }
  if (end) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(380);
}

/** Scroll a container in small steps so scroll events fire like a finger drag. */
export async function scrollBy(page: Page, sel: string, total: number) {
  for (let i = 1; i <= 6; i++) {
    await page
      .locator(sel)
      .first()
      .evaluate((e, d) => void (e.scrollTop += d), total / 6);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(420);
}

/** Synthetic wheel events (deltaY) on a container, `gap` ms apart. */
export async function wheel(page: Page, sel: string, deltas: number[], gap: number) {
  for (const d of deltas) {
    await page
      .locator(sel)
      .first()
      .evaluate((e, dy) => {
        e.scrollTop += dy;
        e.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, bubbles: true }));
      }, d);
    await page.waitForTimeout(gap);
  }
  await page.waitForTimeout(400);
}

/** Assert a page-side predicate holds (after a short settle). */
export async function expectFn<A>(
  page: Page,
  fn: (arg: A) => boolean,
  arg: A,
  label: string
): Promise<void> {
  await page.waitForTimeout(250);
  const ok = await page.evaluate(fn, arg);
  expect(ok, `STATE CHECK FAILED: ${label}`).toBe(true);
}

type ProbeWindow = { __ls: number; __frames: number; __counting: boolean };

/** R3-6 layout probe: Blink's own LayoutCount / RecalcStyleCount over one
 * trigger, plus layout-shift entries and frames counted with rAF. */
export async function layoutProbe(page: Page, trigger: () => void, waitMs = 420) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.evaluate(() =>
    document
      .querySelectorAll('img[loading="lazy"]')
      .forEach((i) => ((i as HTMLImageElement).loading = "eager"))
  );
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    const w = window as unknown as ProbeWindow;
    w.__ls = 0;
    w.__frames = 0;
    w.__counting = false;
    try {
      new PerformanceObserver((l) => {
        if (w.__counting) w.__ls += l.getEntries().length;
      }).observe({ type: "layout-shift" });
    } catch {
      /* layout-shift unsupported */
    }
    const tick = () => {
      if (w.__counting) w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(500);
  const get = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])
    ) as Record<string, number>;
  const m0 = await get();
  await page.evaluate(() => void ((window as unknown as ProbeWindow).__counting = true));
  await page.evaluate(trigger);
  await page.waitForTimeout(waitMs);
  await page.evaluate(() => void ((window as unknown as ProbeWindow).__counting = false));
  const m1 = await get();
  const extra = await page.evaluate(() => {
    const w = window as unknown as ProbeWindow;
    return { shifts: w.__ls, frames: w.__frames };
  });
  await cdp.send("Performance.disable");
  return {
    layouts: m1.LayoutCount - m0.LayoutCount,
    styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount,
    ...extra,
  };
}

/** The per-test health check (S1-10 e): every visible interactive control in
 * `.m-app` is >= 44 x 44 (except `data-hit="overhang"` and the starfield
 * strip's ticks), no horizontal page overflow, and nothing erred since the
 * test started (pageerror / console error / failed request). */
export async function measure(page: Page): Promise<void> {
  const rec: Recorder = recorderFor(page);
  const r = await page.evaluate(() => {
    const small: string[] = [];
    const sel = ".m-app button, .m-app a, .m-app input, .m-app [role=button]";
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if ((el as HTMLElement).dataset.hit === "overhang") continue;
      if (el.closest(".m-vh__ticks")) continue;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!b.width || !b.height || cs.visibility === "hidden" || cs.display === "none") continue;
      if (b.width < 43.5 || b.height < 43.5) {
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24);
        small.push(
          `${Math.round(b.width)}x${Math.round(b.height)} ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${label}`
        );
      }
    }
    return {
      small,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    };
  });
  expect(r.small, "controls under 44x44").toEqual([]);
  expect(r.overflow, `horizontal overflow (scrollWidth ${r.sw} > ${r.iw})`).toBe(false);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
}

/** `test.afterEach(measureEach)` -- the form the brief's "every spec ends with
 * afterEach(measure)" takes (afterEach hands a fixtures object, not a page). */
export async function measureEach({ page }: { page: Page }): Promise<void> {
  await measure(page);
}

/** The whole-pixel text condition (PR #226 CI fix run). Linux Chromium -- the
 * CI runner -- snaps every glyph advance to a whole CSS px, where Windows,
 * macOS and iOS position glyphs at fractions. With the same web fonts loaded,
 * Barlow (body) nets out level, but Barlow Condensed labels draw 0.43 to
 * 0.67 px per glyph wider (measured: FILTERS 14 px 39.5 -> 44, CLEAR 13 px
 * 29.9 -> 32, "Whole box · 2 decks" 11 px 112.1 -> 120.3), which is what
 * turned 3 to 8 px text fits into cuts on CI only.
 *
 * On a browser with sub-pixel text this widens every Barlow Condensed text
 * now in `.m-app` by 0.7 px per glyph (the top of the measured range) and
 * returns true. Where the browser already snaps it does nothing and returns
 * false: that run IS the condition. One shot -- call it again after the app
 * re-renders the elements under test. A text fit asserted before and after
 * this call holds on both kinds of platform, whichever one runs the suite. */
export async function wideText(page: Page, root = ".m-app"): Promise<boolean> {
  // `root`: FR5-06's rotate screen is a <body> child beside `.m-app`.
  return page.evaluate((root) => {
    const c = document.createElement("canvas").getContext("2d")!;
    const snapped = [13, 14, 15, 17].every((px) => {
      c.font = `600 ${px}px "Barlow Condensed"`;
      return Number.isInteger(c.measureText("Whole box 2 decks").width);
    });
    if (snapped) return false;
    for (const el of document.querySelectorAll<HTMLElement>(root + " *")) {
      if (el.dataset.wideText) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      const cs = getComputedStyle(el);
      if (!own || !cs.fontFamily.includes("Barlow Condensed")) continue;
      const now = parseFloat(cs.letterSpacing) || 0;
      el.style.setProperty("letter-spacing", `${now + 0.7}px`, "important");
      el.dataset.wideText = "1";
    }
    return true;
  }, root);
}

/** Everything the camera panel shows during one Fast-add / prompt-mode HOLD,
 * read in the one synchronous callback that sees the phase become `hold`. */
export interface HoldFacts {
  phase: string | null;
  count: string | null;
  name: string | null;
  meta: string | null;
  code: string | null;
  added: string | null;
  holdtxt: string | null;
  addBtns: number;
  readouts: number;
  verifyBtn: string | null;
  verifyEmpty: boolean;
  /** Every phase entered so far, in order, as of this hold (ends with `hold`). */
  phaseLog: string[];
  frameSrc: string | null;
  barDuration: string | null;
  /** With `fit`: the label's fit before and after the CI text condition (+0.7 px letter-spacing). */
  fit?: Record<
    "normal" | "wide",
    { lines: number; right: number; limit: number; bar: number } | null
  >;
}
declare global {
  interface Window {
    __holds?: HoldFacts[];
  }
}

/** Record the hold panel atomically, per hold. Call BEFORE the page loads.
 *
 * Root cause (BL-255 part 3): a hold lasts only HOLD_MS = 1 s, and a test that
 * checks the panel with several sequential awaits (each a round trip to the
 * browser) outlives it whenever the machine is busy -- the scanner is back to
 * `searching`, the panel is gone, and a later check finds nothing. So the
 * facts are read once, synchronously, in the MutationObserver callback that
 * sees `data-phase` become `hold` (and again on the next frame, replacing the
 * first when the hold is still up), and the test asserts on that object with
 * `holdFacts`. `wrongAt: n` also taps "Wrong card" in the same callback of the
 * n-th hold (0-based), for tests that must act INSIDE the hold. */
export async function recordHolds(page: Page, opts: { fit?: boolean; wrongAt?: number } = {}) {
  await page.addInitScript((o) => {
    window.__holds = [];
    const log: string[] = [];
    const txt = (sel: string) => {
      const e = document.querySelector(sel);
      return e ? (e.textContent ?? "").replace(/\s+/g, " ").trim() : null;
    };
    const fitOf = () => {
      const t = document.querySelector(".m-cam__holdtxt");
      const bar = document.querySelector(".m-cam__holdbar");
      const inner = document.querySelector(".m-cam__panelin");
      if (!t || !bar || !inner) return null;
      const range = document.createRange();
      range.selectNodeContents(t);
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      const cs = getComputedStyle(inner);
      return {
        lines: tops.size,
        right: t.getBoundingClientRect().right,
        limit: inner.getBoundingClientRect().right - parseFloat(cs.paddingRight),
        bar: bar.getBoundingClientRect().width,
      };
    };
    // Same rule as wideText() above, for the elements inside the camera panel.
    const widen = () => {
      const c = document.createElement("canvas").getContext("2d")!;
      const snapped = [13, 14, 15, 17].every((px) => {
        c.font = `600 ${px}px "Barlow Condensed"`;
        return Number.isInteger(c.measureText("Whole box 2 decks").width);
      });
      if (snapped) return;
      for (const el of document.querySelectorAll<HTMLElement>(".m-app *")) {
        if (el.dataset.wideText) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
        const cs = getComputedStyle(el);
        if (!own || !cs.fontFamily.includes("Barlow Condensed")) continue;
        const now = parseFloat(cs.letterSpacing) || 0;
        el.style.setProperty("letter-spacing", `${now + 0.7}px`, "important");
        el.dataset.wideText = "1";
      }
    };
    const read = (): HoldFacts => {
      const cam = document.querySelector(".m-cam");
      const logbtn = document.querySelector(".m-cam__bar .m-logbtn");
      const facts: HoldFacts = {
        phase: cam?.getAttribute("data-phase") ?? null,
        count: txt(".m-cam__bar .m-logbtn__n"),
        name: txt(".m-cam__panel .m-ident__name"),
        meta: txt(".m-cam__panel .m-ident__meta"),
        code: txt(".m-cam__panel .m-cam__code"),
        added: txt(".m-ident__added"),
        holdtxt: txt(".m-cam__holdtxt"),
        addBtns: document.querySelectorAll(".m-cam__panel .m-ident__add .swu-btn").length,
        readouts: document.querySelectorAll(".m-cam__panel .m-readout").length,
        verifyBtn: txt(".m-cam__bar .m-logbtn"),
        verifyEmpty: !!logbtn?.classList.contains("m-logbtn--empty"),
        phaseLog: log.slice(),
        frameSrc:
          document.querySelector(".m-cam__panel .m-ident__frame img")?.getAttribute("src") ?? null,
        barDuration: (() => {
          const b = document.querySelector(".m-cam__holdbar");
          return b ? getComputedStyle(b).animationDuration : null;
        })(),
      };
      if (o.fit) {
        const normal = fitOf();
        widen();
        facts.fit = { normal, wide: fitOf() };
      }
      return facts;
    };
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target as HTMLElement;
        if (!el.classList?.contains("m-cam")) continue;
        const ph = el.getAttribute("data-phase");
        if (ph && ph !== m.oldValue) log.push(ph);
        if (el.getAttribute("data-phase") !== "hold" || m.oldValue === "hold") continue;
        const i = window.__holds!.length;
        window.__holds!.push(read());
        if (o.wrongAt === i)
          (document.querySelector(".m-cam__wrong") as HTMLElement | null)?.click();
        else if (!o.fit)
          // (`fit` widens the glyphs once, so it is read once.)
          requestAnimationFrame(() => {
            if (document.querySelector(".m-cam")?.getAttribute("data-phase") === "hold")
              window.__holds![i] = read();
          });
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-phase"],
      attributeOldValue: true,
    });
  }, opts);
}

/** The facts of the n-th hold (0-based), waiting for it to have started. */
export async function holdFacts(page: Page, n = 0, timeout?: number): Promise<HoldFacts> {
  await expect
    .poll(() => page.evaluate((i) => window.__holds?.[i] != null, n), {
      message: `hold #${n} never started`,
      timeout,
    })
    .toBe(true);
  return page.evaluate((i) => window.__holds![i], n);
}

/** Rendered colours [r, g, b] at viewport points given in CSS px (FR5-02).
 * One viewport screenshot at the device scale, decoded on a blank page of the
 * same context (the page under test may forbid data: images), each point read
 * from the device pixel that contains it. */
export async function samplePixels(
  page: Page,
  points: { x: number; y: number }[]
): Promise<[number, number, number][]> {
  const png = (await page.screenshot({ type: "png", scale: "device" })).toString("base64");
  const css = await page.evaluate(() => innerWidth);
  const pad = await page.context().newPage();
  try {
    return await pad.evaluate(
      async ({ png, points, css }) => {
        const img = new Image();
        img.src = "data:image/png;base64," + png;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const k = img.naturalWidth / css;
        return points.map((p) => {
          const d = g.getImageData(Math.floor(p.x * k), Math.floor(p.y * k), 1, 1).data;
          return [d[0], d[1], d[2]] as [number, number, number];
        });
      },
      { png, points, css }
    );
  } finally {
    await pad.close();
  }
}

/** Centre of the first element matching `sel` (rev4 check script `center`). */
export async function center(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}
