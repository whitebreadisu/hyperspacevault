import { readFileSync } from "node:fs";
import { formatVersionLabel } from "../../src/utils/version";
import { expect, measureEach, test } from "./helpers";
import { recorderFor, stubExternal } from "./mock-api";
import type { Page } from "@playwright/test";

// S1-05: the expanded Vault header (rev4 `vault-rest`, `vault-fb-text`,
// `vault-header-same-height`) -- brand stack with the bracketed version on
// line two (R5-2), the text Feedback SWUButton drawn 40 / hit 44 on the title
// row between the brand mark and the account slot, starfield + desktop scrim.
// The brand mark is the initials logo (PORT: it replaced the text wordmark;
// the geometry checks below measure the logo where they measured the word).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone header");
});

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const TAG = `Unofficial Fan Project [${formatVersionLabel(pkg.version)}]`;

/** Title-row geometry: logo, tag, Feedback, account control. */
async function titleRow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const fb = document.querySelector(".m-vh__fb")!;
    const acct = document.querySelector(".m-acct__hit, .m-acct .swu-btn")!;
    const word = document.querySelector(".m-vh__logo") as HTMLElement;
    const tag = document.querySelector(".m-vh__tag") as HTMLElement;
    const top = r(".m-vh__top");
    const f = fb.getBoundingClientRect();
    const a = acct.getBoundingClientRect();
    return {
      wordRight: word.getBoundingClientRect().right,
      tagRight: tag.getBoundingClientRect().right,
      wordTop: word.getBoundingClientRect().top,
      tagTop: tag.getBoundingClientRect().top,
      brandRight: r(".m-vh__brandtext").right,
      fb: { l: f.left, r: f.right, t: f.top, b: f.bottom, w: f.width, h: f.height },
      fbDrawn: fb.querySelector("svg")!.getBoundingClientRect().height,
      fbLabel: fb.getAttribute("aria-label"),
      acct: { l: a.left, r: a.right, w: a.width, h: a.height },
      top: { t: top.top, b: top.bottom },
      hdrH: (document.querySelector(".m-vh") as HTMLElement).offsetHeight,
      iw: innerWidth,
    };
  });
}

function expectRowFits(m: Awaited<ReturnType<typeof titleRow>>) {
  // On the title row, logo and tag line wholly left of Feedback,
  // Feedback left of the account control, nothing past the viewport.
  expect(m.fb.t).toBeGreaterThanOrEqual(m.top.t - 1);
  expect(m.fb.b).toBeLessThanOrEqual(m.top.b + 1);
  expect(m.wordRight).toBeLessThanOrEqual(m.fb.l);
  expect(m.tagRight).toBeLessThanOrEqual(m.fb.l);
  expect(m.brandRight).toBeLessThanOrEqual(m.fb.l + 0.5);
  expect(m.fb.r).toBeLessThanOrEqual(m.acct.l + 6);
  expect(m.acct.r).toBeLessThanOrEqual(m.iw);
  expect(m.tagTop).toBeGreaterThan(m.wordTop);
  expect(m.fb.w).toBeGreaterThanOrEqual(44);
  expect(m.fb.h).toBeGreaterThanOrEqual(44);
  expect(Math.round(m.fbDrawn)).toBe(40);
  expect(m.acct.w).toBeGreaterThanOrEqual(44);
  expect(m.acct.h).toBeGreaterThanOrEqual(44);
}

test("s1-05-header-rest", async ({ page }) => {
  await page.goto("/#/vault");
  await expect(page.locator(".m-acct__hit")).toBeVisible();
  await expect(page.locator(".m-vh__word")).toHaveCount(0);
  await expect(page.locator(".m-vh__brandtext img.m-vh__logo")).toHaveAttribute(
    "alt",
    "Hyperspace Vault"
  );
  await expect(page.locator(".m-vh__tag")).toHaveText(TAG);
  expect(TAG).toMatch(/ \[v\d+\.\d+(\.\d+)?\]$/);
  const m = await titleRow(page);
  expectRowFits(m);
  expect(m.fbLabel).toBe("Leave Feedback");
  await expect(page.locator(".m-vh__fb")).toHaveText("Feedback");

  // The logo: 30 px tall in an 80 px box, contained, left-aligned, loaded
  // (REPLACE: the wordmark's face checks). Tag line Barlow Condensed
  // uppercase, 11 px.
  await page.locator(".m-vh__logo").evaluate((img: HTMLImageElement) => img.decode());
  const faces = await page.evaluate(() => {
    const img = document.querySelector(".m-vh__logo") as HTMLImageElement;
    const l = getComputedStyle(img);
    const b = img.getBoundingClientRect();
    const t = getComputedStyle(document.querySelector(".m-vh__tag")!);
    const brand = document.querySelector(".m-vh__brandtext")!.getBoundingClientRect();
    return {
      logo: { w: b.width, h: b.height, fit: l.objectFit, pos: l.objectPosition },
      loaded: img.complete && img.naturalWidth > 0,
      left: Math.round(b.left - brand.left),
      tf: t.fontFamily,
      tt: t.textTransform,
      ts: t.fontSize,
    };
  });
  expect(faces.logo).toEqual({ w: 80, h: 30, fit: "contain", pos: "0% 50%" });
  expect(faces.loaded).toBe(true);
  expect(faces.left).toBe(0);
  expect(faces.tf).toMatch(/Barlow Condensed/);
  expect(faces.tt).toBe("uppercase");
  expect(faces.ts).toBe("11px");
  // The version keeps desktop's casing ("v1.5.1", index.css .app-header__version).
  await expect(page.locator(".m-vh__ver")).toHaveCSS("text-transform", "none");

  // Static starfield layer under desktop's header scrim (index.css .app-header::before).
  const sky = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".m-vh__sky")!);
    return { img: s.backgroundImage, size: s.backgroundSize, pos: s.backgroundPosition };
  });
  expect(sky.img).toContain("linear-gradient(90deg, rgba(9, 11, 20, 0.62), rgba(9, 11, 20, 0.28))");
  expect(sky.img).toMatch(/starfield_[A-Z]+\.jpg/);
  expect(sky.size).toMatch(/^cover(, cover)*$/);
  expect(sky.pos).toMatch(/^50% 50%(, 50% 50%)*$/);

  await page.locator(".m-vh__fb").click();
  await expect(page).toHaveURL(/#\/more\/feedback$/);
});

test("s1-05-header-same-height", async ({ page, browser }, info) => {
  // rev4 compared the text and icon Feedback variants; the icon variant is
  // retired (R5), so the invariant is re-expressed across the account
  // slot's two states: signed in (avatar) and signed out (Sign in).
  await page.goto("/#/vault");
  await expect(page.locator(".m-acct__hit")).toBeVisible();
  const signedIn = await titleRow(page);

  const ctx = await browser.newContext({
    ...info.project.use,
    storageState: { cookies: [], origins: [] },
  });
  const out = await ctx.newPage();
  // BL-255: this page is outside the fixture; give it the same no-internet
  // stubs (its strays land in the fixture page's list, checked at teardown).
  await stubExternal(out, recorderFor(page).external);
  await out.route(
    (u) => u.pathname.startsWith("/api/"),
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await out.goto("/#/vault");
  await expect(out.locator(".m-acct .swu-btn")).toBeVisible();
  const signedOut = await titleRow(out);
  await ctx.close();

  expect(
    Math.abs(signedIn.hdrH - signedOut.hdrH),
    JSON.stringify({ in: [signedIn.hdrH, signedIn.top], out: [signedOut.hdrH, signedOut.top] })
  ).toBeLessThanOrEqual(1);
  expectRowFits(signedIn);
  expectRowFits(signedOut);
});
