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

const phone = (width: number, height: number) => ({
  viewport: { width, height },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
  storageState: AUTH_FILE,
});

export default defineConfig({
  testDir: "e2e/journeys",
  // Retry policy lives in specification_documents/planning/foundation/
  // WS3_Flake_Policy_and_Thinning_2026-10.md: one retry in CI, none locally.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["json", { outputFile: "e2e-results/verify-report.json" }]],
  use: {
    baseURL: process.env.VERIFY_BASE_URL,
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
      use: { viewport: { width: 1440, height: 900 }, storageState: AUTH_FILE },
    },
  ],
});
