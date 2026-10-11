import { mkdirSync } from "node:fs";
import { expect, test as setup } from "./helpers";

// BL-247 S1-10 (f): create the e2e user on the Auth emulator (port 9099), sign
// in through the app's own AuthModal, and save the signed-in storage state
// (localStorage + IndexedDB, where the Firebase SDK keeps its session) for the
// phone projects. The sign-in screen is the same AuthModal on both layouts.
const EMAIL = "e2e@hsv.test";
const PASSWORD = "e2e-password-1";
const AUTH_FILE = "e2e/.auth/phone.json";

setup("s1-00-auth-setup sign in against the auth emulator", async ({ page, request }) => {
  const res = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake",
    { data: { email: EMAIL, password: PASSWORD, returnSecureToken: true } }
  );
  if (!res.ok()) expect(await res.text()).toContain("EMAIL_EXISTS");

  // Stage 1a-s: sign in through the phone's own account slot (S1-08 Sign in
  // control -> S1-09 auth layer = the desktop AuthModal), then wait for the
  // avatar bubble.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const signIn = page.locator(".m-acct").getByRole("button", { name: /^sign in$/i });
  await signIn.click();
  const dialog = page.getByRole("dialog", { name: "Log In" });
  await dialog.getByLabel("Email").fill(EMAIL);
  await dialog.getByLabel("Password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page.locator(".m-acct__hit")).toBeVisible({ timeout: 15000 });
  await expect(dialog).toBeHidden();

  mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: AUTH_FILE, indexedDB: true });
});
