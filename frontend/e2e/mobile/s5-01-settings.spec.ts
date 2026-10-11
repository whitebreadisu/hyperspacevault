import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { expectBackLeft, expectXTopRight, openMore, shellControls } from "./more-helpers";
import type { Page } from "@playwright/test";

// S5-01: Settings at #/more/settings (rev4 `r4-13-settings-layout`): desktop's
// SettingsPage inside the phone's transactional card -- sections in order,
// every control at the 44 px floor, no overflow at 390 / 430 (the two phone
// projects), the keep-limit steppers with floors, the three-way enforcement
// radios, Save / Discard locked until dirty, "Saved.", Usage Analytics, the
// Danger Zone.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone settings");
});

async function openSettings(page: Page) {
  await page.goto("/#/more/settings");
  await expect(page.locator(".m-settings")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test("s5-01-settings-layout", async ({ page }) => {
  await openSettings(page);

  // Sections in order (SettingsPage's own), titles verbatim.
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll(".m-settings .settings-section")].map((s) => ({
      title: s.querySelector(".settings-section__title")?.textContent,
      danger: s.classList.contains("settings-section--danger"),
    }))
  );
  expect(sections).toEqual([
    { title: "Keep-limits", danger: false },
    { title: "Keep-limit enforcement", danger: false },
    { title: "Usage Analytics", danger: false },
    { title: "Danger Zone", danger: true },
  ]);
  // The head says Settings once (desktop's page heading is hidden).
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(1);

  // The card: plain rounded card, 1 px border, 4 px radius, 3 px blue top bar.
  const card = await page.evaluate(() => {
    const el = document.querySelector(".m-acctcard") as HTMLElement;
    const cs = getComputedStyle(el);
    const bar = getComputedStyle(el, "::before");
    const b = el.getBoundingClientRect();
    return {
      border: cs.borderTopWidth + " " + cs.borderTopColor,
      radius: cs.borderTopLeftRadius,
      clip: cs.clipPath,
      bar: bar.height + " " + bar.backgroundColor,
      left: b.left,
      right: b.right,
      iw: innerWidth,
    };
  });
  expect(card.border).toBe("1px rgb(30, 39, 72)");
  expect(card.radius).toBe("4px");
  expect(card.clip).toBe("none");
  expect(card.bar).toBe("3px rgb(37, 99, 235)");
  expect(card.left).toBeGreaterThanOrEqual(0);
  expect(card.right).toBeLessThanOrEqual(card.iw);

  // Every control in the card is at the 44 px floor (steppers drawn at 44).
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".m-acctcard button, .m-acctcard input, .m-acctcard label.sl-capmode__option, .m-acctcard label.settings-analytics__toggle"
      ),
    ]
      .map((e) => ({ n: e.className, w: e.offsetWidth, h: e.offsetHeight }))
      .filter((c) => c.w < 44 || c.h < 44)
  );
  expect(small).toEqual([]);

  // Steppers: label + floor hint, 44 px buttons, floors 1 / 3.
  const steppers = await page.evaluate(() =>
    [...document.querySelectorAll(".sl-capstepper")].map((s) => ({
      label: s.querySelector(".sl-capstepper__title")?.textContent,
      hint: s.querySelector(".sl-capstepper__hint")?.textContent,
      value: s.querySelector(".sl-capstepper__value")?.textContent,
      steps: [...s.querySelectorAll<HTMLElement>(".sl-capstepper__step")].map((b) => [
        b.offsetWidth,
        b.offsetHeight,
        (b as HTMLButtonElement).disabled,
      ]),
    }))
  );
  expect(steppers).toEqual([
    {
      label: "LEADERS & BASES",
      hint: "min 1",
      value: "1",
      steps: [
        [44, 44, true],
        [44, 44, false],
      ],
    },
    {
      label: "ALL OTHER CARDS",
      hint: "min 3",
      value: "3",
      steps: [
        [44, 44, true],
        [44, 44, false],
      ],
    },
  ]);

  // Radios: Hard / Soft / No limits, Hard on; Analytics checkbox; Save and
  // Discard locked until dirty; Delete Account in the Danger Zone.
  await expect(page.locator(".sl-capmode__title")).toHaveText([
    "Hard cap",
    "Soft cap",
    "No limits",
  ]);
  await expect(page.getByRole("radio", { name: /Hard cap/ })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Share anonymous usage analytics/ })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await expect(
    page.locator(".settings-section--danger").getByRole("button", { name: "Delete Account" })
  ).toBeVisible();

  // The same in the cards' reading order: no section wider than the card.
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll(".m-acctcard .settings-section")].some(
      (s) => s.scrollWidth > s.clientWidth + 1
    )
  );
  expect(overflow).toBe(false);
});

test("s5-01-settings-save-flow", async ({ page }) => {
  const rec = recorderFor(page);
  await openSettings(page);
  const save = page.getByRole("button", { name: "Save changes" });
  const discard = page.getByRole("button", { name: "Discard changes" });
  await expect(page.getByText("Saved.")).toHaveCount(0);

  // Raise Leaders & Bases: dirty; Discard puts it back and locks both.
  await page.getByRole("button", { name: "Increase Leaders & Bases cap" }).click();
  await expect(save).toBeEnabled();
  await expect(discard).toBeEnabled();
  await discard.click();
  await expect(save).toBeDisabled();
  await expect(page.locator(".sl-capstepper__value").first()).toHaveText("1");

  // Raise it to 2 and save: PUT carries 15 singleton overrides at 2, cap_mode hard.
  await page.getByRole("button", { name: "Increase Leaders & Bases cap" }).click();
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(save).toBeDisabled();
  expect(rec.limitPuts).toHaveLength(1);
  expect(rec.limitPuts[0].cap_mode).toBe("hard");
  expect(rec.limitPuts[0].limits).toHaveLength(15);
  expect(
    (rec.limitPuts[0].limits as { type_category: string; max_quantity: number }[]).every(
      (o) => o.type_category === "singleton" && o.max_quantity === 2
    )
  ).toBe(true);
  await expect(page.locator(".sl-capstepper__value").first()).toHaveText("2");

  // Any further edit clears "Saved."; No limits inerts both steppers and saves
  // all 30 cells unlimited.
  await page.getByRole("radio", { name: /No limits/ }).check();
  await expect(page.getByText("Saved.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Increase Leaders & Bases cap" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Increase All other cards cap" })).toBeDisabled();
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  expect(rec.limitPuts).toHaveLength(2);
  expect(rec.limitPuts[1].limits).toHaveLength(30);
  expect(
    (rec.limitPuts[1].limits as { max_quantity: number | null }[]).every(
      (o) => o.max_quantity === null
    )
  ).toBe(true);
  await expect(page.getByRole("radio", { name: /No limits/ })).toBeChecked();
});

test("s5-01-settings-back-and-x", async ({ page }) => {
  // From More: the back chevron returns to More (S4-05 rule).
  await openMore(page);
  await page.locator('[data-more="settings"]').click();
  await expect(page).toHaveURL(/#\/more\/settings$/);
  await expect(page.locator(".m-settings")).toBeVisible();
  expectBackLeft(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Back']").click();
  await expect(page).toHaveURL(/#\/more$/);

  // Any other way in (here a fresh load): the X top-right, falling back to the Vault.
  await page.goto("/#/more/settings");
  await page.reload();
  await expect(page.locator(".m-settings")).toBeVisible();
  expectXTopRight(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Close']").click();
  await expect(page).toHaveURL(/#\/vault$/);
});
