import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, BrowserType, Page, TestInfo } from "@playwright/test";

// BL-279 WS-3 W3-08: the journey harness. Plain functions, one per screen a
// journey reaches; each takes the layout from testInfo.project.name and does
// the phone thing (phone-390, the hash-routed MobileApp) or the desktop thing
// (desktop-1440, the CardsPage tree). The pattern every journey copies:
// arrange through the seed (e2e/verify/seed.mjs, run before the suite), act
// through the UI only, assert what the user sees. Nothing here knows about
// mocks or the network: no route interception, no request or response assertions
// (the mocked item suite under e2e/mobile owns those).

export interface CardRef {
  set: string;
  number: number | string;
  /** Desktop search matches the name only (utils/filters.ts applyFilters). */
  name: string;
}

export const isPhone = (info: TestInfo) => info.project.name.startsWith("phone");

/** The phone stepper (mobile/card/useStepper.ts) and the desktop popup
 * (screens/cards/CardPopupInventory.tsx) both batch taps into one write 400 ms
 * after the last tap. */
const ADJUST_DEBOUNCE_MS = 400;

/** The verify prompt both layouts show when a write meets the email gate
 * (useStepper.ts / CardPopupInventory.tsx VERIFY_EMAIL_MESSAGE). */
export const VERIFY_PROMPT = "Verify your email to manage inventory -- see the banner above.";
export const VERIFY_BANNER = "Verify your email to manage inventory";

const LOCAL = process.env.E2E_LOCAL === "1";

/** Local stack only (E2E_LOCAL=1): the app there calls connectAuthEmulator
 * without disableWarnings, so the Firebase SDK pins a "Running in emulator
 * mode" banner (.firebase-emulator-warning) over the bottom of the page, on
 * top of the phone's bottom bar; it intercepted the More tab tap in the PR's
 * scratch run. Hidden by an init script before any navigation, the same way
 * e2e/mobile/helpers.ts hideEmulatorBanner does for the mocked suite (copied,
 * not imported: that module pulls in the mock API). Dev and prod use real
 * Firebase and never show the banner, so nothing is injected there. */
function hideEmulatorBanner() {
  const add = () => {
    const st = document.createElement("style");
    st.textContent = ".firebase-emulator-warning{display:none!important}";
    document.head.append(st);
  };
  if (document.head) add();
  else document.addEventListener("DOMContentLoaded", add);
}

/** The journey test: Playwright's test plus an automatic fixture that gives
 * each journey a 90 s budget and annotates a retry. Each spec file starts
 * with `journeyTest.describe.configure({ mode: "serial" })` (one journey per
 * file, serial; the call has to sit in the file it configures) and calls
 * `journeyTest(title, ...)` itself, so the report's location is the spec. The
 * test title is the catalogue's terminal assertion. Traces come from the
 * config's trace: "retain-on-failure" (a trace option cannot be set per test):
 * every attempt is recorded and the failed ones are kept, so a test that
 * needed its CI retry carries the failed attempt's trace in the report, and
 * the retry's own if it also failed. */
export const journeyTest = test.extend<{ journey: void }>({
  journey: [
    async ({ page }, use, info) => {
      info.setTimeout(90_000);
      if (LOCAL) await page.addInitScript(hideEmulatorBanner);
      if (info.retry > 0)
        info.annotations.push({
          type: "retry",
          description: `attempt ${info.retry + 1}; the failed attempt's trace is attached to it`,
        });
      await use();
    },
    { auto: true },
  ],
});

/** The seed's tenant-A totals: VERIFY_SEED_SUMMARY (the seed's printed line,
 * "seed A: variants=<n> copies=<n> ...") when set, else recomputed from the
 * committed seed-a.csv. */
export function seedSummaryTotals(): { variants: number; copies: number } {
  const line = process.env.VERIFY_SEED_SUMMARY;
  if (line) {
    const v = /variants=(\d+)/.exec(line);
    const c = /copies=(\d+)/.exec(line);
    if (!v || !c) throw new Error("VERIFY_SEED_SUMMARY has no variants=/copies= fields");
    return { variants: Number(v[1]), copies: Number(c[1]) };
  }
  const rows = readFileSync("e2e/journeys/seed-a.csv", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .slice(1);
  const qty = rows.map((r) => Number(r.split(",")[4])).filter((q) => q > 0);
  return { variants: qty.length, copies: qty.reduce((a, b) => a + b, 0) };
}

/** The "cards owned" total in the vault header (phone: the completion panel's
 * Cards owned metric; desktop: the summary strip's Cards block). */
export function ownedTotal(page: Page, info: TestInfo) {
  return isPhone(info)
    ? page.locator(".m-metric").filter({ hasText: "Cards owned" }).locator(".m-metric__value")
    : page
        .locator(".inv-summary__block")
        .filter({ hasText: /^Cards/ })
        .locator(".inv-summary__value");
}

/** Open the vault for the project's layout and wait until it shows rows. */
export async function openVault(page: Page, info: TestInfo) {
  if (isPhone(info)) {
    await page.goto("/#/vault");
    await expect(page.locator(".m-row").first()).toBeVisible({ timeout: 20_000 });
  } else {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("tbody tr:not([aria-hidden])").first()).toBeVisible({
      timeout: 20_000,
    });
  }
}

/** Signed in (the setup project's storage state): land on the vault and wait
 * for the seeded totals to show. */
export async function signedInVault(page: Page, info: TestInfo) {
  await openVault(page, info);
  await expect(accountControl(page, info)).toBeVisible({ timeout: 20_000 });
  await expect(ownedTotal(page, info)).toHaveText(String(seedSummaryTotals().copies), {
    timeout: 20_000,
  });
}

/** The signed-in account control: phone avatar, desktop header avatar menu. */
export function accountControl(page: Page, info: TestInfo) {
  return isPhone(info)
    ? page.locator(".m-acct__hit")
    : page.locator(".app-header").getByRole("button", { name: "Account menu" });
}

/** The signed-out account control: phone account slot, desktop header. */
export function signInControl(page: Page, info: TestInfo) {
  return isPhone(info)
    ? page.locator(".m-acct").getByRole("button", { name: /^sign in$/i })
    : page.locator(".app-header").getByRole("button", { name: /^sign in$/i });
}

/** Open a card: phone through the Vault's search ("SET n" matches the set and
 * number), desktop through the filter panel's search and the table row. */
export async function openCard(page: Page, info: TestInfo, card: CardRef) {
  if (isPhone(info)) {
    const input = page.locator(".m-search__input");
    await input.fill(`${card.set} ${card.number}`);
    // Leave search mode first (blur restores the header and bar): a tap while
    // the layout is still animating back lands on the moving list.
    await input.blur();
    await expect(page.locator(".m-vault--search")).toHaveCount(0);
    await page
      .locator(".m-row__main")
      .and(page.getByRole("button", { name: new RegExp(`^${card.set} ${card.number} `) }))
      .click();
    await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible();
  } else {
    const input = page.getByPlaceholder("Search cards…");
    // The filter rail starts closed at 1440: open it to reach the search box,
    // then collapse it again so it does not cover the table.
    const opened = !(await input.isVisible());
    if (opened) await page.locator(".ifp-sidebar-tab").click();
    await input.fill(card.name);
    if (opened) await page.getByRole("button", { name: "Collapse filters" }).click();
    const row = page
      .locator("tbody tr:not([aria-hidden])")
      .filter({ has: page.locator(".td-cardnum", { hasText: new RegExp(`^${card.number}$`) }) });
    await expect(row).toHaveCount(1);
    await row.locator(".card-name-link").click();
    await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
  }
  // Both layouts open on the Standard printing (the representative); the
  // stepper's label names it, so a journey never steps the wrong printing.
  await expect(stepButton(page, info, "Increment", card)).toBeVisible();
}

/** Reload the page and come back to the open card: the phone's card route is
 * a deep link (#/card/<id>), the desktop popup is reopened from the table. */
export async function reloadCard(page: Page, info: TestInfo, card: CardRef) {
  await page.reload();
  if (isPhone(info)) {
    await expect(page.locator(".m-cardlayer .m-dreg3")).toBeVisible({ timeout: 20_000 });
    await expect(stepButton(page, info, "Increment", card)).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(page.locator("tbody tr:not([aria-hidden])").first()).toBeVisible({
      timeout: 20_000,
    });
    await openCard(page, info, card);
  }
}

export async function closeCard(page: Page, info: TestInfo) {
  if (isPhone(info)) {
    await page.locator(".m-hdr__close").click();
    await expect(page.locator(".m-cardlayer")).toHaveCount(0);
  } else {
    await page.locator(".cp-modal .cp-close").click();
    await expect(page.locator(".cp-modal")).toHaveCount(0);
  }
}

function stepButton(page: Page, info: TestInfo, dir: "Increment" | "Decrement", card: CardRef) {
  const label = `${dir} Standard – #${card.number} – ${card.set}`;
  const scope = isPhone(info)
    ? page.locator(".m-print.cp-rail__item--active")
    : page.locator(".cp-modal");
  return scope.getByRole("button", { name: label, exact: true });
}

/** The open card's Standard quantity readout. */
export function readQuantity(page: Page, info: TestInfo) {
  return isPhone(info)
    ? page.locator(".m-print.cp-rail__item--active .m-step__qty")
    : page.locator(".cp-modal .cp-plate__qty");
}

export async function increment(page: Page, info: TestInfo, card: CardRef) {
  await stepButton(page, info, "Increment", card).click();
}

export async function decrement(page: Page, info: TestInfo, card: CardRef) {
  await stepButton(page, info, "Decrement", card).click();
}

/** Wait until the stepper's batched write has gone and come back: past the
 * debounce, then until the layout's own saving state clears (phone
 * .m-stepper--pending, desktop .cp-plate--pending). What the page shows as
 * saved; no network hook. */
export async function settled(page: Page, info: TestInfo) {
  await page.waitForTimeout(ADJUST_DEBOUNCE_MS + 200);
  const pending = isPhone(info) ? ".m-stepper--pending" : ".cp-plate--pending";
  await expect(page.locator(pending)).toHaveCount(0, { timeout: 15_000 });
}

/** Phone: the More tab. Desktop has no More screen: its account menu is the
 * equivalent surface (Settings, Change Password, About, Log Out). */
export async function openMore(page: Page, info: TestInfo) {
  if (isPhone(info)) {
    await page.locator(".m-nav").getByRole("button", { name: "More", exact: true }).click();
    await expect(page.locator(".m-more")).toBeVisible();
  } else {
    await accountControl(page, info).click();
    await expect(page.locator(".app-header__menu[role=menu]")).toBeVisible();
  }
}

export async function openSettings(page: Page, info: TestInfo) {
  await openMore(page, info);
  if (isPhone(info)) {
    await page.locator(".m-morerow").filter({ hasText: "Settings" }).click();
    await expect(page.locator(".m-settings")).toBeVisible();
  } else {
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.locator(".settings-screen")).toBeVisible();
  }
}

/** A second context with no storage state (an anonymous visitor), on the
 * project's own device settings. */
export async function anonymousContext(browser: Browser, info: TestInfo): Promise<BrowserContext> {
  const u = info.project.use;
  const context = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    userAgent: u.userAgent,
    storageState: { cookies: [], origins: [] },
  });
  if (LOCAL) await context.addInitScript(hideEmulatorBanner);
  return context;
}

// ---- 3c-2 additions (J3 to J7) ----

/** The open card's active printing: its rail price text ("$1.23", or the
 * em-dash for a printing with no price). Both layouts mark the active rail row
 * with .cp-rail__item--active. */
export function activePrice(page: Page, info: TestInfo) {
  const row = page.locator(".cp-rail__item--active");
  return isPhone(info)
    ? row.locator(".m-print__price")
    : row.locator('[data-testid="rail-price-text"]');
}

/** The price-history panel of the open card (the compact embed under the
 * desktop rail; the phone card's chart). */
export function historyPanel(page: Page) {
  return page.getByTestId("price-history-panel");
}

/** openCard for a number that several sets share on desktop (SOR 5 and ASH 5
 * are both "Luke Skywalker" #5): the same flow, with the row narrowed by the
 * set column too. Phone searches "SET n", so it is openCard unchanged. */
export async function openCardInSet(page: Page, info: TestInfo, card: CardRef) {
  if (isPhone(info)) return openCard(page, info, card);
  const input = page.getByPlaceholder("Search cards…");
  const opened = !(await input.isVisible());
  if (opened) await page.locator(".ifp-sidebar-tab").click();
  await input.fill(card.name);
  if (opened) await page.getByRole("button", { name: "Collapse filters" }).click();
  const row = page
    .locator("tbody tr:not([aria-hidden])")
    .filter({ has: page.locator(".td-cardnum", { hasText: new RegExp(`^${card.number}$`) }) })
    .filter({ has: page.locator("td", { hasText: new RegExp(`^${card.set}$`) }) });
  await expect(row).toHaveCount(1);
  await row.locator(".card-name-link").click();
  await expect(page.locator(".cp-modal[role=dialog]")).toBeVisible();
  await expect(
    page.locator(".cp-modal").getByRole("button", {
      name: `Increment Standard – #${card.number} – ${card.set}`,
      exact: true,
    })
  ).toBeVisible();
}

/** The owner's Share Your Vault dialog: phone More -> Sharing, desktop the
 * vault header's Share button. */
export async function openSharing(page: Page, info: TestInfo) {
  if (isPhone(info)) {
    await openMore(page, info);
    await page.locator('[data-more="sharing"]').click();
  } else {
    await page.getByRole("button", { name: "Share", exact: true }).click();
  }
  const dlg = page.getByRole("dialog", { name: "Share Your Vault" });
  await expect(dlg).toBeVisible();
  return dlg;
}

/** The Import & Export screen: phone More -> Import & Export, desktop the
 * vault header's Import / Export button (verified accounts only). */
export async function openImportExport(page: Page, info: TestInfo) {
  if (isPhone(info)) {
    await openMore(page, info);
    await page.locator('[data-more="importexport"]').click();
    await expect(page.locator(".m-ie")).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Import / Export", exact: true }).click();
    await expect(page.locator(".ie-screen")).toBeVisible();
  }
  await expect(page.locator("#ie-file-input")).toBeAttached();
}

/** From the configure step: upload a file, Replace All + Add everything,
 * preview, tick the removal confirmation, confirm, wait for the success line.
 * Returns the success line ("Import complete - n rows written."). */
export async function importReplaceAll(page: Page, path: string) {
  await page.locator("#ie-file-input").setInputFiles(path);
  await page.getByRole("radio", { name: /Replace All/ }).click();
  await page.getByRole("radio", { name: /Add everything/ }).click();
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Confirm import" }).click();
  const done = page.locator(".ie-success");
  await expect(done).toBeVisible({ timeout: 30_000 });
  return (await done.textContent()) ?? "";
}

/** A phone context on a Chromium launched with the fake camera streaming a
 * clip (the --use-file-for-fake-video-capture flags are LAUNCH flags, so the
 * clip gets its own browser; e2e/mobile/clip-helpers.ts explains). Same device
 * settings and signed-in storage state as the project's own pages. The caller
 * closes the browser. */
export async function clipContext(
  chromium: BrowserType,
  info: TestInfo,
  clipFile: string
): Promise<{ browser: Browser; context: BrowserContext }> {
  const u = info.project.use;
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${clipFile}`,
    ],
  });
  const context = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    userAgent: u.userAgent,
    storageState: u.storageState,
    permissions: ["camera"],
  });
  return { browser, context };
}

/** Run a cleanup step in a finally block. If the journey already failed
 * (`failure`), a cleanup error is appended to that failure's message instead
 * of replacing it; on a passing journey the cleanup error is thrown. */
export async function runRestore(failure: unknown, restore: () => Promise<void>) {
  try {
    await restore();
  } catch (err) {
    if (failure instanceof Error) {
      failure.message += `
[restore step also failed] ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    throw err;
  }
}
