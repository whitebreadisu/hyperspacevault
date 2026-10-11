import { expect, measureEach, test } from "./helpers";
import { openMore, transitionsDone } from "./more-helpers";
import type { Page } from "@playwright/test";

// S5-02 / S5-03: Change Password and Delete Account are desktop's modals,
// unchanged, in a phone layer (rev4 `r4-13-password-layout`,
// `r4-13-delete-two-steps`): card min(100% - 32px, 420px), 1 px border, 4 px
// radius, 3 px blue top bar, X top-right at 44 px, inputs 16 px, every control
// >= 44 px, red for the destructive confirm.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone account layers");
});

async function cardFacts(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".m-acctlayer .auth-modal-card")!;
    const cs = getComputedStyle(card);
    const b = card.getBoundingClientRect();
    const x = document
      .querySelector<HTMLElement>(".m-acctlayer .auth-modal-close")!
      .getBoundingClientRect();
    return {
      border: cs.borderTopWidth,
      radius: cs.borderTopLeftRadius,
      clip: cs.clipPath,
      bar:
        getComputedStyle(card, "::before").height +
        " " +
        getComputedStyle(card, "::before").backgroundColor,
      width: Math.round(b.width),
      iw: innerWidth,
      x: {
        w: x.width,
        h: x.height,
        toRight: Math.round(b.right - x.right),
        toTop: Math.round(x.top - b.top),
      },
      inputs: [...card.querySelectorAll("input")].map((i) => ({
        font: getComputedStyle(i).fontSize,
        h: i.getBoundingClientRect().height,
      })),
      buttons: [...card.querySelectorAll("button")].map((e) =>
        Math.round(e.getBoundingClientRect().height)
      ),
    };
  });
}

test("s5-02-password-layout", async ({ page }) => {
  await page.goto("/#/more/password");
  const dlg = page.getByRole("dialog", { name: "Change Password" });
  await expect(dlg).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // Title and fields verbatim; no reauth note (S5-02 tiebreaker).
  await expect(dlg.locator(".auth-card__subtitle")).toHaveText("Change Password");
  await expect(dlg.locator(".auth-field__label")).toHaveText([
    "Current Password",
    "New Password",
    "Confirm New Password",
  ]);
  await expect(dlg.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Change Password" })).toBeVisible();

  const f = await cardFacts(page);
  expect(f.border).toBe("1px");
  expect(f.radius).toBe("4px");
  expect(f.clip).toBe("none");
  expect(f.bar).toBe("3px rgb(37, 99, 235)");
  expect(f.width).toBe(Math.min(420, f.iw - 32));
  expect(f.x.w).toBeGreaterThanOrEqual(44);
  expect(f.x.h).toBeGreaterThanOrEqual(44);
  expect(f.x.toRight).toBeLessThanOrEqual(8);
  expect(f.x.toTop).toBeLessThanOrEqual(8);
  expect(f.inputs).toHaveLength(3);
  for (const i of f.inputs) {
    expect(i.font).toBe("16px");
    expect(i.h).toBeGreaterThanOrEqual(44);
  }
  for (const h of f.buttons) expect(h).toBeGreaterThanOrEqual(44);

  // Escape and Cancel close it; a deep link has nothing to go back through, so
  // the fall-back is More.
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(page).toHaveURL(/#\/more$/);
  await expect(page.locator(".m-more")).toBeVisible();
});

test("s5-02-password-mismatch", async ({ page }) => {
  await openMore(page);
  await page.locator('[data-more="password"]').click();
  await expect(page).toHaveURL(/#\/more\/password$/);
  const dlg = page.getByRole("dialog", { name: "Change Password" });
  await expect(dlg).toBeVisible();
  // Layered over More, which stays mounted beneath.
  await expect(page.locator(".m-more")).toBeAttached();
  await dlg.getByLabel("Current Password", { exact: true }).fill("e2e-password-1");
  await dlg.getByLabel("New Password", { exact: true }).fill("new-password-1");
  await dlg.getByLabel("Confirm New Password").fill("different-password");
  await dlg.getByRole("button", { name: "Change Password" }).click();
  await expect(dlg.locator(".auth-error")).toHaveText("New passwords do not match.");
  // Still open, nothing changed; Cancel returns to More.
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page).toHaveURL(/#\/more$/);
});

test("s5-03-delete-two-steps", async ({ page }) => {
  await page.goto("/#/more/settings");
  await expect(page.locator(".m-settings")).toBeVisible();
  await page
    .locator(".settings-section--danger")
    .getByRole("button", { name: "Delete Account" })
    .click();
  await expect(page).toHaveURL(/#\/more\/delete$/);
  const dlg = page.getByRole("dialog", { name: "Delete Account" });
  await expect(dlg).toBeVisible();
  // Settings stays mounted beneath the layer.
  await expect(page.locator(".m-settings")).toBeAttached();
  await page.evaluate(() => document.fonts.ready);

  // Step one: warning + current password.
  await expect(dlg.locator(".auth-card__subtitle")).toHaveText("Delete Account");
  await expect(dlg.locator(".auth-danger-warning")).toHaveText(
    "This permanently deletes your account and all inventory records. This cannot be undone."
  );
  await expect(dlg.locator(".auth-field__label")).toHaveText(["Current Password"]);
  const one = await cardFacts(page);
  expect(one.width).toBe(Math.min(420, one.iw - 32));
  expect(one.x.w).toBeGreaterThanOrEqual(44);
  expect(one.x.h).toBeGreaterThanOrEqual(44);
  expect(one.x.toRight).toBeLessThanOrEqual(8);
  expect(one.inputs[0].font).toBe("16px");
  for (const h of one.buttons) expect(h).toBeGreaterThanOrEqual(44);

  await dlg.getByLabel("Current Password").fill("e2e-password-1");
  await dlg.getByRole("button", { name: "Continue" }).click();

  // Step two: Are You Sure? + the DELETE gate; the confirm is destructive red.
  await expect(dlg.locator(".auth-card__subtitle")).toHaveText("Are You Sure?");
  const confirm = dlg.getByRole("button", { name: "Delete Account" });
  await expect(confirm).toBeDisabled();
  await dlg.getByLabel("Type DELETE to confirm").fill("delete");
  await expect(confirm).toBeDisabled();
  await dlg.getByLabel("Type DELETE to confirm").fill("DELETE");
  await expect(confirm).toBeEnabled();
  // The tap on Continue left the pointer over this button (hover shade).
  await page.mouse.move(0, 0);
  await transitionsDone(page);
  const red = await confirm.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(red).toBe("rgb(239, 68, 68)");
  const two = await cardFacts(page);
  expect(two.x.w).toBeGreaterThanOrEqual(44);
  expect(two.inputs[0].font).toBe("16px");
  for (const h of two.buttons) expect(h).toBeGreaterThanOrEqual(44);

  // Nothing is deleted here: Cancel closes the layer back onto Settings.
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page).toHaveURL(/#\/more\/settings$/);
  await expect(page.locator(".m-settings")).toBeVisible();
});

test("s5-03-delete-deep-link", async ({ page }) => {
  await page.goto("/#/more/delete");
  const dlg = page.getByRole("dialog", { name: "Delete Account" });
  await expect(dlg).toBeVisible();
  await expect(page.locator(".m-settings")).toBeAttached();
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page).toHaveURL(/#\/more\/settings$/);
});
