import { defineConfig } from "@playwright/test";

// v2.3 public card pages (design note §8 "Journeys"): the card-page journeys
// in e2e/cards, run against GENERATED pages, signed out (a visitor arriving
// from search). Two ways to point it:
//   - default: `vite preview` serves the dist that `npm run build` plus
//     `npm run public-pages -- --catalog scripts/public-pages/fixtures/catalog.json`
//     produced (the CI frontend job does exactly that, then runs this config);
//   - CARDS_BASE_URL=https://swu-dev-jbapps.web.app runs the same journeys
//     against a deployed environment (no webServer). The fixture's prices
//     and image stems are asserted, so that mode needs the fixture-aware
//     assertions relaxed; it is here for a manual look, not wired into CI.
// The device objects are copies of playwright.config.ts's desktop-1440 and
// phone-390 (that config owns the auth setup and a dev-server webServer, so it
// is not imported), without the signed-in storage state.
const PORT = Number(process.env.CARDS_PORT ?? 5175);
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const remote = process.env.CARDS_BASE_URL;

export default defineConfig({
  testDir: "e2e/cards",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: remote ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: remote
    ? undefined
    : {
        command: `npx vite preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/cards/sor/005/`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: "phone-390",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_UA,
      },
    },
    {
      name: "desktop-1440",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
