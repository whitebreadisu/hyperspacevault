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
const LIMITS_ENTRY = /^GET .*\/api\/settings\/limits$/;
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
    // The abort, and the app's log of it, both arrive after goto returns. The
    // desktop tree starts more reads than the phone tree (sets, shared limits),
    // and every one the navigation aborts is rightly excused: so assert on the
    // read under test and its message, never on how many entries there are.
    await expect.poll(() => rec.navAborted.some((e) => LIMITS_ENTRY.test(e))).toBe(true);
    await expect.poll(() => rec.navAborted.includes("console: " + MSG)).toBe(true);
    await page.waitForLoadState("networkidle"); // other aborted reads have settled
    await measure(page);
    expect(rec.consoleErrors).toEqual([]);
    expect(rec.failed).toEqual([]);
  });

  test("one aborted read excuses one message, not two", async ({ page }) => {
    const { seen, release } = await holdFirstLimitsRead(page);
    await page.goto("/#/vault");
    await seen;
    await page.goto("/?bl255=2#/vault");
    release();
    const rec = recorderFor(page);
    const limitsAborts = () => rec.navAborted.filter((e) => LIMITS_ENTRY.test(e)).length;
    const limitsLogs = () => rec.navAborted.filter((e) => e === "console: " + MSG).length;
    // The held read was aborted and its own message excused. Each aborted
    // request excuses at most one message, and the app logs each one.
    await expect.poll(limitsAborts).toBeGreaterThan(0);
    await expect.poll(() => limitsLogs() - limitsAborts()).toBe(0);
    expect(limitsLogs()).toBeLessThanOrEqual(limitsAborts());
    await page.waitForLoadState("networkidle");
    await page.evaluate((m) => console.error(m), MSG); // one more, unexplained
    await expect.poll(() => rec.consoleErrors).toEqual([MSG]);
    expect(limitsLogs()).toBeLessThanOrEqual(limitsAborts());
    await expect(measure(page)).rejects.toThrow(/console errors/);
  });
});
