import { expect, measureEach, test } from "./helpers";

// S7-02: the isolation headers are scoped to /scan/** -- the document, the
// vendored payload and the worker script carry them; the main document and
// its Permissions-Policy are untouched (a site-wide COEP would break the
// Google sign-in popup, plan A11).
test.afterEach(measureEach);

test("s7-02-scan-headers", async ({ page }) => {
  const scan = await page.goto("/scan/");
  const sh = scan!.headers();
  expect(sh["cross-origin-opener-policy"]).toBe("same-origin");
  expect(sh["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(sh["permissions-policy"]).toBe("camera=(self), microphone=(), geolocation=()");
  expect(sh["cache-control"]).toBe("no-cache");

  // BL-255: this test only reads response headers, but each document it opens
  // is the app, which starts its own API reads once signed in. Leaving a
  // document mid-read aborts them, and the app logs the abort
  // ("Failed to fetch inventory limits") -- a console error the health check
  // counts. Let each document finish its start-up reads before the next goto.
  await page.waitForLoadState("networkidle");
  const main = await page.goto("/");
  const mh = main!.headers();
  expect(mh["cross-origin-opener-policy"]).toBeUndefined();
  expect(mh["cross-origin-embedder-policy"]).toBeUndefined();
  expect(mh["permissions-policy"]).toBeUndefined();
  await page.waitForLoadState("networkidle");
  const hash = await page.goto("/?s7=2#/vault");
  expect(hash!.headers()["cross-origin-embedder-policy"]).toBeUndefined();

  // The payload: immutable + same-origin + COEP (its engines spawn workers).
  const dict = await page.request.get("/vendor/scan/paddle/models/ppocrv6_tiny_dict.txt");
  const dh = dict.headers();
  expect(dh["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(dh["cross-origin-resource-policy"]).toBe("same-origin");
  expect(dh["cross-origin-embedder-policy"]).toBe("require-corp");
  // Ordinary assets carry nothing scanner-shaped.
  const css = await page.request.get("/src/index.css");
  expect(css.headers()["cross-origin-embedder-policy"]).toBeUndefined();
});
