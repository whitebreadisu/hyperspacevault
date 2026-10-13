import type { Page } from "@playwright/test";
import { expect, measureEach, test, wideText } from "./helpers";
import { installFakeScanner, openScanCamera, SOR_229 } from "./scan-helpers";

// BL-262 (owner on his iPhone, 2026-10-12 / 2026-10-13). In an s7-* file: the
// scanner specs run in the `scan` project only.
//
//  1. Fast add must not add a card the user still has to choose. The scan loop
//     reads one card (the denominator names the printing), but the add went
//     through the keypad resolver on {set, number}, which defaults a shared
//     number to the base-set card -- so Fast add added that default at once.
//     Now it adds on its own only when the keypad panel for the read would ask
//     nothing about which card or which printing AND would add a printing the
//     camera read; otherwise the panel prompt mode shows comes up, the user
//     chooses, taps Add, and the hold starts.
//  2. The hold after an add is 1 s (was 1.5 s).
//  3. The 3 s same-card wait after an add is gone (owner 2026-10-13). What
//     still stops a double add: the hold; in Fast add the card must leave the
//     frame before it is read again; in prompt mode nothing is added without a
//     tap. The 3 s wait stays after Wrong card (it stops the same read popping
//     straight back).
//
// No committed fake-camera clip shows a shared number (the clips are SOR 229,
// one card in two finishes, and ASHP 16, which the loop already classes as a
// pick), so these drive the real frame pipeline, sharpness gate, scan core,
// Acceptor, decision flow and batch through stage 7b's seam: the canvas camera
// + the scripted reader (scan-helpers.ts). The collision cards are in
// scan-fixture.ts.
test.use({ cardsFixture: "base-cards-scan" });
test.afterEach(measureEach);

declare global {
  interface Window {
    __phases?: string[];
  }
}

const cam = (p: Page) => p.locator(".m-cam");
const panel = (p: Page) => p.locator(".m-cam__panel");
const badge = (p: Page) => p.locator(".m-cam__bar .m-logbtn");
const count = (p: Page) => p.locator(".m-cam__bar .m-logbtn__n");
const chips = (p: Page, axis: string) =>
  panel(p).locator(`.m-ident__axis[data-axis="${axis}"] .m-chip`);
const addBtn = (p: Page) => panel(p).locator(".m-ident__add .swu-btn");

const show = (page: Page, text: string | null) =>
  page.evaluate((t) => {
    window.__fakeRead = t;
  }, text);

/** Every phase the camera enters, in order (set up before the page loads). */
async function logPhases(page: Page) {
  await page.addInitScript(() => {
    window.__phases = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target as HTMLElement;
        if (!el.classList?.contains("m-cam")) continue;
        const p = el.getAttribute("data-phase");
        if (p && p !== m.oldValue) window.__phases!.push(p);
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-phase"],
      attributeOldValue: true,
    });
  });
}
const phases = (page: Page) => page.evaluate(() => window.__phases ?? []);

/** Open the camera with nothing in frame; Fast add on or off. */
async function open(page: Page, fastAdd: boolean) {
  await logPhases(page);
  await installFakeScanner(page, { read: null });
  await openScanCamera(page);
  const fast = page.locator(".m-tool__fast");
  if (fastAdd) await fast.click();
  await expect(fast).toHaveAttribute("aria-checked", fastAdd ? "true" : "false");
}

test.describe("BL-262 Fast add asks before it adds", () => {
  // The owner's case. SOR 74 is a base-set card and the P25 74 Darth Vader
  // Showcase (home set SOR): the keypad panel asks "Which card?".
  test("s7-26-bl262 reproduction: a number shared by two cards (SOR 74) is not added until the user chooses", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN C 74/252"); // stays in frame for the whole test
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(panel(page).locator(".m-cam__code")).toHaveText("SOR 74/252");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await expect(chips(page, "cardKey")).toHaveCount(2);
    // Never resolved on its own.
    await page.waitForTimeout(2000);
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    expect(await phases(page)).toEqual(["found"]);

    // Choose the other card, then Add: that card, one copy, the Fast add hold.
    await chips(page, "cardKey").filter({ hasText: "Darth Vader" }).click();
    await expect(panel(page).locator(".m-ident__name")).toHaveText("Darth Vader");
    await expect(panel(page).locator(".m-ident__meta")).toContainText("P25 74");
    await addBtn(page).click();
    await expect(count(page)).toHaveText("1");
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    await expect(page.locator(".m-cam__holdtxt")).toHaveText("Fast add · next card in 1 s");
    await expect(page.locator(".m-ident__added")).toContainText("In batch 1");
    await expect(panel(page).locator(".m-ident__name")).toHaveText("Darth Vader");
    await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    // Fast add is on and the card never left the frame: it is not read again
    // (no second prompt, no second copy).
    await page.waitForTimeout(3500);
    await expect(count(page)).toHaveText("1");
    expect(await phases(page)).toEqual(["found", "hold", "searching"]);
  });

  test("s7-26-bl262 a Weekly Play printing on a base-set number (SOR 12/20) never adds the base-set card", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 12/20");
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(panel(page).locator(".m-cam__code")).toHaveText("SOR 12/20");
    await page.waitForTimeout(1500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await chips(page, "cardKey").filter({ hasText: "Resupply" }).click();
    await expect(panel(page).locator(".m-ident__name")).toHaveText("Resupply");
    await show(page, null);
    await addBtn(page).click();
    await expect(count(page)).toHaveText("1");
    await expect(page.locator(".m-ident__added")).toContainText("In batch 1");
    await expect(panel(page).locator(".m-ident__name")).toHaveText("Resupply");
  });

  test("s7-26-bl262 one card with two events under one number (SOR 172) waits for the choice", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 172/252");
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(chips(page, "setKey")).toHaveCount(2);
    await page.waitForTimeout(1500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await chips(page, "setKey").filter({ hasText: "Galactic Championship" }).click();
    await expect(panel(page).locator(".m-ident__meta")).toContainText("P26 172");
    await show(page, null);
    await addBtn(page).click();
    await expect(count(page)).toHaveText("1");
    expect(await phases(page)).toEqual(["found", "hold"]);
  });

  test("s7-26-bl262 a token read (SOR T1) is never added as the card that holds its number", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN T1");
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(panel(page).locator(".m-cam__code")).toHaveText("SOR T1");
    await page.waitForTimeout(2000);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    expect(await phases(page)).toEqual(["found"]);
  });

  test("s7-26-bl262 N/2 tournament stamps (SOR 1/2): the pick list, then the panel's own question -- nothing added on the way", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 1/2");
    await expect(cam(page)).toHaveAttribute("data-phase", "pick");
    await page.waitForTimeout(1500);
    await expect(cam(page)).toHaveAttribute("data-phase", "pick");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await page.locator(".m-cam__pick").filter({ hasText: "Darth Vader" }).click();
    // The row's number (SOR 1) is shared by other cards: the panel asks.
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(chips(page, "cardKey")).not.toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    expect(await phases(page)).toEqual(["pick", "found"]);
  });

  test("s7-26-bl262 a printed-code collision (ASHP 16): the pick list, then one copy of the chosen card", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "ASHP • EN 16"); // stays in frame
    await expect(cam(page)).toHaveAttribute("data-phase", "pick");
    await page.waitForTimeout(1500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await page.locator(".m-cam__pick").filter({ hasText: "Grogu" }).click();
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    await expect(count(page)).toHaveText("1");
    await expect(panel(page).locator(".m-ident__name")).toHaveText("Grogu");
    await expect(page.locator(".m-cam__holdtxt")).toHaveText("Fast add · next card in 1 s");
    // The card is still in frame: whatever the camera shows next, it adds
    // nothing more without a tap (a pick is a question, never an add).
    await page.waitForTimeout(4500);
    await expect(count(page)).toHaveText("1");
    expect((await phases(page)).filter((p) => p === "hold")).toHaveLength(1);
  });
});

test.describe("BL-262 Fast add keeps its speed; the hold is 1 s", () => {
  test("s7-26-bl262 one card, one printing: added at once (no prompt), 1 s hold, label fits, never twice while it stays", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 100/252"); // stays in frame
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    await expect(count(page)).toHaveText("1");
    const txt = page.locator(".m-cam__holdtxt");
    await expect(txt).toHaveText("Fast add · next card in 1 s");
    // The bar runs for the hold's length.
    expect(
      await page.locator(".m-cam__holdbar").evaluate((e) => getComputedStyle(e).animationDuration)
    ).toBe("1s");
    // The label fits beside the bar: one line, inside the panel; and again
    // with every glyph 0.7 px wider (the CI text condition).
    const fit = () =>
      page.evaluate(() => {
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
      });
    const check = (m: Awaited<ReturnType<typeof fit>>, label: string) => {
      expect(m, label + ": the hold was still up").not.toBeNull();
      expect(m!.lines, label).toBe(1);
      expect(m!.right, label).toBeLessThanOrEqual(m!.limit + 0.5);
      expect(m!.bar, label + ": the bar keeps its room").toBeGreaterThan(60);
    };
    check(await fit(), "normal text");
    await wideText(page);
    check(await fit(), "wide text");

    await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    // Left under the camera: never a second copy (the 3 s wait is gone; the
    // card must leave the frame first).
    await page.waitForTimeout(5000);
    await expect(count(page)).toHaveText("1");
    expect(await phases(page)).toEqual(["hold", "searching"]);
  });

  test("s7-26-bl262 Fast add: a card taken out of the frame and brought back is added again", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, SOR_229);
    await expect(count(page)).toHaveText("1");
    await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    await show(page, null); // out of the frame
    await page.waitForTimeout(1500);
    await expect(count(page)).toHaveText("1");
    await show(page, SOR_229); // back
    await expect(count(page)).toHaveText("2", { timeout: 4000 });
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    expect((await phases(page)).filter((p) => p === "found" || p === "pick")).toEqual([]);
  });
});

test.describe("BL-262 after the 3 s wait is gone", () => {
  test("s7-26-bl262 prompt mode: Add, the 1 s hold, the card still in view -> the prompt returns; nothing is added without a tap", async ({
    page,
  }) => {
    await open(page, false);
    await show(page, SOR_229); // stays in frame
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await addBtn(page).click();
    await expect(count(page)).toHaveText("1");
    await expect(page.locator(".m-cam__holdtxt")).toHaveText("next card in 1 s");
    // The same card is prompted again once the hold is over -- well inside the
    // 3 s the old wait took (the hold's 1 s + a few reads).
    const t0 = Date.now();
    await expect
      .poll(async () => (await phases(page)).join(" "), { timeout: 6000, intervals: [100] })
      .toBe("found hold searching found");
    expect(Date.now() - t0, "re-prompted without the 3 s wait").toBeLessThan(3800);
    await expect(panel(page).locator(".m-ident__name")).toHaveText("Cell Block Guard");
    // It waits there: no copy is added on its own.
    await page.waitForTimeout(3000);
    await expect(count(page)).toHaveText("1");
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    // A second tap is a second copy -- the user's decision.
    await addBtn(page).click();
    await expect(count(page)).toHaveText("2");
  });

  test("s7-26-bl262 Wrong card keeps its 3 s: the same read does not come straight back", async ({
    page,
  }) => {
    await open(page, false);
    await show(page, SOR_229); // stays in frame
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await panel(page).locator(".m-cam__wrong").click();
    await expect(cam(page)).toHaveAttribute("data-phase", "searching");
    // Still quiet 2.2 s later (without the wait it is back in under a second).
    await page.waitForTimeout(2200);
    await expect(cam(page)).toHaveAttribute("data-phase", "searching");
    expect(await phases(page)).toEqual(["found", "searching"]);
    // Past 3 s the card is read again.
    await expect(cam(page)).toHaveAttribute("data-phase", "found", { timeout: 4000 });
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
  });
});
