import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { isPhone, journeyTest, openMore, signedInVault } from "./_helpers";

// BL-279 WS-3 W3-09, journey J7: a user pastes a deck (deck-j7.json, the
// SWUDB deck-JSON shape) and the result reports which cards the seeded vault
// owns and which it is missing. Seed: tenant A owns Darth Vader (SOR 10, 3),
// The Ghost (SOR 50, 1) and Han Solo (SHD 13, 2). The deck: leader SOR 10,
// base SOR 50, main deck SHD 13 x2, SOR 8 Hera Syndulla x1, SOR 9 Leia Organa
// x1 -- three owned, two missing. The main-deck tile counts the 4 main-deck
// copies (leader and base are listed apart): 2 of 4 owned.
//
// Deck Check exists on the desktop site only: the phone app's More screen says
// so ("Deck Check is on the desktop site.") and has no Deck Check route, so on
// phone-390 the journey asserts that statement and stops there.
const DECK = readFileSync("e2e/journeys/deck-j7.json", "utf8");

journeyTest.describe.configure({ mode: "serial" });

journeyTest(
  "j7 a pasted deck reports owned and missing against the seeded vault",
  async ({ page }, info) => {
    await signedInVault(page, info);

    if (isPhone(info)) {
      await openMore(page, info);
      await expect(page.locator(".m-more__deckcheck")).toHaveText(
        "Deck Check is on the desktop site."
      );
      return;
    }

    await page.locator(".app-header").getByRole("button", { name: "Deck Check" }).click();
    await page.getByRole("textbox").fill(DECK);
    await page.getByRole("button", { name: "Check deck" }).click();

    // The main deck: two of four copies owned; the two missing cards listed.
    const main = page.locator(".dcr-scope").filter({ hasText: "Main deck" });
    await expect(main.locator(".dcr-scope__fraction")).toHaveText("2/4", { timeout: 30_000 });
    const rows = main.locator(".dcr-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Hera Syndulla" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Leia Organa" })).toHaveCount(1);
    await expect(page.getByText("Buy 2 missing").first()).toBeVisible();

    // All cards: the owned ones appear too.
    await page.getByRole("button", { name: "All cards" }).click();
    for (const owned of ["Han Solo", "Darth Vader", "The Ghost"]) {
      await expect(page.locator(".dcr-row").filter({ hasText: owned }).first()).toBeVisible();
    }
  }
);
