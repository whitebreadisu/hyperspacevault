import { expect, measureEach, test } from "./helpers";

// S7-03: the isolation proof. /scan/ is cross-origin isolated (threaded WASM
// needs SharedArrayBuffer); / is not (the Google popup must keep working).
// The report values are logged for the build log / the LAN rounds.
test.afterEach(measureEach);

test("s7-03-cross-origin-isolated", async ({ page }) => {
  await page.goto("/scan/");
  await expect(page.locator(".m-app")).toBeVisible();
  const scan = await page.evaluate(() => ({
    crossOriginIsolated: window.crossOriginIsolated,
    report: (window as unknown as { __scan: { isolation: unknown } }).__scan.isolation,
    sab: typeof SharedArrayBuffer,
  }));
  console.log("[s7-03] /scan/ " + JSON.stringify(scan));
  expect(scan.crossOriginIsolated).toBe(true);
  expect(scan.sab).toBe("function");
  const r = scan.report as {
    crossOriginIsolated: boolean;
    sharedArrayBuffer: boolean;
    hardwareConcurrency: number;
    threads: number;
    simd: boolean;
  };
  expect(r.crossOriginIsolated).toBe(true);
  expect(r.sharedArrayBuffer).toBe(true);
  expect(r.threads).toBe(Math.max(1, Math.min(4, r.hardwareConcurrency)));
  expect(typeof r.simd).toBe("boolean");

  await page.goto("/");
  await expect(page.locator(".m-app")).toBeVisible();
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
});
