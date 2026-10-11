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
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
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
      testIgnore: /s7-.*\.spec\.ts/,
      dependencies: ["setup"],
      use: phone(390, 844),
    },
    {
      name: "phone-430",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /s7-.*\.spec\.ts/,
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
      testIgnore: /s7-.*\.spec\.ts/,
      // BL-252 S6-11: the desktop smoke signs in with the saved session.
      dependencies: ["setup"],
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
