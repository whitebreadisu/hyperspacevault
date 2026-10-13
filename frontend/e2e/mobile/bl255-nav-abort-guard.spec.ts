import { expect, measure, test } from "./helpers";
import { recorderFor } from "./mock-api";

// BL-255 part 5: the harness's own test. The health check (helpers.ts measure)
// must stay silent about an /api/ read that the TEST's navigation aborted
// (NavAbortLedger, mock-api.ts) and must still fail for every real failure.
// No afterEach(measure) here: the cases call measure() themselves and expect
// it to throw or not. Every wait is on an event the route handler controls.

// The desktop project has no session of its own (s6-11 does the same).
test.use({ storageState: "e2e/.auth/phone.json" });

const LIMITS = "**/api/settings/limits";
const MSG = "Failed to fetch inventory limits: TypeError: Failed to fetch";

/** Hold the first limits read until `release()`; later reads pass through. */
async function holdFirstLimitsRead(page: import("@playwright/test").Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let inFlight!: () => void;
  const seen = new Promise<void>((r) => (inFlight = r));
  let n = 0;
  await page.route(LIMITS, async (route) => {
    if (n++ > 0) return route.fallback();
    inFlight();
    await gate;
    await route
      .fulfill({ status: 200, contentType: "application/json", body: "{}" })
      .catch(() => {});
  });
  return { seen, release };
}

test.describe("health check still bites on real failures", () => {
  test("a limits read answered 500 is a console error", async ({ page }) => {
    let hit!: () => void;
    const seen = new Promise<void>((r) => (hit = r));
    await page.route(LIMITS, (route) => {
      hit();
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await page.goto("/#/vault");
    await seen;
    const rec = recorderFor(page);
    await expect.poll(() => rec.consoleErrors.length).toBeGreaterThan(0);
    await expect(measure(page)).rejects.toThrow(/console errors/);
    expect(rec.navAborted).toEqual([]);
  });

  test("a limits read that fails for real (route.abort, no navigation) is reported", async ({
    page,
  }) => {
    let hit!: () => void;
    const seen = new Promise<void>((r) => (hit = r));
    await page.route(LIMITS, (route) => {
      hit();
      return route.abort();
    });
    await page.goto("/#/vault");
    await seen;
    const rec = recorderFor(page);
    await expect.poll(() => rec.consoleErrors.join(" | ")).toContain(MSG);
    await expect(measure(page)).rejects.toThrow(/console errors/);
    expect(rec.failed).toEqual([
      expect.stringMatching(/GET .*\/api\/settings\/limits \(net::ERR_FAILED\)/),
    ]);
    expect(rec.navAborted).toEqual([]);
  });

  test("an ERR_ABORTED read with no navigation is not excused", async ({ page }) => {
    let hit!: () => void;
    const seen = new Promise<void>((r) => (hit = r));
    await page.route(LIMITS, (route) => {
      hit();
      return route.abort("aborted");
    });
    await page.goto("/#/vault");
    await seen;
    const rec = recorderFor(page);
    await expect.poll(() => rec.consoleErrors.join(" | ")).toContain(MSG);
    await expect.poll(() => rec.failed.length).toBeGreaterThan(0);
    await expect(measure(page)).rejects.toThrow(/console errors/);
    expect(rec.failed[0]).toMatch(/\/api\/settings\/limits \(net::ERR_ABORTED\)/);
    expect(rec.navAborted).toEqual([]);
  });

  test("the same text with no aborted read behind it is not excused", async ({ page }) => {
    await page.goto("/#/vault");
    await page.waitForLoadState("networkidle");
    await page.evaluate((m) => console.error(m), MSG);
    const rec = recorderFor(page);
    await expect.poll(() => rec.consoleErrors.length).toBe(1);
    await expect(measure(page)).rejects.toThrow(/console errors/);
  });
});

test.describe("health check ignores a read the test's own navigation aborted", () => {
  test("goto away mid-read stays clean", async ({ page }) => {
    const { seen, release } = await holdFirstLimitsRead(page);
    await page.goto("/#/vault");
    await seen; // the read is in flight, held by the route handler
    await page.goto("/?bl255=1#/vault"); // new document: aborts it
    release();
    const rec = recorderFor(page);
    // The abort, and the app's log of it, both arrive after goto returns.
    await expect.poll(() => rec.navAborted.length).toBe(2);
    await measure(page);
    expect(rec.consoleErrors).toEqual([]);
    expect(rec.failed).toEqual([]);
    expect(rec.navAborted[0]).toMatch(/GET .*\/api\/settings\/limits/);
    expect(rec.navAborted[1]).toBe("console: " + MSG);
  });

  test("one aborted read excuses one message, not two", async ({ page }) => {
    const { seen, release } = await holdFirstLimitsRead(page);
    await page.goto("/#/vault");
    await seen;
    await page.goto("/?bl255=2#/vault");
    release();
    const rec = recorderFor(page);
    await expect.poll(() => rec.navAborted.length).toBe(2);
    await page.waitForLoadState("networkidle");
    await page.evaluate((m) => console.error(m), MSG); // a second, unexplained one
    await expect.poll(() => rec.consoleErrors.length).toBe(1);
    await expect(measure(page)).rejects.toThrow(/console errors/);
  });
});
