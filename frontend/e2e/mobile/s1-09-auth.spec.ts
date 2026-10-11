import { expect, measureEach, test } from "./helpers";
import type { Page } from "@playwright/test";

// S1-09: the auth layer = desktop AuthModal unchanged inside a phone layer
// (rev4 r4-13-auth-sheets + account-signin-sheet): Log In, Sign Up, Forgot
// password -> Reset Password -> Check Your Email render at 390 and 430, every
// control >= 44, inputs 16 px, no overflow, X top-right. The signed-in flow
// itself is auth.setup.ts (it signs in through this layer).
test.afterEach(measureEach);
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone auth layer");
});

async function layerOk(page: Page, name: string) {
  const dlg = page.getByRole("dialog", { name });
  await expect(dlg).toBeVisible();
  const m = await dlg.evaluate((card) => {
    const root = card.closest(".m-authlayer")!;
    const x = card.querySelector(".auth-modal-close")!.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const bar = getComputedStyle(card, "::before");
    const small = [...root.querySelectorAll("button, input")]
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width && (r.width < 43.5 || r.height < 43.5))
      .map(({ e, r }) => `${Math.round(r.width)}x${Math.round(r.height)} ${e.className}`);
    const over = [...root.querySelectorAll("*")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5);
      })
      .map((e) => e.className);
    const inputs = [...root.querySelectorAll("input")].map((i) => getComputedStyle(i).fontSize);
    return {
      small,
      over,
      inputs,
      x: { w: x.width, h: x.height, dr: c.right - x.right, dt: x.top - c.top },
      card: { l: c.left, r: c.right, w: c.width },
      bar: { bg: bar.backgroundColor, h: bar.height },
      radius: getComputedStyle(card).borderRadius,
      iw: innerWidth,
      docW: document.documentElement.scrollWidth,
    };
  });
  expect(m.small, "controls under 44").toEqual([]);
  expect(m.over, "overflow").toEqual([]);
  expect(m.docW).toBeLessThanOrEqual(m.iw);
  expect(m.inputs.every((f) => f === "16px")).toBe(true);
  expect(m.x.w).toBeGreaterThanOrEqual(44);
  expect(m.x.h).toBeGreaterThanOrEqual(44);
  expect(m.x.dr).toBeLessThanOrEqual(4);
  expect(m.x.dt).toBeLessThanOrEqual(6);
  // Width min(100% - 32px, 420px), centred.
  expect(Math.round(m.card.w)).toBe(Math.min(m.iw - 32, 420));
  expect(Math.round(m.card.l)).toBe(Math.round((m.iw - m.card.w) / 2));
  expect(m.bar).toEqual({ bg: "rgb(37, 99, 235)", h: "3px" });
  expect(m.radius).toBe("4px");
  return dlg;
}

test("s1-09-auth-sheets", async ({ page }) => {
  await page.goto("/#/vault");
  await page.locator(".m-acct .swu-btn").click();

  let dlg = await layerOk(page, "Log In");
  await expect(dlg.locator(".auth-card__title")).toHaveText("HyperspaceVault");
  await expect(dlg.locator(".auth-card__subtitle")).toHaveText("Log In");
  await expect(dlg.locator(".google-auth-button")).toContainText("Sign in with Google");
  await expect(dlg.locator(".auth-field__label")).toHaveText(["Email", "Password"]);
  await expect(dlg.locator(".auth-forgot-link")).toHaveText("Forgot password?");
  await expect(dlg.locator(".auth-switch")).toHaveText("Need an account? Sign up");

  await dlg.locator(".auth-switch").click();
  dlg = await layerOk(page, "Sign Up");
  await expect(dlg.locator(".google-auth-button")).toContainText("Sign up with Google");
  await expect(dlg.locator(".auth-forgot-link")).toHaveCount(0);
  await expect(dlg.locator(".auth-switch")).toHaveText("Already have an account? Log in");

  await dlg.locator(".auth-switch").click();
  dlg = await layerOk(page, "Log In");
  await dlg.locator(".auth-forgot-link").click();
  dlg = await layerOk(page, "Reset Password");
  await expect(dlg.locator(".auth-submit")).toHaveText("Send Reset Link");
  await dlg.getByLabel("Email").fill("e2e@hsv.test");
  await dlg.locator(".auth-submit").click();
  dlg = await layerOk(page, "Check Your Email");
  await expect(dlg.locator(".auth-success")).toContainText("e2e@hsv.test");

  // X closes the layer.
  await dlg.locator(".auth-modal-close").click();
  await expect(page.locator(".m-authlayer")).toHaveCount(0);

  // Escape and the scrim close it too (desktop useModalDismiss / overlay click).
  await page.locator(".m-acct .swu-btn").click();
  await expect(page.getByRole("dialog", { name: "Log In" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-authlayer")).toHaveCount(0);
  await page.locator(".m-acct .swu-btn").click();
  await page.mouse.click(8, page.viewportSize()!.height - 8);
  await expect(page.locator(".m-authlayer")).toHaveCount(0);
});
