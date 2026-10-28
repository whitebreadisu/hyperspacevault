import { defineConfig } from "@playwright/test";

// BL-279 WS-3 W3-06: the verification target. Journeys in e2e/journeys run
// against a real, already-running app (VERIFY_BASE_URL: dev Hosting, or the
// local stack on http://localhost:5174 with E2E_LOCAL=1) and sign in through
// the app's own sign-in UI (e2e/verify/verify.setup.ts). No webServer, no
// mock-api: the target is remote or started by .github/actions/local-stack.
// The device objects are copies of playwright.config.ts's (that config owns a
// webServer, so it is not imported).
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const AUTH_FILE = "e2e/.auth/verify.json";

// W3-08: VERIFY_BROWSER (chromium | firefox | webkit; default chromium) picks
// the engine for every project, setup included (the three-engine nightly,
// W3-15, runs this config once per engine).
const ENGINES = ["chromium", "firefox", "webkit"] as const;
type Engine = (typeof ENGINES)[number];
const browserName = (process.env.VERIFY_BROWSER || "chromium") as Engine;
if (!ENGINES.includes(browserName)) {
  throw new Error(`VERIFY_BROWSER must be one of ${ENGINES.join(", ")}`);
}

// Playwright does not support isMobile on Firefox: there the phone project
// keeps its viewport, touch and iPhone user agent but drops isMobile (no
// mobile meta-viewport emulation), so phone-390 on Firefox is a narrow
// desktop Firefox with touch, not a mobile browser.
const phone = (width: number, height: number) => ({
  browserName,
  viewport: { width, height },
  deviceScaleFactor: 3,
  ...(browserName === "firefox" ? {} : { isMobile: true }),
  hasTouch: true,
  userAgent: IPHONE_UA,
  storageState: AUTH_FILE,
});

export default defineConfig({
  testDir: "e2e/journeys",
  // Retry policy lives in specification_documents/planning/foundation/
  // WS3_Flake_Policy_and_Thinning_2026-10.md: one retry in CI, none locally.
  retries: process.env.CI ? 1 : 0,
  // W3-08: one worker. Every journey acts on the same verification tenant
  // (tenant A), and the two layouts run the same journeys on the same cards:
  // in parallel, desktop's J2 read the phone's +1 (dev, 2026-10-28), and J5's
  // replace-all would clobber whatever ran beside it. Projects run one after
  // the other; the budget is per layout.
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "e2e-results/verify-report.json" }]],
  use: {
    baseURL: process.env.VERIFY_BASE_URL,
    browserName,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testDir: "e2e/verify", testMatch: /verify\.setup\.ts/ },
    {
      name: "phone-390",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: phone(390, 844),
    },
    {
      name: "desktop-1440",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { browserName, viewport: { width: 1440, height: 900 }, storageState: AUTH_FILE },
    },
  ],
});
