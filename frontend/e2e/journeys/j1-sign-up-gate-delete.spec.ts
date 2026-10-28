import { randomBytes } from "node:crypto";
import { expect } from "@playwright/test";
import {
  closeCard,
  increment,
  isPhone,
  journeyTest,
  openCard,
  openSettings,
  openVault,
  ownedTotal,
  readQuantity,
  signInControl,
  VERIFY_BANNER,
  VERIFY_PROMPT,
} from "./_helpers";

// BL-279 WS-3 W3-08, journey J1: a new visitor creates an account, sees that
// adding cards waits on email verification, and deletes the account. Starts
// anonymous (no storage state). Each run creates a real user on the target:
// jeremy.braden+hsv-j1-<runid>-<layout>@gmail.com with a generated password
// that is never logged. The journey deletes the user itself; a run that fails
// before the delete leaves it behind for the seed's purge
// (verify_tenant.py --purge-j1 removes J1 users older than one hour, dev only).
// Never run against prod (the placement matrix keeps J1 off prod).
// Delete Account re-authenticates with the current password, so a slow run
// does not trip Firebase's recent-login rule; if it ever does, the test fails
// honestly (no re-login is added).
// Traces off for this file: Playwright records typed field values, and a failed
// run is exactly the case where the generated password may still open a live
// dev user (review WS3_3c1 #1).
journeyTest.use({ storageState: { cookies: [], origins: [] }, trace: "off" });

const J2_CARD = { set: "SOR", number: 200, name: "Spark of Rebellion" };

journeyTest.describe.configure({ mode: "serial" });

journeyTest(
  "j1 @no-engines a new account sees the verify banner, cannot add a card, and can delete itself",
  async ({ page }, info) => {
    const runId = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    const email = `jeremy.braden+hsv-j1-${runId}-${info.project.name}@gmail.com`;
    const password = `J1-${randomBytes(18).toString("base64url")}`;

    // Sign up from the signed-out vault.
    await openVault(page, info);
    await signInControl(page, info).click();
    await page.getByRole("dialog", { name: "Log In" }).locator(".auth-switch").click();
    const signUp = page.getByRole("dialog", { name: "Sign Up" });
    await signUp.getByLabel("Email").fill(email);
    await signUp.getByLabel("Password").fill(password);
    await signUp.getByRole("button", { name: "Sign Up", exact: true }).click();
    const sent = page.getByRole("dialog", { name: "Verify Your Email" });
    await expect(sent).toBeVisible({ timeout: 20_000 });
    await sent.getByRole("button", { name: "Continue" }).click();
    await expect(sent).toHaveCount(0);

    // Signed in, unverified: the banner shows.
    const banner = page.locator(".verify-email-banner");
    await expect(banner.locator(".verify-email-banner__text")).toHaveText(VERIFY_BANNER, {
      timeout: 20_000,
    });

    // The gate: an increment is refused and the prompt says why; the readout
    // returns to 0.
    await openCard(page, info, J2_CARD);
    await expect(readQuantity(page, info)).toHaveText("0");
    await increment(page, info, J2_CARD);
    await expect(page.getByText(VERIFY_PROMPT, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(readQuantity(page, info)).toHaveText("0");
    await closeCard(page, info);

    // Settings -> Delete Account, two steps.
    await openSettings(page, info);
    const danger = page.locator(".settings-section--danger");
    await danger.getByRole("button", { name: "Delete Account" }).click();
    const del = page.getByRole("dialog", { name: "Delete Account" });
    await del.getByLabel("Current Password").fill(password);
    await del.getByRole("button", { name: "Continue" }).click();
    await expect(del.locator(".auth-card__subtitle")).toHaveText("Are You Sure?");
    await del.getByLabel("Type DELETE to confirm").fill("DELETE");
    await del.getByRole("button", { name: "Delete Account" }).click();
    await expect(del).toHaveCount(0, { timeout: 20_000 });

    // Signed out, back on the vault: the sign-in control, no banner, no totals.
    await expect(signInControl(page, info)).toBeVisible({ timeout: 20_000 });
    if (isPhone(info)) {
      await page.locator(".m-nav").getByRole("button", { name: "Vault", exact: true }).click();
      await expect(page.locator(".m-row").first()).toBeVisible();
    }
    await expect(banner).toHaveCount(0);
    await expect(ownedTotal(page, info)).toHaveText("—");
  }
);
