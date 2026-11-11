import { expect, test } from "./helpers";
import type { Page, Route } from "@playwright/test";

// App Spec §20: getting open tabs current, phone and desktop.
// The dev server has no /build.json of its own (its SPA fallback answers
// index.html), so each test answers the file itself; a "same build" answer
// names the id the page actually baked (bakedBuild), whatever the
// environment set it to.
// No measureEach here: the failure cases make failed requests on purpose.

test.beforeEach(() => {
  const p = test.info().project.name;
  test.skip(p !== "phone-390" && p !== "desktop-1440", "phone-390 and desktop-1440");
});

const BANNER = ".app-update-banner";
const TEXT = "A new version of HyperspaceVault is ready.";
const isPhone = () => test.info().project.name.startsWith("phone");

/** Answers /build.json with `answer`; returns how many times it was asked. */
async function serveBuild(page: Page, answer: (route: Route) => Promise<void>) {
  const hits = { n: 0 };
  await page.route(
    (u) => u.pathname === "/build.json",
    async (route) => {
      hits.n++;
      await answer(route);
    }
  );
  return hits;
}

const json = (build: string) => (route: Route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "no-cache" },
    body: JSON.stringify({ build, version: "2.5.0" }),
  });

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(isPhone() ? ".m-app" : ".app-layout")).toBeVisible();
}

/** The build id baked into the running app (__BUILD_ID__), read through the
 * dev server's module for src/utils/buildCheck.ts, the one the app uses. */
const bakedBuild = (page: Page) =>
  page.evaluate(async (path) => {
    const mod = (await import(/* @vite-ignore */ path)) as { BAKED_BUILD_ID: string };
    return mod.BAKED_BUILD_ID;
  }, "/src/utils/buildCheck.ts");

/** Answers the build file with the id the page itself baked (asked at
 * request time, so it holds whatever VITE_GIT_SHA the dev server got). */
const sameBuild = (page: Page) => async (route: Route) => json(await bakedBuild(page))(route);

/** The window regains focus (what returning to the tab does). */
const focus = (page: Page) => page.evaluate(() => void window.dispatchEvent(new Event("focus")));

/** Counts main-frame navigations from now on (a reload is one). */
function navigations(page: Page) {
  const n = { count: 0 };
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) n.count++;
  });
  return n;
}

test("bl358-newer-build-shows-banner-and-refresh-reloads", async ({ page }) => {
  const hits = await serveBuild(page, json("newer-build-sha"));
  await open(page);
  const banner = page.locator(BANNER);
  await expect(banner).toHaveCount(0);
  await focus(page);
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "status");
  await expect(banner.locator(".verify-email-banner__text")).toHaveText(TEXT);
  await expect(banner.getByRole("button")).toHaveText(["Dismiss", "Refresh"]);
  expect(hits.n).toBe(1);

  // Never over the navigation: under the desktop header, above the phone bar.
  const g = await page.evaluate((sel) => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    return { b: r(sel)!, header: r(".app-header"), nav: r(".m-nav"), iw: innerWidth };
  }, BANNER);
  if (isPhone()) {
    expect(g.b.bottom).toBeLessThanOrEqual(g.nav!.top + 0.5);
    for (const h of await banner
      .getByRole("button")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(h).toBeGreaterThanOrEqual(44);
  } else {
    expect(g.b.top).toBeGreaterThanOrEqual(g.header!.bottom - 0.5);
  }
  expect(g.b.right).toBeLessThanOrEqual(g.iw + 0.5);

  // Refresh reloads the page.
  await page.evaluate(() => ((window as unknown as { __bl358: number }).__bl358 = 1));
  await Promise.all([
    page.waitForEvent("load"),
    banner.getByRole("button", { name: "Refresh" }).click(),
  ]);
  expect(await page.evaluate(() => (window as unknown as { __bl358?: number }).__bl358)).toBe(
    undefined
  );
  // Nothing reloads by itself: the new document waits for its own check.
  await open(page);
  await expect(banner).toHaveCount(0);
});

test("bl358-dismiss-hides-for-that-build", async ({ page }) => {
  await serveBuild(page, json("newer-build-sha"));
  await open(page);
  await focus(page);
  const banner = page.locator(BANNER);
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
});

test("bl358-same-build-no-banner", async ({ page }) => {
  // The page's own baked id, whatever the environment set it to.
  const hits = await serveBuild(page, sameBuild(page));
  await open(page);
  await focus(page);
  await expect.poll(() => hits.n).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator(BANNER)).toHaveCount(0);
});

test("bl358-check-failure-is-silent", async ({ page }) => {
  let mode: "abort" | "500" | "html" = "abort";
  const hits = await serveBuild(page, (route) =>
    mode === "abort"
      ? route.abort("failed")
      : mode === "500"
        ? route.fulfill({ status: 500, body: "no" })
        : route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>x" })
  );
  await open(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Each case past the focus throttle: hide and show the tab between them is
  // not enough (5 min), so each runs on a fresh document.
  for (const m of ["abort", "500", "html"] as const) {
    mode = m;
    if (m !== "abort") await open(page);
    const before = hits.n;
    await focus(page);
    await expect.poll(() => hits.n).toBe(before + 1);
    await page.waitForTimeout(300);
    await expect(page.locator(BANNER), m).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("bl358-dev-server-without-file-is-silent", async ({ page }) => {
  await open(page);
  // Unrouted: the dev server has no build file and answers its SPA fallback.
  const res = page.waitForResponse((r) => new URL(r.url()).pathname === "/build.json");
  await focus(page);
  expect((await res).headers()["content-type"]).toContain("text/html");
  await page.waitForTimeout(300);
  await expect(page.locator(BANNER)).toHaveCount(0);
});

test("bl358-chunk-failure-reloads-once-then-banner", async ({ page }) => {
  await serveBuild(page, sameBuild(page));
  await open(page);
  const nav = navigations(page);
  // Vite's own event for a chunk whose preload failed.
  const fire = () =>
    page.evaluate(() => {
      const e = new Event("vite:preloadError", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  const [, prevented] = await Promise.all([page.waitForEvent("load"), fire()]);
  expect(prevented).toBe(true);
  expect(nav.count).toBe(1);
  await expect(page.locator(isPhone() ? ".m-app" : ".app-layout")).toBeVisible();
  await expect(page.locator(BANNER)).toHaveCount(0);

  // The reload landed on the same build: the guard has fired, so the next
  // failure shows the banner and does not reload again.
  const again = await fire();
  expect(again).toBe(false);
  await expect(page.locator(BANNER)).toBeVisible();
  await expect(page.locator(BANNER)).toContainText(TEXT);
  await page.waitForTimeout(500);
  expect(nav.count).toBe(1);
});

test("bl358-failed-dynamic-import-reloads-once-then-banner", async ({ page }) => {
  await serveBuild(page, sameBuild(page));
  await page.route(
    (u) => u.pathname.startsWith("/assets/bl358-gone-"),
    (route) => route.fulfill({ status: 404, body: "" })
  );
  await open(page);
  const nav = navigations(page);
  // A lazily imported chunk the deploy removed.
  const importGone = () =>
    page.evaluate(() => {
      void import(/* @vite-ignore */ "/assets/bl358-gone-" + "abc123.js");
    });
  await Promise.all([page.waitForEvent("load"), importGone()]);
  expect(nav.count).toBe(1);
  await expect(page.locator(isPhone() ? ".m-app" : ".app-layout")).toBeVisible();
  await importGone();
  await expect(page.locator(BANNER)).toBeVisible();
  await page.waitForTimeout(500);
  expect(nav.count).toBe(1);
});
