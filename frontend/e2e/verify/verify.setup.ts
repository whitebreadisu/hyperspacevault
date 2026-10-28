import { mkdirSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";

// BL-279 WS-3 W3-06: sign the verification user in through the app's own
// sign-in UI (phone account slot -> the shared AuthModal, as
// e2e/mobile/auth.setup.ts does) and save the signed-in storage state
// (localStorage + IndexedDB, where the Firebase SDK keeps its session) for the
// phone-390 and desktop-1440 projects. The user already exists: W3-05's
// verify_tenant.py creates it on dev/prod and seed.mjs creates it on the
// emulator. Under E2E_LOCAL=1 nothing changes here; the app itself is pointed
// at the emulator by its Vite env (VITE_USE_AUTH_EMULATOR).
const AUTH_FILE = "e2e/.auth/verify.json";

setup("verify-setup sign in as the verification user", async ({ page }) => {
  const email = process.env.VERIFY_EMAIL;
  const password = process.env.VERIFY_PASSWORD;
  if (!email || !password) throw new Error("VERIFY_EMAIL and VERIFY_PASSWORD are required");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .locator(".m-acct")
    .getByRole("button", { name: /^sign in$/i })
    .click();
  const dialog = page.getByRole("dialog", { name: "Log In" });
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page.locator(".m-acct__hit")).toBeVisible({ timeout: 20000 });
  await expect(dialog).toBeHidden();

  mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: AUTH_FILE, indexedDB: true });
});
