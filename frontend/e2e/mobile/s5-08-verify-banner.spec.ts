import { expect, measureEach, scrollBy, test } from "./helpers";
import { ensureVerifiedUser, NO_SESSION, openVault, signInVerified } from "./more-helpers";
import type { Page } from "@playwright/test";

// S5-08 (rev4 `r4-13-verify-banner`): desktop's VerifyEmailBanner, unchanged,
// under the Vault header (first child of the list area). The shared e2e
// account is signed in with an UNVERIFIED email, so every Vault spec in this
// suite already runs with the banner shown; the verified case signs in as the
// second emulator account (more-helpers.ensureVerifiedUser).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone verify banner");
});

const geo = (page: Page) =>
  page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const b = r(".verify-email-banner");
    const first = document.querySelector(".m-vault__below")!.firstElementChild;
    return {
      top: b.top,
      bottom: b.bottom,
      left: b.left,
      right: b.right,
      iw: innerWidth,
      slotBottom: r(".m-vh__slot").bottom,
      firstIsBanner: first?.classList.contains("verify-email-banner"),
      controlsTop: r(".m-vault__below > :nth-child(2)").top,
      buttons: [...document.querySelectorAll(".verify-email-banner button")].map((e) => ({
        h: e.getBoundingClientRect().height,
        w: e.getBoundingClientRect().width,
      })),
      bg: getComputedStyle(document.querySelector(".verify-email-banner")!).backgroundColor,
    };
  });

test("s5-08-verify-banner", async ({ page }) => {
  await openVault(page);
  const banner = page.locator(".verify-email-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "status");
  await expect(banner.locator(".verify-email-banner__text")).toHaveText(
    "Verify your email to manage inventory"
  );
  await expect(banner.getByRole("button")).toHaveText(["Resend email", "I've verified"]);

  const g = await geo(page);
  expect(g.firstIsBanner).toBe(true);
  // Under the header, above the status rows, edge to edge.
  expect(g.top).toBeGreaterThanOrEqual(g.slotBottom - 1);
  expect(g.controlsTop).toBeGreaterThanOrEqual(g.bottom - 1);
  expect(g.left).toBe(0);
  expect(Math.round(g.right)).toBe(g.iw);
  expect(g.bg).toBe("rgb(42, 33, 16)");
  for (const b of g.buttons) {
    expect(b.h).toBeGreaterThanOrEqual(44);
    expect(b.w).toBeGreaterThanOrEqual(44);
  }

  // Resend: real send against the emulator; "Email sent" and the 30 s cooldown
  // (the button stays disabled), with the spam-folder hint.
  await banner.getByRole("button", { name: "Resend email" }).click();
  const sent = banner.getByRole("button", { name: "Email sent" });
  await expect(sent).toBeDisabled();
  await expect(banner.locator(".verify-email-banner__hint")).toHaveText(
    "It may take a minute — check your spam folder."
  );

  // The banner is content, not header: it stays put when the header collapses.
  await scrollBy(page, ".m-vault__scroll", 420);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  await expect(banner).toBeVisible();
  const after = await geo(page);
  expect(after.top).toBeGreaterThanOrEqual(after.slotBottom - 1);

  // "I've verified" re-checks: still unverified on the emulator, so it stays.
  await banner.getByRole("button", { name: "I've verified" }).click();
  await expect(banner.getByRole("button", { name: "I've verified" })).toBeEnabled();
  await expect(banner).toBeVisible();
});

test("s5-08-search-mode-steps-aside", async ({ page }) => {
  await openVault(page);
  const banner = page.locator(".verify-email-banner");
  await expect(banner).toBeVisible();
  await page.locator(".m-search__input").focus();
  await expect(page.locator(".m-vault--search")).toHaveCount(1);
  await expect(banner).toBeHidden();
  await page.locator(".m-search__input").blur();
  await expect(banner).toBeVisible();
});

test.describe("verified", () => {
  test.use({ storageState: NO_SESSION });

  test("s5-08-verified-no-banner", async ({ page, request }) => {
    await ensureVerifiedUser(request);
    await signInVerified(page);
    await expect(page.locator(".m-row").first()).toBeVisible();
    await expect(page.locator(".verify-email-banner")).toHaveCount(0);
  });

  test("s5-08-anonymous-no-banner", async ({ page }) => {
    await page.goto("/#/vault");
    await expect(page.locator(".m-row").first()).toBeVisible();
    await expect(page.locator(".verify-email-banner")).toHaveCount(0);
  });
});
