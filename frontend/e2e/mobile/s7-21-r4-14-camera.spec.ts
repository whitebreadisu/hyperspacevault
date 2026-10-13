import type { Page } from "@playwright/test";
import { expect, measureEach } from "./helpers";
import { test } from "./clip-helpers";

// S7-21: the rev4 camera check steps ported onto the real camera + the
// fake_v2_std clip (Cell Block Guard, SOR 229/252), the real Paddle worker:
//   r4-14-verify-guard-camera  -> s7-21-verify-guard-camera
//     (`#/camera?fast=1` is replaced by Fast add on, seeded in hsv.scan.v1;
//      one read = one batch copy; the camera X opens the close guard with the
//      camera still open; Return to Batch keeps both; Discard & Close empties
//      the batch and closes -- rev4 BUILD_LOG F-5)
//   r4-14-verify-camera-hold   -> s7-21-verify-camera-hold
//     (the hold shows "In batch n", Add hidden, Verify · 1; Wrong card in the
//      hold takes the row back out)
//   camera-add-log (ported to verify=1 at rev4, R4-14) -> s7-21-camera-add-log
//     (Add on the prompt -> Verify · 1, and the Verify sheet lists the row)
test.afterEach(measureEach);
test.use({ clip: "fake_v2_std" });

const cam = (p: Page) => p.locator(".m-cam");
const n = (p: Page) => p.locator(".m-cam__bar .m-logbtn__n");
const confirm = (p: Page) => p.locator('.m-d2-confirm-layer[role="alertdialog"]');

async function fastAddOn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "hsv.scan.v1",
      JSON.stringify({ v: 1, boxOffsetMm: 0, boxOffsetVMm: 0, fastAdd: true, mode: "camera" })
    );
  });
}

async function openCamera(page: Page) {
  await page.goto("/scan/#/camera");
  await expect(cam(page)).toHaveAttribute("data-stream", "live", { timeout: 20000 });
}

test("s7-21-verify-guard-camera", async ({ page }) => {
  await fastAddOn(page);
  await openCamera(page);
  await expect(page.locator(".m-tool__fast")).toHaveAttribute("aria-checked", "true");
  // A camera read leaves one copy in the batch (verify on).
  await expect(n(page)).toHaveText("1", { timeout: 20000 });
  // The camera's X with a batch pending: desktop's close guard; camera stays.
  const x = page.locator(".m-tool__head [aria-label='Close camera']");
  await x.click();
  const c = confirm(page);
  await expect(c).toBeVisible();
  await expect(c.locator(".m-d2-confirm__title")).toHaveText("Discard this batch?");
  await expect(c.locator(".swu-btn")).toHaveText(["Discard & Close", "Return to Batch"]);
  await expect(page.locator(".m-tool--camera")).toHaveCount(1);
  await expect(cam(page)).toHaveAttribute("data-stream", "live");
  // Return to Batch keeps the camera and the batch.
  await c.locator(".swu-btn", { hasText: "Return to Batch" }).click();
  await expect(confirm(page)).toHaveCount(0);
  await expect(page.locator(".m-tool--camera")).toHaveCount(1);
  await expect(n(page)).toHaveText("1");
  await expect(cam(page)).toHaveAttribute("data-stream", "live");
  // Discard & Close empties the batch and closes the camera.
  await x.click();
  await confirm(page).locator(".swu-btn", { hasText: "Discard & Close" }).click();
  await expect(page.locator(".m-tool")).toHaveCount(0);
  await expect(page).toHaveURL(/\/scan\/#\/vault/);
  const rows = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("hsv.tool.v1") ?? "{}").rows?.length ?? 0
  );
  expect(rows).toBe(0);
});

test("s7-21-verify-camera-hold", async ({ page }) => {
  await fastAddOn(page);
  await openCamera(page);
  await expect(cam(page)).toHaveAttribute("data-phase", "hold", { timeout: 20000 });
  await expect(n(page)).toHaveText("1");
  // PORT (owner decision 2026-10-12, BL-262): the hold is 1 s (was 1.5 s).
  await expect(page.locator(".m-cam__holdtxt")).toHaveText("Fast add · next card in 1 s");
  await expect(page.locator(".m-ident__added")).toContainText("In batch 1");
  await expect(page.locator(".m-ident__added")).not.toContainText("Added");
  await expect(page.locator(".m-cam__panel .m-ident__add .swu-btn")).toHaveCount(0);
  await expect(page.locator(".m-cam__bar .m-logbtn")).toContainText("Verify");
  // (rev4 also read "In batch 1" in .m-readout; as built the keypad's panel
  // shows it once, in .m-ident__added, asserted above, and drops the readout.)
  await expect(page.locator(".m-cam__panel .m-readout")).toHaveCount(0);
  // Wrong card in the hold takes the batch row back out.
  await page.locator(".m-cam__wrong").click();
  await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);
  await expect(cam(page)).toHaveAttribute("data-phase", "searching");
});

test("s7-21-camera-add-log", async ({ page }) => {
  await openCamera(page);
  await expect(cam(page)).toHaveAttribute("data-phase", "found", { timeout: 20000 });
  await page.locator(".m-cam__panel .m-ident__add .swu-btn").click();
  await expect(n(page)).toHaveText("1");
  await expect(page.locator(".m-cam__bar .m-logbtn")).toContainText("Verify");
  await page.locator(".m-cam__bar .m-logbtn").click();
  await expect(page.locator(".m-sheet-layer--verify")).toBeVisible();
  await expect(page.locator(".m-sheet-layer--verify")).toContainText("Cell Block Guard");
});
