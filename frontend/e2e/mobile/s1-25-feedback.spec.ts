import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import type { Page } from "@playwright/test";

// S1-25: Leave Feedback (rev4 feedback-fits, feedback-contact,
// feedback-bad-email, feedback-submitted, feedback-auto-close). Copy and
// behaviour = desktop FeedbackModal; POST /api/feedback is mocked (200).
test.afterEach(measureEach);

test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone feedback");
});

async function openFeedback(page: Page) {
  await page.goto("/#/more/feedback");
  await expect(page.locator(".m-fb")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** rev4 fbFits: Cancel + Submit (caps included) inside the body's inner edge,
 * both >= 44 px tall. */
const fits = (p: Page) =>
  p.evaluate(() => {
    const body = document.querySelector(".m-fb__body")!;
    const cs = getComputedStyle(body);
    const br = body.getBoundingClientRect();
    const innerL = br.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const innerR = br.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const sub = document.querySelector(".m-fb__submit")!.getBoundingClientRect();
    const can = document.querySelector(".m-fb__cancel")!.getBoundingClientRect();
    const caps = [...document.querySelectorAll(".m-fb__submit svg")].map(
      (e) => e.getBoundingClientRect().right
    );
    return (
      sub.right <= innerR + 0.5 &&
      Math.max(...caps) <= innerR + 0.5 &&
      can.left >= innerL - 0.5 &&
      sub.height >= 44 &&
      can.height >= 44
    );
  });

test("s1-25-feedback-fits", async ({ page }) => {
  await openFeedback(page);
  expect(await fits(page)).toBe(true);
  // Steel-ring shell at full-shell scale: 18 px outer / 17 px inner cuts.
  const shell = await page.evaluate(() => ({
    outer: getComputedStyle(document.querySelector(".m-fb__shell")!).clipPath,
    inner: getComputedStyle(document.querySelector(".m-fb__panel")!).clipPath,
    ring: getComputedStyle(document.querySelector(".m-fb__shell")!).backgroundColor,
  }));
  expect(shell.outer).toContain("18px 0px");
  expect(shell.inner).toContain("17px 0px");
  expect(shell.ring).toBe("rgba(211, 211, 212, 0.28)");
  // Desktop copy, verbatim.
  await expect(page.locator(".m-fb__title")).toHaveText("Leave Feedback");
  await expect(page.locator(".m-fb__label").first()).toHaveText("Your Feedback");
  await expect(page.locator(".m-fb__textarea")).toHaveAttribute(
    "placeholder",
    "Bug reports, ideas, anything on your mind..."
  );
  await expect(page.locator(".m-fb__check")).toHaveText(
    "Is it OK if we contact you to learn more?"
  );
  await expect(page.locator(".m-fb__submit")).toHaveText("Submit Feedback");
  await expect(page.locator(".m-fb__submit")).toHaveAttribute("aria-disabled", "true");
  // X top-right, 44 px; the textarea is 16 px (no iOS zoom).
  const x = await page.locator(".m-fb__close").boundingBox();
  const panel = await page.locator(".m-fb__panel").boundingBox();
  expect(x!.width).toBeGreaterThanOrEqual(44);
  expect(x!.height).toBeGreaterThanOrEqual(44);
  expect(x!.x + x!.width).toBeGreaterThan(panel!.x + panel!.width - 20);
  expect(x!.y).toBeLessThan(panel!.y + 20);
  await expect(page.locator(".m-fb__textarea")).toHaveCSS("font-size", "16px");
  // The honeypot is out of sight and out of the tab order.
  await expect(page.locator('.m-fb__honeypot input[name="website"]')).toHaveAttribute(
    "tabindex",
    "-1"
  );
});

test("s1-25-feedback-contact", async ({ page }) => {
  await openFeedback(page);
  await page.locator(".m-fb__textarea").fill("The one-line rows are great.");
  await expect(page.locator(".m-fb__input")).toHaveCount(0);
  await page.locator(".m-fb__check").click();
  await expect(page.locator(".m-fb__check")).toHaveAttribute("aria-checked", "true");
  // Email revealed, prefilled from the account; Submit enabled; still fits.
  await expect(page.locator(".m-fb__input")).toHaveValue("e2e@hsv.test");
  await expect(page.locator(".m-fb__input")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".m-fb__submit")).not.toHaveAttribute("aria-disabled", "true");
  expect(await fits(page)).toBe(true);
});

test("s1-25-feedback-bad-email", async ({ page }) => {
  await openFeedback(page);
  await page.locator(".m-fb__textarea").fill("Hello");
  await expect(page.locator(".m-fb__submit")).not.toHaveAttribute("aria-disabled", "true");
  await page.locator(".m-fb__check").click();
  await page.locator(".m-fb__input").fill("nope");
  await expect(page.locator(".m-fb__submit")).toHaveAttribute("aria-disabled", "true");
  // A tap on the blocked Submit sends nothing.
  let posted = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/feedback")) posted += 1;
  });
  // (force: Playwright treats aria-disabled as not actionable; a finger isn't.)
  await page.locator(".m-fb__submit").click({ force: true });
  await page.waitForTimeout(200);
  expect(posted).toBe(0);
  await page.locator(".m-fb__input").fill("me@example.com");
  await expect(page.locator(".m-fb__submit")).not.toHaveAttribute("aria-disabled", "true");
});

test("s1-25-feedback-submitted", async ({ page }) => {
  await openFeedback(page);
  await page.locator(".m-fb__textarea").fill("Hello");
  await page.locator(".m-fb__check").click();
  const req = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().includes("/api/feedback")
  );
  await page.locator(".m-fb__submit").click();
  const body = JSON.parse((await req).postData() ?? "{}") as Record<string, unknown>;
  expect(body).toEqual({
    message: "Hello",
    contact_ok: true,
    contact_email: "e2e@hsv.test",
    website: "",
  });
  await expect(page.locator(".m-fb__success")).toHaveText("Thanks for the feedback!");
});

test("s1-25-feedback-error", async ({ page }) => {
  await page.route("**/api/feedback", (r) => r.fulfill({ status: 500, body: "{}" }));
  await openFeedback(page);
  await page.locator(".m-fb__textarea").fill("Hello");
  await page.locator(".m-fb__submit").click();
  await expect(page.locator(".m-fb__error")).toHaveText(
    "Something went wrong sending your feedback. Please try again."
  );
  await expect(page.locator(".m-fb__error")).toHaveCSS("color", "rgb(248, 113, 113)");
  await expect(page.locator(".m-fb__textarea")).toHaveValue("Hello");
  // The deliberate 500 is the test's own: drop the browser's "Failed to load
  // resource" line for it from the console-error sweep (nothing else).
  const rec = recorderFor(page);
  const keep = rec.consoleErrors.filter((e) => !/status of 500/.test(e));
  rec.consoleErrors.splice(0, rec.consoleErrors.length, ...keep);
});

test("s1-25-feedback-auto-close", async ({ page }) => {
  await page.goto("/#/vault");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.locator(".m-vh__fb").click();
  await expect(page.locator(".m-fb")).toBeVisible();
  await page.locator(".m-fb__textarea").fill("Hello");
  await page.locator(".m-fb__submit").click();
  await expect(page.locator(".m-fb__success")).toBeVisible();
  await page.waitForTimeout(1900);
  await expect(page.locator(".m-fb")).toHaveCount(0);
  expect(new URL(page.url()).hash.startsWith("#/vault")).toBe(true);
  // X and Escape close back to the caller too.
  await page.locator(".m-vh__fb").click();
  await page.locator(".m-fb__close").click();
  await expect(page.locator(".m-fb")).toHaveCount(0);
  await page.locator(".m-vh__fb").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-fb")).toHaveCount(0);
  expect(new URL(page.url()).hash.startsWith("#/vault")).toBe(true);
});
