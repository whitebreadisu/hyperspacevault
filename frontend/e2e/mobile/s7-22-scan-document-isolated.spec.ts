import { expect, measureEach, test } from "./helpers";

// S7-22: the scoped isolation, verified end to end. /scan/ is cross-origin
// isolated and answers COOP same-origin + COEP require-corp + a camera-only
// Permissions-Policy; / and /#/vault answer none of them, and a popup opened
// from the main document keeps window.opener -- the Google sign-in popup
// path a site-wide COEP / COOP would break (plan A11). The static
// firebase.json half is vitest S7-22 (scanHeadersStatic.test.ts).
test.afterEach(measureEach);

test("s7-22-scan-document-isolated", async ({ page }) => {
  const scan = await page.goto("/scan/");
  const sh = scan!.headers();
  expect(sh["cross-origin-opener-policy"]).toBe("same-origin");
  expect(sh["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(sh["permissions-policy"]).toContain("camera=(self)");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);

  for (const url of ["/", "/?s7=22#/vault"]) {
    const res = await page.goto(url);
    const h = res!.headers();
    expect(h["cross-origin-opener-policy"], url).toBeUndefined();
    expect(h["cross-origin-embedder-policy"], url).toBeUndefined();
    expect(await page.evaluate(() => window.crossOriginIsolated), url).toBe(false);
    // The popup path: window.open returns a window and it keeps its opener.
    const popupPromise = page.waitForEvent("popup");
    const opened = await page.evaluate(() => {
      const w = window.open("about:blank");
      return { opened: w !== null, opener: w !== null && w.opener === window };
    });
    expect(opened, url).toEqual({ opened: true, opener: true });
    const popup = await popupPromise;
    await popup.close();
  }
});
