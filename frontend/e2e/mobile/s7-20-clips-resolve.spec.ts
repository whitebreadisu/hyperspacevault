import { expect, measureEach } from "./helpers";
import { LANDSCAPE, LANDSCAPE_PHONE, PORTRAIT, test } from "./clip-helpers";

// S7-20: the BL-238 spike's fake-camera clips drive the REAL reader (real
// getUserMedia, real Paddle worker, real scan core -- smoke_test.js `live()`)
// on the scan catalogue (SOR main size 252, the ASHP 16 collision pair). One
// browser per clip (the fake-file flag is a launch flag, clip-helpers.ts).
// Table: clip -> expected result. The no-read clips get a 6 s ceiling
// (smoke_test.js `timeout: 6000`). The three v1 close-up clips are vendored
// but NOT asserted: the v1 guide is not ported.
//
//  fake_v2_std            Cell Block Guard SOR 229/252, prompt -> Add
//  fake_v2_std_landscape  the same card, a landscape stream (1920 x 1080). A
//                         phone on its side (667 x 375, and the spike's
//                         844 x 390) shows the rotate screen and reads nothing
//                         (BL-257 FR5-06); turned upright, the landscape
//                         stream is read.
//  fake_v2_promo          Grogu ASHP 16 -> printed-code collision pick
//  fake_v2_blur           no read, "Blurry"
//  fake_v2_nocode         no read, "Searching"
//  fake_sor229            whole-card framing: no read with the strip guide
test.afterEach(measureEach);

const cam = (page: import("@playwright/test").Page) => page.locator(".m-cam");
const open = async (page: import("@playwright/test").Page) => {
  await page.goto("/scan/#/camera");
  await expect(cam(page)).toHaveAttribute("data-stream", "live", { timeout: 20000 });
};
const ocrCalls = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__ocrCalls!.paddle + window.__ocrCalls!.tesseract);

async function expectCellBlockGuard(page: import("@playwright/test").Page, goto = true) {
  if (goto) await open(page);
  await expect(cam(page)).toHaveAttribute("data-phase", "found", { timeout: 15000 });
  await expect(page.locator(".m-cam__panel .m-ident__name")).toHaveText("Cell Block Guard");
  await expect(page.locator(".m-cam__panel .m-cam__code")).toHaveText("SOR 229/252");
  // Nothing is counted until Add.
  await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);
  await page.locator(".m-cam__panel .m-ident__add .swu-btn").click();
  await expect(page.locator(".m-cam__bar .m-logbtn__n")).toHaveText("1");
}

test.describe("fake_v2_std", () => {
  test.use({ clip: "fake_v2_std" });
  test("s7-20-clips-resolve fake_v2_std -> Cell Block Guard SOR 229/252, prompt-add", async ({
    page,
  }) => {
    await expectCellBlockGuard(page);
  });
});

// BL-257 FR5-06 (owner decision 2026-10-12, F-18) REPLACES the two landscape
// cases. Before: at 667 x 375 the camera read the card in a landscape layout,
// and at 844 x 390 the gate served the desktop tree (no camera). Now a phone on
// its side -- either size -- keeps the scanner behind the rotate screen and
// reads nothing; the landscape STREAM is still read once the phone is upright.
/** On its side: the scanner beneath the rotate screen, nothing read in 6 s. */
async function expectRotateScreenNoRead(page: import("@playwright/test").Page) {
  await page.goto("/scan/#/camera");
  await expect(page.locator(".m-rotate")).toBeVisible();
  await expect(page.locator(".m-app")).toHaveCount(1);
  await expect(page.locator(".app-layout")).toHaveCount(0);
  await expect(cam(page)).toHaveAttribute("data-stream", "live", { timeout: 20000 });
  await page.waitForTimeout(6000);
  await expect(cam(page)).toHaveAttribute("data-phase", "searching");
  expect(await ocrCalls(page), "no read while the rotate screen shows").toBe(0);
}

test.describe("fake_v2_std_landscape", () => {
  test.use({ clip: "fake_v2_std_landscape", clipViewport: LANDSCAPE_PHONE });
  test("s7-20-clips-resolve fake_v2_std_landscape (667 x 375 phone) -> rotate screen, no read; upright -> Cell Block Guard SOR 229/252", async ({
    page,
  }) => {
    await expectRotateScreenNoRead(page);
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator(".m-rotate")).toHaveCount(0);
    await expectCellBlockGuard(page, false);
  });
});

test.describe("fake_v2_std_landscape at 844 x 390", () => {
  test.use({ clip: "fake_v2_std_landscape", clipViewport: LANDSCAPE });
  test("s7-20-clips-resolve fake_v2_std_landscape (844 x 390) -> the phone gate: phone app behind the rotate screen, no read", async ({
    page,
  }) => {
    await expectRotateScreenNoRead(page);
    await expect(page.locator(".m-cam__panel .m-ident__name")).toHaveCount(0);
  });
});

test.describe("fake_v2_promo", () => {
  test.use({ clip: "fake_v2_promo", clipViewport: PORTRAIT });
  test("s7-20-clips-resolve fake_v2_promo -> Grogu ASHP 16, printed-code collision pick", async ({
    page,
  }) => {
    await open(page);
    await expect(cam(page)).toHaveAttribute("data-phase", "pick", { timeout: 15000 });
    const panel = page.locator(".m-cam__panel--amber");
    await expect(panel.locator(".m-cam__code")).toHaveText("ASHP 16");
    const rows = panel.locator(".m-cam__pick");
    await expect(rows).toHaveCount(2);
    // Never auto-resolved (smoke_test.js: auto_accepts_before_pick = 0).
    await page.waitForTimeout(1500);
    await expect(cam(page)).toHaveAttribute("data-phase", "pick");
    await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);
    await rows.filter({ hasText: "Grogu" }).click();
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(page.locator(".m-cam__panel .m-ident__name")).toHaveText("Grogu");
    await page.locator(".m-cam__panel .m-ident__add .swu-btn").click();
    await expect(page.locator(".m-cam__bar .m-logbtn__n")).toHaveText("1");
  });
});

test.describe("fake_v2_blur", () => {
  test.use({ clip: "fake_v2_blur" });
  test("s7-20-clips-resolve fake_v2_blur -> no read, Blurry", async ({ page }) => {
    await open(page);
    // PORT (BL-257 FR5-03): a blurry picture reads "Focusing…" for the first
    // 3 s after the stream starts; "Blurry" is what the meter says after it.
    await expect(cam(page)).toHaveAttribute("data-settle", "timeout");
    await expect(page.locator(".m-meter .m-meter__word")).toHaveText("Blurry");
    await page.waitForTimeout(6000);
    expect(await ocrCalls(page), "a blurry frame is never read").toBe(0);
    await expect(cam(page)).toHaveAttribute("data-phase", "searching");
    await expect(page.locator(".m-cam__panel")).toHaveCount(0);
  });
});

test.describe("fake_v2_nocode", () => {
  test.use({ clip: "fake_v2_nocode" });
  test("s7-20-clips-resolve fake_v2_nocode -> no read, Searching", async ({ page }) => {
    await open(page);
    await expect.poll(() => ocrCalls(page), { timeout: 15000 }).toBeGreaterThan(0);
    await page.waitForTimeout(6000);
    await expect(cam(page)).toHaveAttribute("data-phase", "searching");
    await expect(page.locator(".m-cam__panel")).toHaveCount(0);
    await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);
    // The way out works: the Keypad link opens the keypad in this document.
    await page.locator(".m-meter__keypad").click();
    await expect(page).toHaveURL(/\/scan\/#\/pad/);
    await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  });
});

test.describe("fake_sor229 (whole-card framing)", () => {
  test.use({ clip: "fake_sor229" });
  test("s7-20-clips-resolve fake_sor229 -> no read with the strip guide", async ({ page }) => {
    await open(page);
    await page.waitForTimeout(6000);
    await expect(cam(page)).toHaveAttribute("data-phase", "searching");
    await expect(page.locator(".m-cam__panel")).toHaveCount(0);
    await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);
  });
});
