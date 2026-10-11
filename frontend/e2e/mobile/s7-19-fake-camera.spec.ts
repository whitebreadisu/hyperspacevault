import { expect, measureEach, test as projectTest } from "./helpers";
import { test as clipTest } from "./clip-helpers";

// S7-19: the `scan` Playwright project runs Chromium with the fake camera --
// no stub, the real getUserMedia. (1) the project-level fake device (Chromium's
// generated test pattern) streams into the camera screen's <video>; (2) a
// per-clip browser (--use-file-for-fake-video-capture, clip-helpers.ts) does
// the same with the spike's MJPEG clip, at its native 1080 x 1920.
projectTest.afterEach(measureEach);
clipTest.afterEach(measureEach);

projectTest("s7-19-fake-camera-streams", async ({ page }) => {
  await page.goto("/scan/#/camera");
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live", { timeout: 20000 });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLVideoElement>(".m-cam__video")!.videoWidth)
    )
    .toBeGreaterThan(0);
});

clipTest("s7-19-fake-camera-streams (clip)", async ({ page }) => {
  await page.goto("/scan/#/camera");
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "live", { timeout: 20000 });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLVideoElement>(".m-cam__video")!.videoWidth)
    )
    .toBeGreaterThan(0);
  const dims = await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>(".m-cam__video")!;
    return { w: v.videoWidth, h: v.videoHeight };
  });
  expect(dims).toEqual({ w: 1080, h: 1920 });
});
