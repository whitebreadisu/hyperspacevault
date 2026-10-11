import { expect, measureEach, test } from "./helpers";
import { openMore } from "./more-helpers";
import type { Page } from "@playwright/test";

// S4-01: More at #/more (rev4 `more`, `more-feedback-entry`,
// `r4-14-no-deck-check`, `account-settings`): groups and rows per auth state
// with desktop's entry names, rows 52 px with chevrons and hairlines, the
// brand block an About button, the bar visible with More active.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone More");
});

const groups = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".m-moregroup")].map((g) => ({
      label: g.getAttribute("aria-label"),
      rows: [...g.querySelectorAll(".m-morerow__title")].map((t) => t.textContent),
    }))
  );

async function rowGeometry(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".m-morerow")].map((r) => {
      const b = r.getBoundingClientRect();
      const cs = getComputedStyle(r);
      return {
        id: r.dataset.more,
        h: Math.round(b.height),
        w: Math.round(b.width),
        chevron: !!r.querySelector("svg"),
        hairline: cs.borderBottomWidth + " " + cs.borderBottomColor,
      };
    })
  );
}

test("s4-01-more-rows-signed-in", async ({ page }) => {
  await openMore(page);
  // The e2e account is a password account whose email is not verified.
  expect(await groups(page)).toEqual([
    { label: "Collection", rows: ["Import & Export", "Sharing"] },
    { label: "Account", rows: ["Settings", "Change Password"] },
    { label: "Hyperspace Vault", rows: ["About & Legal", "[HSV] Updates", "Leave Feedback"] },
    { label: "Session", rows: ["Log Out"] },
  ]);
  const iw = page.viewportSize()!.width;
  for (const r of await rowGeometry(page)) {
    expect(r.h, r.id).toBeGreaterThanOrEqual(52);
    expect(r.w, r.id).toBe(iw);
    expect(r.hairline, r.id).toBe("1px rgb(30, 39, 72)");
    expect(r.chevron, r.id).toBe(r.id !== "logout");
  }
  // The bar stays, More active.
  await expect(page.locator(".m-nav .m-tab", { hasText: "More" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.locator(".m-nav")).toBeVisible();
  // Unverified: Import & Export is inert and explains itself (desktop nudge).
  const ie = page.locator('[data-more="importexport"]');
  await expect(ie).toHaveAttribute("aria-disabled", "true");
  await ie.click({ force: true }); // aria-disabled teaser: still tappable
  await expect(page.locator(".m-more__nudge")).toHaveText(
    "Verify your email to import or export your collection."
  );
  await expect(page).toHaveURL(/#\/more$/);
  // Entries route (Settings is slice 5's screen; More -> Settings exists).
  await page.locator('[data-more="settings"]').click();
  await expect(page).toHaveURL(/#\/more\/settings$/);
  await page.goBack();
  await page.locator('[data-more="feedback"]').click();
  await expect(page).toHaveURL(/#\/more\/feedback$/);
  await expect(page.locator(".m-fb")).toBeVisible();
  await page.goBack();
  // The brand block is the About button.
  await page.locator(".m-more__brand").click();
  await expect(page).toHaveURL(/#\/more\/about$/);
  await expect(page.locator(".m-about")).toBeVisible();
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("s4-01-more-rows-signed-out", async ({ page }) => {
    await openMore(page);
    expect(await groups(page)).toEqual([
      { label: "Collection", rows: ["Import & Export", "Sharing"] },
      { label: "Hyperspace Vault", rows: ["About & Legal", "[HSV] Updates", "Leave Feedback"] },
      { label: "Session", rows: ["Sign in"] },
    ]);
    await expect(page.locator('[data-more="logout"]')).toHaveCount(0);
    // Teasers open sign-in (desktop's anonymous routing).
    await page.locator('[data-more="importexport"]').click({ force: true });
    const dialog = page.getByRole("dialog", { name: "Log In" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.locator('[data-more="signin"]').click();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#\/more$/);
  });
});

test("s4-01-no-deck-check", async ({ page }) => {
  await openMore(page);
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".m-morerow")].map((x) => x.textContent ?? "");
    const note = document.querySelector(".m-more__deckcheck");
    const col = document.querySelector('.m-moregroup[aria-label="Collection"]');
    return {
      noRow: !rows.some((t) => /Deck Check/i.test(t)),
      note: note?.textContent,
      inCollection: !!note && !!col?.contains(note),
      noDeckLink: ![...document.querySelectorAll("a[href], [data-more]")].some((e) =>
        /deck/i.test(e.getAttribute("href") || (e as HTMLElement).dataset.more || "")
      ),
      noPrototype: !document.querySelector('[aria-label="Prototype"]'),
    };
  });
  expect(r).toEqual({
    noRow: true,
    note: "Deck Check is on the desktop site.",
    inCollection: true,
    noDeckLink: true,
    noPrototype: true,
  });
});
