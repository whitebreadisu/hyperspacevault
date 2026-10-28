import { defineConfig } from "@playwright/test";

// BL-247 S1-10: the mobile e2e harness. Run with `npm run e2e:mobile`
// (e2e/run-mobile.mjs wraps this in the Firebase Auth emulator when none is up).
const PORT = Number(process.env.E2E_PORT ?? 5174);
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const AUTH_FILE = "e2e/.auth/phone.json";

const phone = (width: number, height: number) => ({
  viewport: { width, height },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
  storageState: AUTH_FILE,
});

export default defineConfig({
  testDir: "e2e",
  // BL-255 / #214: one retry in CI only. A test that fails and then passes is
  // reported as flaky (e2e/report-flaky.mjs reads the JSON report) rather than
  // blocking; a test that fails twice still fails the leg. Local runs: none.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "e2e-results/report.json" }]]
    : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      VITE_USE_AUTH_EMULATOR: "true",
      // Same fallbacks as src/firebase.ts (demo-swu emulator project).
      VITE_FIREBASE_API_KEY: "demo-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-swu.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-swu",
    },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "phone-390",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /s7-.*\.spec\.ts|[/](journeys|verify)[/]/, // journeys/verify run under playwright.verify.config.ts (WS-3)
      dependencies: ["setup"],
      use: phone(390, 844),
    },
    {
      name: "phone-430",
      // WS-3 W3-10 (b2, Option B): 390 is the narrower, stricter width, so fit,
      // no-overflow, right-edge-pinned and 44 px target checks run at 390 only.
      // 430 keeps the specs whose assertions need the wider width: wrap, centring
      // on the viewport, ellipsis, landscape, and explicit 430-only tests.
      // phone-390 runs every spec. Per-spec dispositions:
      // planning/foundation/WS3_Test_Dispositions_2026-10.md.
      testMatch: [
        /s1-04-shell\.spec\.ts$/, // bottom-bar centre button centred on innerWidth (cx vs iw / 2)
        /s1-09-auth\.spec\.ts$/, // auth card is min(iw - 32, 420) wide and centred in the viewport
        /s1-14-status\.spec\.ts$/, // explicit 430-only test s1-14-two-rows-fit-430 (skips unless phone-430)
        /s1-20-gallery\.spec\.ts$/, // single-column gallery cell centred in the viewport (lefts[0] vs (iw - want) / 2)
        /s2-12-sheet\.spec\.ts$/, // filter sheet Set-row chips wrap onto more than one line
        /s6-shared\.spec\.ts$/, // long-name ellipsis (textOverflow) and the vault switch centred on innerWidth
        /fr5-06-landscape\.spec\.ts$/, // landscape turns and narrow/short windows
      ],
      testIgnore: /s7-.*\.spec\.ts|[/](journeys|verify)[/]/, // journeys/verify run under playwright.verify.config.ts (WS-3)
      dependencies: ["setup"],
      use: phone(430, 932),
    },
    // BL-253 S7: the scanner specs run in their own project.
    {
      name: "scan",
      testMatch: /s7-.*\.spec\.ts/,
      dependencies: ["setup"],
      // BL-253 S7-19: Chromium's fake camera (a generated test pattern unless
      // a spec asks for a clip: e2e/mobile/clip-helpers.ts launches its own
      // browser per clip with --use-file-for-fake-video-capture). WebKit has
      // no fake camera, so this project is Chromium only.
      use: {
        ...phone(390, 844),
        browserName: "chromium",
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
        permissions: ["camera"],
      },
    },
    {
      name: "desktop-1440",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /s7-.*\.spec\.ts|[/](journeys|verify)[/]/, // journeys/verify run under playwright.verify.config.ts (WS-3)
      // BL-252 S6-11: the desktop smoke signs in with the saved session.
      dependencies: ["setup"],
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
