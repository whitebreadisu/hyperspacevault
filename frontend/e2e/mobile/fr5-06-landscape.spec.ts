import type { Page } from "@playwright/test";
import { expect, measure, scrollBy, test, wideText } from "./helpers";
import { FSHEET } from "./filters-helpers";
import { recorderFor } from "./mock-api";

// BL-257 FR5-06 (owner decision 2026-10-12, F-18): a phone held on its side
// keeps the phone app (it used to fall into the desktop tree at >= 768 px)
// behind a "Turn your phone upright" screen; the app stays mounted beneath.
//
// How the harness turns the phone: the phone projects are `isMobile` +
// `hasTouch`, so Chromium reports (hover: none) and (pointer: coarse), and
// Playwright's device-metrics override sets `screen.orientation.type` from the
// viewport it is given (landscape-primary when wider than tall) and reports
// the SCREEN at the viewport's size (`screen.width` x `screen.height` =
// the viewport, as on an Android phone, which swaps them on a turn). So
// `page.setViewportSize` IS the turn -- each test asserts the screen
// orientation and size it relies on rather than assuming them.
//
// Review FR5 S5 / N8 (fix run 2026-10-12): the gate's second arm is keyed to
// the device -- touch-primary AND the screen's short side <= 500 CSS px --
// not to the viewport's height. Where a case needs a screen that differs from
// the viewport (a keyboard-shrunk viewport; an iPhone, whose screen sizes do
// not swap) it sets both with CDP `Emulation.setDeviceMetricsOverride`
// (`width` / `height` = viewport, `screenWidth` / `screenHeight` = screen).
//   (a) fr5-06-panel-*      the panel, its two lines, no overflow
//   (b) fr5-06-state-*      route, open sheet, scroll, typed search survive
//   (c) fr5-06-covered      the covered app cannot be tapped or focused
//   (d) fr5-06-desktop-*    desktop-1440: short / narrow mouse windows
//       fr5-06-tablet-*     phone projects: a touch tablet is still desktop
//   (e) the scanner         s7-25-fr5-06-scan-landscape.spec.ts (scan project)
const PHONE = (name: string) => name.startsWith("phone");
const SIDE = { width: 874, height: 402 }; // iPhone 16 Pro on its side
const SIDE_SMALL = { width: 667, height: 375 }; // iPhone SE on its side
const SIDE_LARGE = { width: 932, height: 430 }; // iPhone 16 Pro Max on its side
const SIDE_LARGEST = { width: 960, height: 480 }; // a large Android phone on its side
const PANEL = ".m-rotate";

test.afterEach(async ({ page }, info) => {
  if (PHONE(info.project.name)) return measure(page);
  // The phone control-size check does not apply to the desktop tree.
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
  expect(rec.failed, "failed requests").toEqual([]);
});

const device = (page: Page) =>
  page.evaluate(() => ({
    type: screen.orientation?.type ?? null,
    touchFirst: matchMedia("(hover: none) and (pointer: coarse)").matches,
    w: innerWidth,
    h: innerHeight,
    sw: screen.width,
    sh: screen.height,
  }));

type Metrics = {
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  landscape: boolean;
};
/** Viewport and screen set separately (CDP). Returns the session; undo with
 * `restore`. */
async function setDevice(page: Page, m: Metrics) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: m.viewport.width,
    height: m.viewport.height,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: m.screen.width,
    screenHeight: m.screen.height,
    screenOrientation: m.landscape
      ? { type: "landscapePrimary", angle: 90 }
      : { type: "portraitPrimary", angle: 0 },
  });
  await expect.poll(async () => (await device(page)).h).toBe(m.viewport.height);
  const d = await device(page);
  expect([d.w, d.h, d.sw, d.sh], "harness: viewport and screen as set").toEqual([
    m.viewport.width,
    m.viewport.height,
    m.screen.width,
    m.screen.height,
  ]);
  expect(d.type).toMatch(m.landscape ? /^landscape/ : /^portrait/);
  expect(d.touchFirst, "harness: touch-first").toBe(true);
  return cdp;
}
/** Back to the project's own viewport (Playwright re-applies its override). */
async function restore(page: Page, upright: { width: number; height: number }) {
  await page.setViewportSize({ width: upright.width + 1, height: upright.height });
  await page.setViewportSize(upright);
}

async function openVault(page: Page, hash = "#/vault") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Turn the phone and wait for the app to have seen it. */
async function turn(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  const side = size.width > size.height;
  await expect(page.locator(PANEL)).toHaveCount(side ? 1 : 0);
  const d = await device(page);
  expect(d.type).toMatch(side ? /^landscape/ : /^portrait/);
  // The harness reports the screen at the viewport's size.
  expect([d.sw, d.sh], "harness: screen = viewport").toEqual([size.width, size.height]);
}

/** The panel fills the viewport, both lines are inside it and not cut, and
 * nothing scrolls sideways. 0.5 px = rounding only. */
async function panelFit(page: Page) {
  return page.evaluate((sel) => {
    const panel = document.querySelector<HTMLElement>(sel)!;
    const p = panel.getBoundingClientRect();
    const bad: string[] = [];
    if (p.left > 0.5 || p.top > 0.5 || p.right < innerWidth - 0.5 || p.bottom < innerHeight - 0.5)
      bad.push(`panel ${p.left},${p.top} ${p.width}x${p.height} in ${innerWidth}x${innerHeight}`);
    if (
      panel.scrollWidth > panel.clientWidth + 0.5 ||
      panel.scrollHeight > panel.clientHeight + 0.5
    )
      bad.push(`panel scrolls ${panel.scrollWidth}x${panel.scrollHeight}`);
    const cs = getComputedStyle(panel);
    const inner = {
      l: p.left + parseFloat(cs.paddingLeft),
      r: p.right - parseFloat(cs.paddingRight),
      t: p.top + parseFloat(cs.paddingTop),
      b: p.bottom - parseFloat(cs.paddingBottom),
    };
    for (const el of panel.querySelectorAll<HTMLElement>(".m-rotate__title, .m-rotate__sub, svg")) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = el.tagName === "svg" ? el.getBoundingClientRect() : range.getBoundingClientRect();
      const name = el.getAttribute("class");
      if (!r.width || !r.height) bad.push(`${name} has no box`);
      if (r.left < inner.l - 0.5 || r.right > inner.r + 0.5)
        bad.push(`${name} x ${r.left}..${r.right} outside ${inner.l}..${inner.r}`);
      if (r.top < inner.t - 0.5 || r.bottom > inner.b + 0.5)
        bad.push(`${name} y ${r.top}..${r.bottom} outside ${inner.t}..${inner.b}`);
      if (el.scrollWidth > el.clientWidth + 0.5) bad.push(`${name} cut`);
    }
    if (document.documentElement.scrollWidth > innerWidth) bad.push("page scrolls sideways");
    return bad;
  }, PANEL);
}

// ── (a) the panel ──────────────────────────────────────────────────────────
// (SIDE_LARGE / SIDE_LARGEST: review FR5 S5 -- large phones on their side.)
for (const size of [SIDE, SIDE_SMALL, SIDE_LARGE, SIDE_LARGEST]) {
  test(`fr5-06-panel-${size.width}x${size.height}`, async ({ page }, info) => {
    test.skip(!PHONE(info.project.name), "phone projects");
    await openVault(page);
    expect((await device(page)).touchFirst, "harness: touch-first").toBe(true);
    await turn(page, size);

    // The phone app, not the desktop tree.
    await expect(page.locator(".m-app")).toHaveCount(1);
    await expect(page.locator(".app-layout")).toHaveCount(0);
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("role", "status");
    await expect(panel.locator(".m-rotate__title")).toHaveText("Turn your phone upright");
    await expect(panel.locator(".m-rotate__sub")).toHaveText(
      "Hyperspace Vault is built for portrait on phones."
    );
    // Nothing to press.
    await expect(panel.locator("button, a, input, [role=button]")).toHaveCount(0);
    // The title wears the sheet title's label style.
    const title = await panel.locator(".m-rotate__title").evaluate((e) => {
      const cs = getComputedStyle(e);
      return [cs.fontFamily.includes("Barlow Condensed"), cs.fontSize, cs.textTransform];
    });
    expect(title).toEqual([true, "20px", "uppercase"]);
    await page.waitForTimeout(200); // the 0.15 s fade is over
    expect(await panel.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");

    expect(await panelFit(page), "fits, normal text").toEqual([]);
    // The whole-pixel text condition (the panel is a <body> child).
    await wideText(page, PANEL);
    expect(await panelFit(page), "fits, wide text").toEqual([]);

    // It is the top layer at every corner and the centre.
    const top = await page.evaluate((sel) => {
      const pts = [
        [2, 2],
        [innerWidth - 2, 2],
        [2, innerHeight - 2],
        [innerWidth - 2, innerHeight - 2],
        [innerWidth / 2, innerHeight / 2],
      ];
      return pts.map(([x, y]) => !!document.elementFromPoint(x, y)?.closest(sel));
    }, PANEL);
    expect(top).toEqual([true, true, true, true, true]);
    await turn(page, info.project.use.viewport!);
  });
}

test("fr5-06-panel-reduced-motion", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openVault(page);
  await turn(page, SIDE);
  expect(await page.locator(PANEL).evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await turn(page, info.project.use.viewport!);
  await turn(page, SIDE);
  const anim = await page.locator(PANEL).evaluate((e) => {
    const cs = getComputedStyle(e);
    return [cs.animationName, parseFloat(cs.animationDuration)];
  });
  expect(anim[0]).toBe("m-rotate-in");
  expect(anim[1] as number).toBeLessThanOrEqual(0.15);
  await turn(page, info.project.use.viewport!);
});

// ── (b) state survives ─────────────────────────────────────────────────────
test("fr5-06-state-survives-sheet-and-scroll", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects");
  const upright = info.project.use.viewport!;
  await openVault(page);
  await scrollBy(page, ".m-vault__scroll", 900);
  await page.locator(".m-filterbtn").click();
  await expect(page.locator(FSHEET)).toBeVisible();
  await page.waitForTimeout(350);
  const mark = async () =>
    page.evaluate((fsheet) => {
      const w = window as unknown as { __fr506?: Element[] };
      const nodes = [
        document.querySelector(".m-app")!,
        document.querySelector(".m-vault__scroll")!,
        document.querySelector(fsheet)!,
      ];
      const same = w.__fr506 ? nodes.every((n, i) => n === w.__fr506![i]) : null;
      w.__fr506 ??= nodes;
      return {
        same,
        hash: location.hash,
        scrollTop: document.querySelector(".m-vault__scroll")!.scrollTop,
        sheets: document.querySelectorAll(".m-sheet-layer").length,
      };
    }, FSHEET);
  const before = await mark();
  expect(before.scrollTop).toBeGreaterThan(300);
  expect(before.sheets).toBe(1);

  await turn(page, SIDE);
  await page.waitForTimeout(300);
  // Beneath the panel: the same app, not re-mounted.
  await expect(page.locator(".m-app")).toHaveCount(1);
  await expect(page.locator(FSHEET)).toHaveCount(1);
  expect((await mark()).same, "same nodes while on its side").toBe(true);

  await turn(page, upright);
  await page.waitForTimeout(300);
  const after = await mark();
  expect(after.same, "same .m-app, list and sheet nodes: nothing re-mounted").toBe(true);
  expect(after.hash).toBe(before.hash);
  expect(after.sheets).toBe(1);
  await expect(page.locator(FSHEET)).toBeVisible();
  expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(0.5);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", /.*/);
});

test("fr5-06-state-survives-typed-search-and-focus", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects");
  const upright = info.project.use.viewport!;
  await openVault(page);
  const input = page.locator(".m-search__input");
  await input.click();
  await input.pressSequentially("luke");
  await expect(input).toBeFocused();
  const rows = await page.locator(".m-row").count();

  await turn(page, SIDE);
  // Focus has left the covered app.
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await turn(page, upright);
  await expect(input).toHaveValue("luke");
  await expect(input).toBeFocused(); // back where it was
  await expect(page.locator(".m-row")).toHaveCount(rows);
  await page.locator(".m-search__clear").click();
});

// ── (c) the covered app is not interactive ─────────────────────────────────
test("fr5-06-covered-app-cannot-be-tapped-or-focused", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects");
  await openVault(page);
  await turn(page, SIDE);
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  const hash = await page.evaluate(() => location.hash);
  // Where a Vault row and the bottom bar's More tab are, under the panel.
  const targets = await page.evaluate(() =>
    [".m-row", ".m-nav .m-tab:last-child", ".m-filterbtn"].map((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })
  );
  for (const t of targets) {
    if (t.x < 0 || t.y < 0 || t.x > SIDE.width || t.y > SIDE.height) continue;
    await page.touchscreen.tap(t.x, t.y);
    await page.mouse.click(t.x, t.y);
  }
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
  // The keyboard cannot reach it either: nothing in the app takes focus.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("#root")),
      "focus inside the covered app"
    ).toBe(false);
  }
  // A scripted focus is refused too.
  const took = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".m-search__input")!;
    el.focus();
    return document.activeElement === el;
  });
  expect(took).toBe(false);
  // Hidden from assistive tech: the app has no accessible content, the panel does.
  // (The browser's own accessibility tree: Playwright's aria snapshot is
  // computed in the page and does not apply `inert`.)
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const names = nodes
    .filter((n) => !n.ignored && n.role?.value !== "RootWebArea")
    .map((n) => String(n.name?.value ?? ""))
    .filter(Boolean);
  // (The tree carries the title as drawn: uppercased by CSS.)
  expect(names.join(" | ").toLowerCase()).toContain("turn your phone upright");
  expect(names.join(" | ")).toContain("Hyperspace Vault is built for portrait on phones.");
  expect(
    names.filter((n) => !/turn your phone upright|built for portrait on phones/i.test(n)),
    "accessible names outside the panel"
  ).toEqual([]);
  await turn(page, info.project.use.viewport!);
  await page.locator(".m-filterbtn").click();
  await expect(page.locator(FSHEET)).toBeVisible();
});

// ── (d) who is NOT a phone ─────────────────────────────────────────────────
test("fr5-06-desktop-short-mouse-window-is-desktop", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "desktop project (mouse)");
  await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();
  for (const size of [
    { width: 1280, height: 480 }, // a desktop window resized short
    { width: 768, height: 1024 }, // the old boundary, tall
    { width: 768, height: 480 }, // the old boundary, short
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect((await device(page)).touchFirst, "harness: a mouse").toBe(false);
    await expect(page.locator(".app-layout"), JSON.stringify(size)).toBeVisible();
    await expect(page.locator(".m-app")).toHaveCount(0);
    await expect(page.locator(PANEL)).toHaveCount(0);
  }
});

test("fr5-06-desktop-narrow-mouse-window-has-no-rotate-screen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "desktop project (mouse)");
  // A narrow desktop window is the phone app, as before (the 767 px arm). Its
  // monitor is a landscape screen: that alone must not raise the rotate screen.
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto("/");
  await expect(page.locator(".m-app")).toBeVisible();
  expect((await device(page)).type).toMatch(/^landscape/);
  await expect(page.locator(PANEL)).toHaveCount(0);
  await page.setViewportSize({ width: 500, height: 400 }); // and short
  await page.waitForTimeout(150);
  await expect(page.locator(".m-app")).toBeVisible();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", /.*/);
});

test("fr5-06-tablet-touch-is-desktop", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects (touch)");
  await openVault(page);
  for (const size of [
    { width: 1024, height: 768 }, // tablet landscape
    { width: 768, height: 1024 }, // tablet portrait
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".app-layout"), JSON.stringify(size)).toBeVisible();
    expect((await device(page)).touchFirst).toBe(true);
    await expect(page.locator(".m-app")).toHaveCount(0);
    await expect(page.locator(PANEL)).toHaveCount(0);
  }
  // 767 wide and tall is still the phone app, upright: no rotate screen.
  await page.setViewportSize({ width: 767, height: 1024 });
  await expect(page.locator(".m-app")).toBeVisible();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await page.setViewportSize(info.project.use.viewport!);
  await expect(page.locator(".m-row").first()).toBeVisible();
});

// An upright phone whose keyboard has shrunk the viewport until it is wider
// than tall is NOT on its side: the screen is still portrait.
test("fr5-06-keyboard-shrunk-viewport-is-not-landscape", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects");
  // PORT (review FR5 S5, fix run 2026-10-12): same case and same expectations;
  // the CDP call moved into `setDevice`, which also asserts the screen size.
  await openVault(page);
  // The viewport a 390-wide phone has left above its keyboard, with the
  // screen reported upright (Playwright alone would call 390 x 300 landscape).
  const cdp = await setDevice(page, {
    viewport: { width: 390, height: 300 },
    screen: { width: 390, height: 844 },
    landscape: false,
  });
  const d = await device(page);
  expect(d.w).toBeGreaterThan(d.h);
  await page.waitForTimeout(250);
  await expect(page.locator(".m-app")).toBeVisible();
  await expect(page.locator(".app-layout")).toHaveCount(0);
  await expect(page.locator(PANEL)).toHaveCount(0);
  // The same viewport with the screen on its side IS the rotate screen.
  await setDevice(page, {
    viewport: { width: 390, height: 300 },
    screen: { width: 844, height: 390 },
    landscape: true,
  });
  await expect(page.locator(PANEL)).toHaveCount(1);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await restore(page, info.project.use.viewport!);
  await turn(page, info.project.use.viewport!);
});

// Review FR5 S5: a landscape TABLET whose on-screen keyboard shrinks the
// layout viewport (1024 x 768 -> 1024 x 380). Under a viewport-height rule it
// flipped to the phone app and showed the rotate screen mid-typing; the gate
// reads the screen's short side (768), so nothing changes.
test("fr5-06-tablet-keyboard-shrunk-viewport-stays-desktop", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects (touch)");
  await openVault(page);
  await page.setViewportSize({ width: 1024, height: 768 }); // tablet landscape
  await expect(page.locator(".app-layout")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __fr506tab?: Element }).__fr506tab =
      document.querySelector(".app-layout")!;
  });
  const cdp = await setDevice(page, {
    viewport: { width: 1024, height: 380 },
    screen: { width: 1024, height: 768 },
    landscape: true,
  });
  await page.waitForTimeout(300); // long enough for a wrong gate to swap trees
  await expect(page.locator(".app-layout")).toBeVisible();
  await expect(page.locator(".m-app")).toHaveCount(0);
  await expect(page.locator(PANEL)).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __fr506tab?: Element }).__fr506tab ===
        document.querySelector(".app-layout")
    ),
    "the same desktop tree: nothing re-mounted when the keyboard opened"
  ).toBe(true);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", /.*/);
  // A tablet upright with its keyboard up (768 x 420 of a 768 x 1024 screen).
  await setDevice(page, {
    viewport: { width: 768, height: 420 },
    screen: { width: 768, height: 1024 },
    landscape: false,
  });
  await page.waitForTimeout(300);
  await expect(page.locator(".app-layout")).toBeVisible();
  await expect(page.locator(".m-app")).toHaveCount(0);
  await expect(page.locator(PANEL)).toHaveCount(0);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await restore(page, info.project.use.viewport!);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await expect(page.locator(PANEL)).toHaveCount(0);
});

// An iPhone does not swap screen.width / screen.height when it turns: on its
// side the screen still reads 402 x 874. The short side is what the gate reads.
test("fr5-06-iphone-screen-sizes-not-swapped-is-still-a-phone", async ({ page }, info) => {
  test.skip(!PHONE(info.project.name), "phone projects");
  await openVault(page);
  const cdp = await setDevice(page, {
    viewport: { width: 874, height: 402 },
    screen: { width: 402, height: 874 },
    landscape: true,
  });
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(".m-app")).toHaveCount(1);
  await expect(page.locator(".app-layout")).toHaveCount(0);
  // Large phones: the viewport and screen 932 x 430, and 960 x 480.
  for (const size of [SIDE_LARGE, SIDE_LARGEST]) {
    await setDevice(page, { viewport: size, screen: size, landscape: true });
    await expect(page.locator(PANEL), JSON.stringify(size)).toHaveCount(1);
    await expect(page.locator(".m-app")).toHaveCount(1);
    await expect(page.locator(".app-layout")).toHaveCount(0);
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await restore(page, info.project.use.viewport!);
  await turn(page, info.project.use.viewport!);
});
