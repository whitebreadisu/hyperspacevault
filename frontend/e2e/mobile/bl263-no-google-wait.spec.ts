import { expect, measureEach, test } from "./helpers";

// BL-263 (2.0.1): on a phone user agent (and any Safari) the Firebase Auth SDK
// used to load its popup/redirect helper -- https://apis.google.com/js/api.js
// and its gapi module -- BEFORE restoring the stored session, because
// src/firebase.ts used getAuth(). A slow or hanging Google host held the whole
// app on "Loading..." (measured: loader held 8 s -> phone shell at 9.95 s). Auth
// now starts without the resolver, so a page load must not ask Google for
// anything. Here every apis.google.com request is held for 10 s (then handed to
// the suite's own stub): the signed-in shell must still paint promptly, and no
// such request may be made at all.
const HOLD_MS = 10_000;

test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone user agent");
});

test("bl263-signed-in-shell-does-not-wait-on-google", async ({ page }) => {
  const google: string[] = [];
  // Registered after the suite's stub, so it is asked first.
  await page.route("https://apis.google.com/**", async (route) => {
    google.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.fallback();
  });

  const t0 = Date.now();
  await page.goto("/#/vault");
  await expect(page.locator(".m-acct__hit")).toBeVisible({ timeout: HOLD_MS - 2_000 });
  const elapsed = Date.now() - t0;

  expect(google, "requests to apis.google.com during a page load").toEqual([]);
  // Well under the hold: the pre-fix app could not paint before the hold ended.
  expect(elapsed, "signed-in shell paint, ms").toBeLessThan(HOLD_MS - 3_000);
});
