import type { Page } from "@playwright/test";
import { expect, measureEach, test } from "./helpers";

// S7-04: the 32 MB reader payload is lazy. Nothing under /vendor/scan/ is
// requested on the main document (Vault, keypad), nor on the scanner document
// until the camera route shows; then the Paddle group only; the Tesseract
// group only when the first fallback need forces it.
test.afterEach(measureEach);

function watch(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/vendor/scan/")) urls.push(p);
  });
  return urls;
}

test("s7-04-lazy-payload", async ({ page }) => {
  test.setTimeout(120_000);
  const seen = watch(page);

  // The main document: Vault, then the keypad over it.
  await page.goto("/");
  await expect(page.locator(".m-vault")).toBeVisible();
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page.locator(".m-tool")).toBeVisible();
  await page.waitForTimeout(800);
  expect(seen, "main document requests nothing").toEqual([]);

  // The scanner document, not on the camera route: still nothing.
  await page.goto("/scan/");
  await expect(page.locator(".m-app")).toBeVisible();
  await page.waitForTimeout(800);
  expect(seen, "scan document off the camera route").toEqual([]);

  // The camera route: the Paddle group, and only the Paddle group.
  await page.goto("/scan/#/camera");
  await page.waitForFunction(
    () =>
      (window as unknown as { __scan: { reader: { state: string } } }).__scan.reader.state ===
      "ready",
    null,
    { timeout: 90_000 }
  );
  const paddle = seen.filter((p) => p.startsWith("/vendor/scan/paddle/"));
  const names = paddle.map((p) => p.split("/").pop());
  for (const f of [
    "paddle-bundle.min.js",
    "PP-OCRv6_tiny_det.ort",
    "PP-OCRv6_tiny_rec.ort",
    "ppocrv6_tiny_dict.txt",
    "ort-wasm-simd-threaded.wasm",
  ])
    expect(names, f).toContain(f);
  expect(seen.filter((p) => !p.startsWith("/vendor/scan/paddle/"))).toEqual([]);

  // Tesseract only when forced.
  const ensured = await page.evaluate(() =>
    (
      window as unknown as { __scan: { fallback: { ensure(): Promise<{ ok: boolean }> } } }
    ).__scan.fallback.ensure()
  );
  expect(ensured.ok).toBe(true);
  const tess = seen.filter((p) => !p.startsWith("/vendor/scan/paddle/")).map((p) => p.slice(13));
  console.log("[s7-04] tesseract group requested: " + tess.join(", "));
  expect(tess).toContain("tesseract.min.js");
  expect(tess).toContain("worker.min.js");
  expect(tess).toContain("lang/eng.traineddata.gz");
  expect(tess.some((p) => p.startsWith("core/tesseract-core"))).toBe(true);
});
