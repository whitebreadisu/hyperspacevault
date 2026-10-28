import { randomBytes } from "node:crypto";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  anonymousContext,
  isPhone,
  journeyTest,
  openSharing,
  openVault,
  runRestore,
  ownedTotal,
  seedSummaryTotals,
  signedInVault,
} from "./_helpers";

// BL-279 WS-3 W3-09, journey J4: the owner creates a share in the sharing
// dialog, copies the link from the UI, a stranger (a second context with no
// storage state) opens it and sees the owner's vault read-only, and the owner
// deletes the share. Seed: tenant A (seed-a.csv, no shares). The journey
// removes its own share at the end, so it leaves tenant A as it found it.
const SEEDED = [
  { set: "SOR", number: 10, name: "Darth Vader", qty: 3 },
  { set: "SOR", number: 100, name: "Wedge Antilles", qty: 3 },
  { set: "SHD", number: 13, name: "Han Solo", qty: 2 },
];

/** Desktop shared vault: the table row for the card shows the owner's copies. */
async function expectDesktopRow(page: Page, c: (typeof SEEDED)[number]) {
  // The signed-out owner pane stays mounted beside the shared one: act on the visible controls.
  const input = page.getByPlaceholder("Search cards…").filter({ visible: true });
  const opened = !(await input.isVisible());
  if (opened) await page.locator(".ifp-sidebar-tab").filter({ visible: true }).click();
  await input.fill(c.name);
  if (opened)
    await page.getByRole("button", { name: "Collapse filters" }).filter({ visible: true }).click();
  const row = page
    .locator("tbody tr:not([aria-hidden])")
    .filter({ visible: true })
    .filter({ has: page.locator(".td-cardnum", { hasText: new RegExp(`^${c.number}$`) }) })
    .filter({ has: page.locator("td", { hasText: new RegExp(`^${c.set}$`) }) });
  await expect(row.locator(".playset-chip")).toHaveText(String(c.qty));
  return row;
}

journeyTest.describe.configure({ mode: "serial" });

journeyTest(
  "j4 a share link opens read-only for a stranger and shows the owner's vault",
  async ({ page, browser }, info) => {
    const shareName = `J4 ${randomBytes(3).toString("hex")}`;
    await signedInVault(page, info);

    // Create the share and read the link out of the dialog.
    const dlg = await openSharing(page, info);
    await dlg.getByLabel("Share Name").fill(shareName);
    await dlg.getByRole("button", { name: "Create Share" }).click();
    let failure: unknown;
    try {
      const linkInput = dlg.locator(".share-modal__link-input");
      await expect(linkInput).toHaveValue(/\/shared\/[\w-]+$/, { timeout: 15_000 });
      await expect(dlg.locator(".share-modal__name")).toContainText(shareName);
      const link = await linkInput.inputValue();
      // A stranger opens the link.
      const stranger = await anonymousContext(browser, info);
      stranger.setDefaultTimeout(15_000);
      try {
        const guest = await stranger.newPage();
        await guest.goto(link);

        if (isPhone(info)) {
          const pane = guest.locator('.m-app__screen[data-pane="shared"]');
          await expect(pane.locator(".m-row").first()).toBeVisible({ timeout: 20_000 });
          await expect(pane.locator(".m-summary__label")).toHaveText(
            new RegExp(`${shareName}'s collection`, "i")
          );
          await expect(pane.locator(".m-metric").filter({ hasText: "Cards owned" })).toContainText(
            String(seedSummaryTotals().copies)
          );
          for (const c of SEEDED) {
            const input = pane.locator(".m-search__input");
            await input.fill(`${c.set} ${c.number}`);
            await input.blur();
            const row = pane.locator(".m-row").filter({
              has: guest.getByRole("button", { name: new RegExp(`^${c.set} ${c.number} `) }),
            });
            await expect(row.locator(".m-row__own")).toHaveAccessibleName(
              new RegExp(`^${c.name}: ${c.qty} owned`)
            );
          }
          // Back to the first card (the loop left the last one searched).
          await pane.locator(".m-search__input").fill(`${SEEDED[0].set} ${SEEDED[0].number}`);
          await pane.locator(".m-search__input").blur();
          // Read-only: no stepper on the rows, and none in an opened card.
          await expect(guest.locator(".m-stepper, .m-step")).toHaveCount(0);
          await pane
            .getByRole("button", { name: new RegExp(`^${SEEDED[0].set} ${SEEDED[0].number} `) })
            .click();
          await expect(guest.locator(".m-cardlayer .m-print").first()).toBeVisible();
          await expect(guest.locator(".m-cardlayer .m-stepper, .m-cardlayer .m-step")).toHaveCount(
            0
          );
          await expect(
            guest.locator(".m-cardlayer .cp-rail__item--active .m-print__qty")
          ).toHaveText(/^×\d+$/);
        } else {
          await expect(guest.locator(".app-header").getByText(shareName)).toBeVisible({
            timeout: 20_000,
          });
          await expect(guest.locator("tbody tr:not([aria-hidden])").first()).toBeVisible({
            timeout: 20_000,
          });
          await expect(
            guest.getByRole("button", { name: `Cards ${seedSummaryTotals().copies} (10 unique)` })
          ).toBeVisible();
          // The first card is checked last, so its row is the one left to open.
          for (const c of [...SEEDED].reverse()) await expectDesktopRow(guest, c);
          await expect(guest.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
          await (await expectDesktopRow(guest, SEEDED[0])).locator(".card-name-link").click();
          await expect(guest.locator(".cp-modal[role=dialog]")).toBeVisible();
          await expect(guest.locator(".cp-plate__step")).toHaveCount(0);
          await guest.keyboard.press("Escape");
        }
      } finally {
        await stranger.close();
      }

      // The owner deletes the share; a fresh visitor finds the link dead.
      await dlg.getByRole("button", { name: "Revoke" }).click();
      await dlg.locator(".auth-danger-submit").click();
      await expect(dlg.getByRole("button", { name: "Create Share" })).toBeVisible({
        timeout: 15_000,
      });
      const later = await anonymousContext(browser, info);
      later.setDefaultTimeout(15_000);
      try {
        const after = await later.newPage();
        await after.goto(link);
        await expect(after.getByText("This shared vault is no longer available.")).toBeVisible({
          timeout: 20_000,
        });
      } finally {
        await later.close();
      }
      await dlg.getByRole("button", { name: "Close" }).click();
      await expect(dlg).toHaveCount(0);
      await openVault(page, info);
      await expect(ownedTotal(page, info)).toHaveText(String(seedSummaryTotals().copies));
    } catch (err) {
      failure = err;
      throw err;
    } finally {
      // A failed run must not leave the share behind for the other layout.
      await runRestore(failure, async () => {
        const revoke = dlg.getByRole("button", { name: "Revoke" });
        if (await revoke.isVisible().catch(() => false)) {
          await revoke.click();
          await dlg.locator(".auth-danger-submit").click();
          await expect(dlg.getByRole("button", { name: "Create Share" })).toBeVisible();
        }
      });
    }
  }
);
