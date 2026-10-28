import { expect } from "@playwright/test";
import { clipPath } from "../mobile/clip-helpers";
import {
  clipContext,
  decrement,
  isPhone,
  journeyTest,
  openCard,
  openVault,
  runRestore,
  readQuantity,
  settled,
} from "./_helpers";

// BL-279 WS-3 W3-09, journey J6: on a phone, the camera screen reads a card
// from the fake-camera clip fake_v2_std (the BL-238 spike's clip of SOR 229
// Cell Block Guard; the real getUserMedia, Paddle worker and scan core run),
// the user adds it, commits the batch from the Verify sheet, and the card is
// in the real vault. The journey then steps the copy back out (SOR 229 is not
// in the seed), so tenant A is left as found. Phone and Chromium only: the
// --use-file-for-fake-video-capture flags are Chromium launch flags and the
// desktop layout has no camera screen. The flags are browser-side, so this
// runs against dev. The clip browser comes from the playwright fixture's
// launcher, so the config's trace setting covers it.
// The journey goes straight to /scan/#/camera; the vault -> tool bar -> camera
// path is covered by the s7 item specs (recorded deviation from the catalogue).
const J6_CARD = { set: "SOR", number: 229, name: "Cell Block Guard" };

journeyTest.describe.configure({ mode: "serial" });

journeyTest(
  "j6 @no-engines @chromium-only a scanned card lands in the real vault",
  async ({ playwright, browserName }, info) => {
    journeyTest.skip(browserName !== "chromium", "the fake camera is Chromium-only");
    journeyTest.skip(!isPhone(info), "the camera screen is the phone app's");

    const { browser, context } = await clipContext(
      playwright.chromium,
      info,
      clipPath("fake_v2_std")
    );
    const page = await context.newPage();
    let failure: unknown;
    let committed = false;
    let restored = false;
    try {
      await page.goto("/scan/#/camera");
      const cam = page.locator(".m-cam");
      await expect(cam).toHaveAttribute("data-stream", "live", { timeout: 20_000 });

      // The clip's card is read and offered; nothing counts until Add.
      await expect(cam).toHaveAttribute("data-phase", "found", { timeout: 20_000 });
      const panel = page.locator(".m-cam__panel");
      await expect(panel.locator(".m-ident__name")).toHaveText("Cell Block Guard");
      await expect(panel.locator(".m-cam__code")).toHaveText("SOR 229/252");
      const badge = page.locator(".m-cam__bar .m-logbtn");
      await expect(badge).toHaveClass(/m-logbtn--empty/);
      await panel.locator(".m-ident__add .swu-btn").click();
      await expect(badge.locator(".m-logbtn__n")).toHaveText("1");

      // Commit the batch from the Verify sheet.
      await badge.click();
      const sheet = page.locator(".m-sheet-layer--verify");
      await expect(sheet).toBeVisible();
      await sheet.locator(".m-d2-verify__commit").click();
      await expect(sheet.locator(".m-d2-verify__success")).toHaveText("1 card added.", {
        timeout: 20_000,
      });
      await expect(page.locator(".m-sheet-layer")).toHaveCount(0, { timeout: 10_000 });
      committed = true;

      // The vault holds the copy.
      await page.goto("/#/vault");
      await openVault(page, info);
      await openCard(page, info, J6_CARD);
      await expect(readQuantity(page, info)).toHaveText("1");

      // Terminal step: put the tenant back.
      await decrement(page, info, J6_CARD);
      await expect(readQuantity(page, info)).toHaveText("0");
      await settled(page, info);
      restored = true;
    } catch (err) {
      failure = err;
      throw err;
    } finally {
      // A run that failed after the commit must not leave the copy behind for
      // the journeys that follow: put SOR 229 back to 0. Nothing to undo
      // before the commit or after the terminal step succeeded.
      if (committed && !restored) {
        await runRestore(failure, async () => {
          await page.goto("/#/vault");
          await openVault(page, info);
          await openCard(page, info, J6_CARD);
          for (let n = 0; n < 3 && (await readQuantity(page, info).innerText()) !== "0"; n++) {
            await decrement(page, info, J6_CARD);
            await settled(page, info);
          }
        });
      }
      await browser.close();
    }
  }
);
