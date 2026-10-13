import type { Page } from "@playwright/test";
import { expect, measureEach, test, wideText } from "./helpers";
import { installFakeScanner, openScanCamera, SOR_229 } from "./scan-helpers";

// BL-262 (owner on his iPhone, 2026-10-12 / 2026-10-13). In an s7-* file: the
// scanner specs run in the `scan` project only.
//
//  1. "Trust what the strip says" (owner 2026-10-13). The scan loop reads one
//     card -- the strip's denominator, T prefix and printed code say which --
//     but the add and the panel used to re-resolve {set, number} through the
//     keypad resolver, which defaults a shared number to the base-set card. So
//     Fast add added the base-set card for a Weekly Play strip, and prompt
//     mode opened on (and added) the keypad's default. Now the printings the
//     strip identified travel with the read: Fast add adds THAT printing at
//     once, the panel opens on THAT card, and nothing the strip did not
//     identify is ever offered or added.
//  2. Fast add asks only when the strip itself is more than one printing. The
//     early sets print one strip on the foil and the non-foil: "Ask foil or
//     non-foil each time" (owner 2026-10-13) -- nothing is added until Finish
//     is chosen; the choice then adds and holds. Several cards = the pick
//     list, then the same rules with the picked row's printings.
//  3. The hold after an add is 1 s (was 1.5 s).
//  4. The 3 s same-card wait after an add is gone (owner 2026-10-13). What
//     still stops a double add: the hold; in Fast add the card must leave the
//     frame before it is read again; in prompt mode nothing is added without a
//     tap. The 3 s wait stays after Wrong card.
//
// Dispositions against stage 1's version of this file (reason: the owner's
// 2026-10-13 decisions in 1 and 2): the SOR 74 / SOR 12/20 / SOR 172 / SOR T1
// "is not added until the user chooses" tests are REPLACED by "added at once
// as the card read" (SOR 12/20: "Finish is asked on Resupply's own panel");
// the SOR 1/2 test is REPLACED (the picked row's panel, its stamps only);
// "taken out and brought back" is PORTED to a one-printing strip (SOR 229 now
// asks Finish); the hold, label-fit, prompt-mode and Wrong-card tests are
// kept. New: the early-set Finish question, the prompt-mode panel tests and
// the Verify sheet naming the read card.
//
// Fix run after the review (owner decisions 2026-10-13, marked in place): a
// token is named but never added, in either mode (REPLACE: the Fast add token
// test and the token row of the prompt-mode test); Serialized Prestige asks
// which of its three printings in both modes (new; review S1).
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
const anyChips = (p: Page) => panel(p).locator(".m-ident__axis .m-chip");
const addBtn = (p: Page) => panel(p).locator(".m-ident__add .swu-btn");
const name = (p: Page) => panel(p).locator(".m-ident__name");
const meta = (p: Page) => panel(p).locator(".m-ident__meta");
const verify = (p: Page) => p.locator(".m-sheet-layer--verify");

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

/** Fast add: `strip` is added at once as `card` / `printing` -- no prompt. */
async function addedAtOnce(page: Page, strip: string, card: string, printing: string) {
  await show(page, strip);
  await expect(cam(page)).toHaveAttribute("data-phase", "hold");
  await expect(count(page)).toHaveText("1");
  await expect(name(page)).toHaveText(card);
  await expect(meta(page)).toHaveText(printing);
  await expect(page.locator(".m-ident__added")).toContainText("In batch 1");
  expect((await phases(page)).filter((p) => p === "found" || p === "pick")).toEqual([]);
}

/** The Verify sheet lists exactly these card names (one row per copy). */
async function verifyLists(page: Page, names: string[]) {
  await show(page, null);
  await badge(page).click();
  await expect(verify(page)).toBeVisible();
  await expect(verify(page).locator('.m-vsec[data-section="add"] .m-vfyrow')).toHaveCount(
    names.length
  );
  for (const n of names) await expect(verify(page)).toContainText(n);
}

test.describe("BL-262 Fast add adds the card the strip identified, with no prompt", () => {
  // The owner's case. SOR 74 is a base-set card and the P25 74 Darth Vader
  // Showcase (home set SOR): the keypad asks "Which card?"; the strip does not.
  test("s7-26-bl262 a number another card also holds (SOR 74/252): the base-set card at once, never twice while it stays", async ({
    page,
  }) => {
    await open(page, true);
    await addedAtOnce(page, "SOR • EN C 74/252", "Scan Filler 74", "SOR 74 · Standard");
    await expect(panel(page).locator(".m-cam__code")).toHaveText("SOR 74/252");
    await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    // Fast add is on and the card never left the frame: not read again.
    await page.waitForTimeout(3500);
    await expect(count(page)).toHaveText("1");
    expect(await phases(page)).toEqual(["hold", "searching"]);
  });

  test("s7-26-bl262 a Weekly Play printing on a base-set number (SOR 3/20): the Weekly Play card, and Verify names it", async ({
    page,
  }) => {
    await open(page, true);
    await addedAtOnce(page, "SOR • EN 3/20", "Waylay", "SOR 3 · Weekly Play");
    await verifyLists(page, ["Waylay"]);
    await expect(verify(page)).not.toContainText("Scan Filler 3");
  });

  test("s7-26-bl262 a strip the keypad would default to another card (SOR 2, no denominator): the card read", async ({
    page,
  }) => {
    await open(page, true);
    await addedAtOnce(page, "SOR • EN 2", "Darth Vader", "SOR 2 · Hyperspace");
  });

  // REPLACE (owner decision 2026-10-13 after review: tokens are not added by
  // scanning -- the keypad cannot enter one either). Was: the token added at
  // once and listed by the Verify sheet. Kept: the read is named as the TOKEN,
  // never the card that holds its number.
  for (const fastAdd of [true, false])
    test(`s7-26-bl262 a token (SOR T1), ${fastAdd ? "Fast add" : "prompt mode"}: named as the token, Add to batch unavailable, nothing added`, async ({
      page,
    }, testInfo) => {
      await open(page, fastAdd);
      await show(page, "SOR • EN T1"); // stays in frame
      await expect(cam(page)).toHaveAttribute("data-phase", "found");
      await expect(panel(page).locator(".m-cam__code")).toHaveText("SOR T1");
      await expect(name(page)).toHaveText("Experience");
      await expect(meta(page)).toHaveText("SOR 1 · Standard");
      await expect(anyChips(page)).toHaveCount(0);
      const hint = panel(page).locator(".m-ident__choicehint");
      await expect(hint).toHaveText("Tokens can't be added from the camera.");
      await expect(addBtn(page)).toHaveAttribute("aria-disabled", "true");
      // Wrong card and the Keypad link are still there.
      await expect(panel(page).locator(".m-cam__wrong")).toBeVisible();
      await expect(page.locator(".m-meter__keypad")).toBeVisible();
      // The line fits the panel, under normal text and with every glyph wider.
      for (const label of ["normal text", "wide text"]) {
        if (label === "wide text") await wideText(page);
        const m = await hint.evaluate((e) => {
          const inner = document.querySelector(".m-cam__panelin")!;
          const pad = parseFloat(getComputedStyle(inner).paddingRight);
          const range = document.createRange();
          range.selectNodeContents(e);
          return {
            lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
            ink: Math.round(range.getBoundingClientRect().width * 10) / 10,
            box: Math.round(e.getBoundingClientRect().width * 10) / 10,
            right: e.getBoundingClientRect().right,
            limit: inner.getBoundingClientRect().right - pad,
            clipped: e.scrollWidth > e.clientWidth + 0.5,
            add: document.querySelector(".m-cam__panel .m-ident__add")!.getBoundingClientRect()
              .bottom,
            view: window.innerHeight,
          };
        });
        testInfo.annotations.push({ type: "fit " + label, description: JSON.stringify(m) });
        expect(m.lines, label + ": the line is one line").toBe(1);
        expect(m.ink, label + ": inside its box").toBeLessThanOrEqual(m.box + 0.5);
        expect(m.right, label).toBeLessThanOrEqual(m.limit + 0.5);
        expect(m.clipped, label).toBe(false);
        expect(m.add, label + ": the buttons stay on screen").toBeLessThanOrEqual(m.view + 0.5);
      }
      // Nothing is added on its own, and the unavailable Add adds nothing.
      await page.waitForTimeout(2000);
      await addBtn(page).click({ force: true });
      await expect(cam(page)).toHaveAttribute("data-phase", "found");
      await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
      expect(await phases(page)).toEqual(["found"]);
      // Wrong card restarts the scan; still nothing in the batch.
      await show(page, null);
      await panel(page).locator(".m-cam__wrong").click();
      await expect(cam(page)).toHaveAttribute("data-phase", "searching");
      await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    });

  test("s7-26-bl262 a card with another event's printing under the same number (SOR 172/252): the printing the strip names", async ({
    page,
  }) => {
    await open(page, true);
    await addedAtOnce(page, "SOR • EN 172/252", "Scan Filler 172", "SOR 172 · Standard");
  });
});

test.describe("BL-262 Fast add asks only when the strip is more than one printing", () => {
  test("s7-26-bl262 early-set foil / non-foil (SOR 229/252): nothing is added until Finish is chosen; then that finish, the hold, never twice", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, SOR_229); // stays in frame for the whole test
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(name(page)).toHaveText("Cell Block Guard");
    await expect(panel(page).locator(".m-ident__frame img")).toHaveCount(1); // the card's art is up
    await expect(chips(page, "finish")).toHaveText(["Standard", "Standard Foil"]);
    await expect(chips(page, "finish").and(page.locator("[aria-pressed='true']"))).toHaveCount(0);
    await expect(anyChips(page)).toHaveCount(2); // Finish only: no card or set question
    await expect(meta(page)).toHaveCount(0); // no printing named before the choice
    await expect(addBtn(page)).toHaveAttribute("aria-disabled", "true");
    const hint = panel(page).locator(".m-ident__choicehint");
    await expect(hint).toHaveText("Foil and non-foil share this number. Pick the one you have.");
    // The question fits the panel: under normal text and with every glyph wider.
    const fit = () =>
      page.evaluate(() => {
        const inner = document.querySelector(".m-cam__panelin")!;
        const lim = inner.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(inner).paddingRight);
        const over = [...inner.querySelectorAll(".m-ident__choicehint, .m-chip, .m-ident__name")]
          .map((e) => ({ r: e.getBoundingClientRect(), e: e as HTMLElement }))
          .filter(
            ({ r, e }) => r.right > lim.right - pad + 0.5 || e.scrollWidth > e.clientWidth + 0.5
          );
        return {
          over: over.length,
          bottom: lim.bottom,
          view: window.innerHeight,
          add: document.querySelector(".m-cam__panel .m-ident__add")!.getBoundingClientRect()
            .bottom,
        };
      });
    for (const label of ["normal text", "wide text"]) {
      if (label === "wide text") await wideText(page);
      const m = await fit();
      expect(m.over, label + ": nothing clipped or past the panel").toBe(0);
      expect(m.add, label + ": the buttons stay on screen").toBeLessThanOrEqual(m.view + 0.5);
    }
    // Never resolved on its own; tapping the disabled Add adds nothing.
    await page.waitForTimeout(2000);
    await addBtn(page).click({ force: true });
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    expect(await phases(page)).toEqual(["found"]);

    // The choice is the last thing asked: it adds and holds.
    await chips(page, "finish").filter({ hasText: "Standard Foil" }).click();
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    await expect(count(page)).toHaveText("1");
    await expect(meta(page)).toHaveText("SOR 229 · Standard Foil");
    await expect(page.locator(".m-cam__holdtxt")).toHaveText("Fast add · next card in 1 s");
    await expect(page.locator(".m-ident__added")).toContainText("In batch 1");
    await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    // Still in frame: it is not asked or added again until it has left.
    await page.waitForTimeout(3500);
    await expect(count(page)).toHaveText("1");
    expect(await phases(page)).toEqual(["found", "hold", "searching"]);
    await verifyLists(page, ["Cell Block Guard"]);
    await expect(verify(page)).toContainText("Standard Foil");
  });

  test("s7-26-bl262 an early-set Weekly Play pair (SOR 12/20): Resupply's own panel asks Finish; the base-set card is never offered", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 12/20");
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(panel(page).locator(".m-cam__code")).toHaveText("SOR 12/20");
    await expect(name(page)).toHaveText("Resupply");
    await expect(chips(page, "cardKey")).toHaveCount(0);
    await expect(chips(page, "finish")).toHaveText(["Standard", "Standard Foil"]);
    await page.waitForTimeout(1500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await show(page, null);
    await chips(page, "finish")
      .filter({ hasText: /^Standard$/ })
      .click();
    await expect(count(page)).toHaveText("1");
    await expect(name(page)).toHaveText("Resupply");
    await expect(meta(page)).toHaveText("SOR 12 · Weekly Play");
    await verifyLists(page, ["Resupply"]);
    await expect(verify(page)).not.toContainText("Scan Filler 12");
  });

  // Review S1 (orchestrator call under the owner's rule "nothing is added
  // until the user chooses"). Queen Amidala SEC 1127 is three printings under
  // one number -- Carbonite, Gold, Rose Gold. Was: the first of the three was
  // added at once with no question.
  test("s7-26-bl262 Serialized Prestige (SEC 1127), Fast add: one chip per printing, none selected, nothing added until one is chosen; the chips fit", async ({
    page,
  }, testInfo) => {
    await open(page, true);
    await show(page, "SEC • EN 1127"); // stays in frame
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(name(page)).toHaveText("Queen Amidala");
    await expect(chips(page, "finish")).toHaveText(["Carbonite", "Gold", "Rose Gold"]);
    await expect(anyChips(page)).toHaveCount(3);
    await expect(chips(page, "finish").and(page.locator("[aria-pressed='true']"))).toHaveCount(0);
    await expect(meta(page)).toHaveCount(0); // no printing named before the choice
    await expect(addBtn(page)).toHaveAttribute("aria-disabled", "true");
    await expect(panel(page).locator(".m-ident__choicehint")).toHaveText(
      "Carbonite, Gold and Rose Gold share this number. Pick the one you have."
    );
    // The three chips and the line fit the panel: normal text, then wider glyphs.
    const fit = () =>
      page.evaluate(() => {
        const inner = document.querySelector(".m-cam__panelin")!;
        const lim = inner.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(inner).paddingRight);
        const els = [...inner.querySelectorAll(".m-ident__choicehint, .m-chip, .m-ident__name")];
        const over = els
          .map((e) => ({ r: e.getBoundingClientRect(), e: e as HTMLElement }))
          .filter(
            ({ r, e }) => r.right > lim.right - pad + 0.5 || e.scrollWidth > e.clientWidth + 0.5
          );
        const range = document.createRange();
        return {
          over: over.length,
          limit: lim.right - pad,
          chips: [...inner.querySelectorAll<HTMLElement>(".m-chip")].map((e) => {
            range.selectNodeContents(e);
            const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
            return {
              text: e.textContent,
              box: Math.round(e.getBoundingClientRect().width * 10) / 10,
              ink: Math.round(range.getBoundingClientRect().width * 10) / 10,
              right: Math.round(e.getBoundingClientRect().right * 10) / 10,
              lines: lines.size,
              h: e.getBoundingClientRect().height,
            };
          }),
          view: window.innerHeight,
          add: document.querySelector(".m-cam__panel .m-ident__add")!.getBoundingClientRect()
            .bottom,
        };
      });
    for (const label of ["normal text", "wide text"]) {
      if (label === "wide text") await wideText(page);
      const m = await fit();
      testInfo.annotations.push({ type: "fit " + label, description: JSON.stringify(m) });
      expect(m.over, label + ": nothing clipped or past the panel").toBe(0);
      for (const c of m.chips) {
        expect(c.lines, label + ": " + c.text + " on one line").toBe(1);
        expect(c.ink, label + ": " + c.text + " inside its chip").toBeLessThanOrEqual(c.box + 0.5);
        expect(c.h, label + ": " + c.text + " is a 44 px target").toBeGreaterThanOrEqual(43.5);
      }
      expect(m.add, label + ": the buttons stay on screen").toBeLessThanOrEqual(m.view + 0.5);
    }
    // Never resolved on its own; the unavailable Add adds nothing.
    await page.waitForTimeout(2000);
    await addBtn(page).click({ force: true });
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    expect(await phases(page)).toEqual(["found"]);
    // The choice adds exactly that printing and holds.
    await chips(page, "finish")
      .filter({ hasText: /^Gold$/ })
      .click();
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    await expect(count(page)).toHaveText("1");
    await expect(meta(page)).toHaveText("SEC 1127 · Serialized Prestige");
    // The hold shows the printing that went in: the Gold printing's own art.
    await expect(panel(page).locator(".m-ident__frame img")).toHaveAttribute("src", /Carb_C_Gold_/);
    await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    // Still in frame: not asked or added again until it has left.
    await page.waitForTimeout(3000);
    await expect(count(page)).toHaveText("1");
    expect(await phases(page)).toEqual(["found", "hold", "searching"]);
  });

  test("s7-26-bl262 Serialized Prestige (SEC 1127), prompt mode: no printing selected, Add unavailable until one is chosen; the chip alone adds nothing", async ({
    page,
  }) => {
    await open(page, false);
    await show(page, "SEC • EN 1127");
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(name(page)).toHaveText("Queen Amidala");
    await expect(chips(page, "finish")).toHaveText(["Carbonite", "Gold", "Rose Gold"]);
    await expect(chips(page, "finish").and(page.locator("[aria-pressed='true']"))).toHaveCount(0);
    await expect(addBtn(page)).toHaveAttribute("aria-disabled", "true");
    await show(page, null);
    await addBtn(page).click({ force: true });
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await chips(page, "finish").filter({ hasText: "Rose Gold" }).click();
    await expect(chips(page, "finish").and(page.locator("[aria-pressed='true']"))).toHaveText(
      "Rose Gold"
    );
    await expect(panel(page).locator(".m-ident__frame img")).toHaveAttribute(
      "src",
      /Carb_C_Rose_Gold_/
    );
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/); // a chip is not an add
    await expect(addBtn(page)).not.toHaveAttribute("aria-disabled", "true");
    await addBtn(page).click();
    await expect(count(page)).toHaveText("1");
    await expect(page.locator(".m-cam__holdtxt")).toHaveText("next card in 1 s");
    await verifyLists(page, ["Queen Amidala"]);
    await expect(verify(page)).toContainText("Serialized Prestige");
  });

  test("s7-26-bl262 N/2 tournament stamps (SOR 1/2): the pick list, then the picked card's own printings -- never another card on that number", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 1/2");
    await expect(cam(page)).toHaveAttribute("data-phase", "pick");
    await page.waitForTimeout(1500);
    await expect(cam(page)).toHaveAttribute("data-phase", "pick");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await show(page, null);
    await page.locator(".m-cam__pick").filter({ hasText: "Darth Vader" }).click();
    // The row is Darth Vader's two prerelease printings: only they are offered.
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(name(page)).toHaveText("Darth Vader");
    await expect(chips(page, "cardKey")).toHaveCount(0);
    await expect(chips(page, "stamp")).toHaveText(["Promo", "Judge"]);
    await expect(anyChips(page)).toHaveCount(2);
    await page.waitForTimeout(1500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await chips(page, "stamp").filter({ hasText: "Judge" }).click();
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    await expect(count(page)).toHaveText("1");
    await expect(name(page)).toHaveText("Darth Vader");
    await expect(meta(page)).toHaveText("SOR 1 · Prerelease Judge");
    expect(await phases(page)).toEqual(["pick", "found", "hold"]);
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
    await expect(name(page)).toHaveText("Grogu");
    await expect(page.locator(".m-cam__holdtxt")).toHaveText("Fast add · next card in 1 s");
    // The card is still in frame: whatever the camera shows next, it adds
    // nothing more without a tap (a pick is a question, never an add).
    await page.waitForTimeout(4500);
    await expect(count(page)).toHaveText("1");
    expect((await phases(page)).filter((p) => p === "hold")).toHaveLength(1);
  });
});

test.describe("BL-262 prompt mode: the panel opens on the card that was read", () => {
  test("s7-26-bl262 a Resupply strip opens on Resupply, not the base-set card on that number; Add adds Resupply", async ({
    page,
  }) => {
    await open(page, false);
    await show(page, "SOR • EN 12/20");
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(name(page)).toHaveText("Resupply");
    await expect(chips(page, "cardKey")).toHaveCount(0);
    // The strip is both finishes: the non-foil default, the choice left up.
    await expect(chips(page, "finish")).toHaveText(["Standard", "Standard Foil"]);
    await expect(chips(page, "finish").and(page.locator("[aria-pressed='true']"))).toHaveText(
      "Standard"
    );
    await expect(meta(page)).toHaveText("SOR 12 · Weekly Play");
    await page.waitForTimeout(1500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/); // nothing without a tap
    // The other finish is a choice, not an add.
    await chips(page, "finish").filter({ hasText: "Standard Foil" }).click();
    await expect(meta(page)).toHaveText("SOR 12 · Weekly Play Foil");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    await show(page, null);
    await addBtn(page).click();
    await expect(count(page)).toHaveText("1");
    await expect(page.locator(".m-cam__holdtxt")).toHaveText("next card in 1 s");
    await expect(name(page)).toHaveText("Resupply");
    await expect(meta(page)).toHaveText("SOR 12 · Weekly Play Foil");
    await verifyLists(page, ["Resupply"]);
    await expect(verify(page)).not.toContainText("Scan Filler 12");
  });

  // REPLACE (owner decision 2026-10-13 after review: tokens are not added by
  // scanning). Was four reads, the second a token strip ("SOR • EN T1" ->
  // Experience, Add enabled, added): the token's prompt-mode panel is asserted
  // in "a token (SOR T1), prompt mode" above; the other three are unchanged.
  test("s7-26-bl262 a Weekly Play strip, a no-denominator strip and a shared-number strip each open on the card read, with no card question", async ({
    page,
  }) => {
    await open(page, false);
    const reads: [string, string, string][] = [
      ["SOR • EN 3/20", "Waylay", "SOR 3 · Weekly Play"],
      ["SOR • EN 2", "Darth Vader", "SOR 2 · Hyperspace"],
      ["SOR • EN C 74/252", "Scan Filler 74", "SOR 74 · Standard"],
    ];
    for (const [strip, card, printing] of reads) {
      await show(page, strip);
      await expect(cam(page)).toHaveAttribute("data-phase", "found");
      await expect(name(page)).toHaveText(card);
      await expect(meta(page)).toHaveText(printing);
      await expect(anyChips(page)).toHaveCount(0);
      await expect(addBtn(page)).not.toHaveAttribute("aria-disabled", "true");
      await show(page, null);
      await addBtn(page).click();
      await expect(name(page)).toHaveText(card); // the hold shows what was added
      await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    }
    await expect(count(page)).toHaveText("3");
    await verifyLists(page, ["Waylay", "Darth Vader", "Scan Filler 74"]);
  });

  test("s7-26-bl262 prompt mode: Add, the 1 s hold, the card still in view -> the prompt returns; nothing is added without a tap", async ({
    page,
  }) => {
    await open(page, false);
    await show(page, SOR_229); // stays in frame
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    // As before BL-262: the non-foil default is shown and Add adds it.
    await expect(meta(page)).toHaveText("SOR 229 · Standard");
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
    await expect(name(page)).toHaveText("Cell Block Guard");
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

  // Review S3 (orchestrator call under the owner's rule). Was: Wrong card in
  // the Fast add hold took the copy out, and 3 s later the same card, still
  // under the camera, was added again on its own.
  test("s7-26-bl262 Fast add: Wrong card within the hold takes the copy out, and the card left in view is not added again; out and back, it is", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 100/252"); // stays in frame
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    await expect(count(page)).toHaveText("1");
    await panel(page).locator(".m-cam__wrong").click();
    await expect(cam(page)).toHaveAttribute("data-phase", "searching");
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    // Well past the 3 s quiet: still not read again while it stays.
    await page.waitForTimeout(5500);
    await expect(badge(page)).toHaveClass(/m-logbtn--empty/);
    expect(await phases(page)).toEqual(["hold", "searching"]);
    await show(page, null); // out of the frame
    await page.waitForTimeout(1500);
    await show(page, "SOR • EN 100/252"); // back
    await expect(count(page)).toHaveText("1", { timeout: 4000 });
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
  });

  // PORT (owner decision 2026-10-13): was SOR 229, which now asks Finish; a
  // one-printing strip keeps what this asserts (out of the frame and back =
  // added again, with no prompt on the way).
  test("s7-26-bl262 Fast add: a card taken out of the frame and brought back is added again", async ({
    page,
  }) => {
    await open(page, true);
    await show(page, "SOR • EN 100/252");
    await expect(count(page)).toHaveText("1");
    await expect(cam(page)).toHaveAttribute("data-phase", "searching", { timeout: 2500 });
    await show(page, null); // out of the frame
    await page.waitForTimeout(1500);
    await expect(count(page)).toHaveText("1");
    await show(page, "SOR • EN 100/252"); // back
    await expect(count(page)).toHaveText("2", { timeout: 4000 });
    await expect(cam(page)).toHaveAttribute("data-phase", "hold");
    expect((await phases(page)).filter((p) => p === "found" || p === "pick")).toEqual([]);
  });
});
