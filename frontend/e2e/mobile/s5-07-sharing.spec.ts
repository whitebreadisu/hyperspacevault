import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { openMore } from "./more-helpers";
import type { Page } from "@playwright/test";

// S5-07 (rev4 `r4-13-sharing-states`): desktop's share window (ShareManageModal),
// in a phone layer at #/more/sharing. Empty (create form) -> active (name +
// Rename, link + Copy, New link / Revoke) -> rename -> New link confirm ->
// revoke confirm; every control >= 44 px, inputs 16 px, no overflow (the
// afterEach measure). The shares double in mock-api.ts is stateful.
// Ported 2026-11-12 (stash links, App Spec §19.1 owner screens): the window's
// copy changed ("Share your Vault", "Create share", "Share name", "New link",
// the confirm sentences); the behaviour checked is the same.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone sharing layer");
});

async function facts(page: Page) {
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
      bar: getComputedStyle(card, "::before").height,
      width: Math.round(b.width),
      iw: innerWidth,
      x: { w: x.width, h: x.height, toRight: Math.round(b.right - x.right) },
      inputs: [...card.querySelectorAll("input")].map((i) => ({
        font: getComputedStyle(i).fontSize,
        h: i.getBoundingClientRect().height,
      })),
      buttons: [...card.querySelectorAll("button")].map((e) => ({
        label: (e.textContent ?? "").trim(),
        h: Math.round(e.getBoundingClientRect().height),
        w: Math.round(e.getBoundingClientRect().width),
      })),
    };
  });
}

function expectPhoneCard(f: Awaited<ReturnType<typeof facts>>) {
  expect(f.border).toBe("1px");
  expect(f.radius).toBe("4px");
  expect(f.bar).toBe("3px");
  expect(f.width).toBe(Math.min(420, f.iw - 32));
  expect(f.x.w).toBeGreaterThanOrEqual(44);
  expect(f.x.h).toBeGreaterThanOrEqual(44);
  expect(f.x.toRight).toBeLessThanOrEqual(8);
  for (const i of f.inputs) {
    expect(i.font).toBe("16px");
    expect(i.h).toBeGreaterThanOrEqual(44);
  }
  for (const b of f.buttons) {
    expect(b.h, b.label).toBeGreaterThanOrEqual(44);
    expect(b.w, b.label).toBeGreaterThanOrEqual(44);
  }
}

test("s5-07-sharing-states", async ({ page }) => {
  const rec = recorderFor(page);
  await openMore(page);
  await page.locator('[data-more="sharing"]').click();
  await expect(page).toHaveURL(/#\/more\/sharing$/);
  const dlg = page.getByRole("dialog", { name: "Share your Vault" });
  await expect(dlg).toBeVisible();
  await expect(page.locator(".m-more")).toBeAttached(); // More stays beneath
  await expect(page.locator(".m-soon")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);

  // Empty: the create form (name + Create share), Create locked until typed.
  await expect(dlg.locator(".auth-card__subtitle")).toHaveText("Share your Vault");
  await expect(dlg.getByText(/Create a secret link/)).toBeVisible();
  const create = dlg.getByRole("button", { name: "Create share" });
  await expect(create).toBeDisabled();
  expectPhoneCard(await facts(page));
  await dlg.getByLabel("Share name").fill("Bobs big vault");
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => rec.shares).toEqual(["create Bobs big vault"]);

  // Active: name + Rename, the link + Copy, note, New link / Revoke.
  const link = dlg.locator(".share-modal__link-input");
  await expect(link).toHaveValue(/\/shared\/e2e-share-token-1$/);
  await expect(dlg.locator(".share-modal__name")).toContainText("Bobs big vault");
  await expect(dlg.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "New link" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Revoke" })).toBeVisible();
  expectPhoneCard(await facts(page));

  // Rename: Cancel backs out; Save Name sends the PATCH.
  await dlg.getByRole("button", { name: "Rename" }).click();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg.locator(".share-modal__name")).toContainText("Bobs big vault");
  await dlg.getByRole("button", { name: "Rename" }).click();
  expectPhoneCard(await facts(page));
  await dlg.getByLabel("Share Name", { exact: true }).fill("Renamed vault");
  await dlg.getByRole("button", { name: "Save Name" }).click();
  await expect(dlg.locator(".share-modal__name")).toContainText("Renamed vault");
  expect(rec.shares).toEqual(["create Bobs big vault", "rename Renamed vault"]);

  // New link: the confirm gate (red), Cancel backs out, New link mints token 2.
  await dlg.getByRole("button", { name: "New link" }).click();
  await expect(dlg.locator(".auth-danger-warning")).toContainText(
    "The old link stops working at once"
  );
  expectPhoneCard(await facts(page));
  await dlg.getByRole("button", { name: "Cancel" }).click();
  expect(rec.shares).not.toContain("rotate");
  await dlg.getByRole("button", { name: "New link" }).click();
  await dlg.locator(".auth-danger-submit").click();
  await expect(link).toHaveValue(/\/shared\/e2e-share-token-2$/);
  expect(rec.shares.at(-1)).toBe("rotate");

  // Revoke: the confirm gate, then the empty create form again.
  await dlg.getByRole("button", { name: "Revoke" }).click();
  await expect(dlg.locator(".auth-danger-warning")).toContainText(
    "Revoking breaks the link at once"
  );
  expectPhoneCard(await facts(page));
  expect(rec.shares).not.toContain("revoke");
  await dlg.locator(".auth-danger-submit").click();
  await expect(dlg.getByRole("button", { name: "Create share" })).toBeVisible();
  expect(rec.shares.at(-1)).toBe("revoke");

  // X closes back onto More.
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page).toHaveURL(/#\/more$/);
});

test("s5-07-copy-link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#/more/sharing");
  const dlg = page.getByRole("dialog", { name: "Share your Vault" });
  await dlg.getByLabel("Share name").fill("Copy me");
  await dlg.getByRole("button", { name: "Create share" }).click();
  const link = dlg.locator(".share-modal__link-input");
  await expect(link).toHaveValue(/\/shared\//);
  const url = await link.inputValue();
  await dlg.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dlg.getByRole("button", { name: "Copied!" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  // Fallback: the link field selects its text on focus (manual copy).
  await link.focus();
  expect(await link.evaluate((i: HTMLInputElement) => i.selectionEnd! - i.selectionStart!)).toBe(
    url.length
  );
});
