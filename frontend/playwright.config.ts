import { defineConfig } from "@playwright/test";

// BL-247 S1-10: the mobile e2e harness. Run with `npm run e2e:mobile`
// (e2e/run-mobile.mjs wraps this in the Firebase Auth emulator when none is up).
const PORT = 5174;
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
      dependencies: ["setup"],
      use: phone(390, 844),
    },
    {
      name: "phone-430",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: phone(430, 932),
    },
    {
      name: "desktop-1440",
      testMatch: /.*\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
