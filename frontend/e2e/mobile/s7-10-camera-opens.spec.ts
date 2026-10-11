import { expect, measureEach, test } from "./helpers";
import { installFakeScanner, openScanCamera } from "./scan-helpers";

// S7-10: the camera screen (rev4 MCamera.jsx) in the scanner document: the
// tool header (title "Camera", Fast add, the mode toggle, X top-right), a real
// <video> preview (object-fit cover) carrying the stream, the guide, the
// meter, the bottom bar's Verify button; no prototype "tap to read" chip, no
// demo strip, no orientation toggle. Permission denied -> an inline message
// with "Use the keypad" (no alert). Stage 7b drives it with a canvas stream
// (the fake-camera clips are stage 7c's).
test.afterEach(measureEach);

test("s7-10-camera-opens", async ({ page }) => {
  await installFakeScanner(page, { mode: "sharp" });
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  await openScanCamera(page);
  const m = await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>(".m-cam__video")!;
    const x = document
      .querySelector(".m-tool__head [aria-label='Close camera']")!
      .getBoundingClientRect();
    return {
      title: document.querySelector(".m-padlayer__title")!.textContent,
      fit: getComputedStyle(v).objectFit,
      playsInline: v.playsInline,
      muted: v.muted,
      hasStream: !!v.srcObject,
      xRight: x.right,
      xMin: Math.min(x.width, x.height),
      iw: innerWidth,
      fast: !!document.querySelector(".m-tool__fast[role='switch']"),
      mode: document
        .querySelector(".m-tool__mode [aria-label='Camera mode']")
        ?.getAttribute("aria-pressed"),
      guide:
        !!document.querySelector(".m-guide__card") && !!document.querySelector(".m-guide__box"),
      meter: !!document.querySelector(".m-meter"),
      verify: !!document.querySelector(".m-cam__bar .m-logbtn--verify"),
      proto: !!document.querySelector(".m-cam__proto"),
      orient: !!document.querySelector(".m-cam__orient"),
    };
  });
  expect(m.title).toBe("Camera");
  expect(m.fit).toBe("cover");
  expect(m.playsInline && m.muted && m.hasStream).toBe(true);
  expect(m.xRight).toBeGreaterThan(m.iw - 20);
  expect(m.xMin).toBeGreaterThanOrEqual(44);
  expect(m.fast).toBe(true);
  expect(m.mode).toBe("true");
  expect(m.guide && m.meter && m.verify).toBe(true);
  expect(m.proto || m.orient).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__reads ?? 0)).toBeGreaterThan(0);

  // Permission denied: inline message + Use the keypad, never an alert.
  await page.addInitScript(() => {
    window.__fakeCam = { mode: "deny" };
  });
  await page.reload();
  await expect(page.locator(".m-cam")).toHaveAttribute("data-stream", "denied");
  await expect(page.locator(".m-cam__msg")).toContainText("Camera access is off");
  await page.locator(".m-cam__msg .m-textbtn", { hasText: "Use the keypad" }).click();
  await expect(page).toHaveURL(/\/scan\/#\/pad$/);
  await expect(page.locator(".m-tool .m-pad")).toBeVisible();
  expect(dialogs).toBe(0);
});
