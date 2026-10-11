import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import { openPad } from "./tool-helpers";

// S3-09 (R4-14.2): the precon panel in the keypad's result zone -- deck
// name, "N cards · M distinct", desktop's two keep-limit radios for hard-cap
// users, Change set, Add deck to batch; the number field reads "Deck" and
// the keys rest. Adding writes every deck copy into the batch (one row per
// copy). Seeded from rev4 r4-14-precon-row / -panel / -add-logs.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

async function pickDeck(page: import("@playwright/test").Page, deck = "SOR-VADER") {
  await page.locator(".m-pad__entry .m-padset").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-precon"]').click();
  await page.locator(`.m-d2-deck[data-deck="${deck}"]`).click();
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0);
}

test("s3-09-precon-panel", async ({ page }) => {
  await openPad(page, "#/pad?set=SOR");
  await pickDeck(page);
  const z = page.locator(".m-pad__zone .m-d2-precon");
  await expect(z.locator(".m-d2-precon__name")).toHaveText("Darth Vader");
  await expect(z).toContainText(/Two-Player Starter/i);
  await expect(z.locator(".m-d2-precon__facts")).toHaveText("52 cards · 29 distinct");
  // Desktop's two keep-limit radios, default "Don't add copies above ...".
  const radios = z.locator('[role="radio"]');
  await expect(radios).toHaveText([
    "Don't add copies above my keep-limits",
    "Add the full deck, even above my keep-limits",
  ]);
  await expect(z.locator('[role="radio"][aria-checked="true"]')).toHaveText(/^Don't/);
  const heights = await radios.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().height)
  );
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  // Add deck to batch sits inside the zone; Change set is a 44 px target.
  const add = z.locator(".swu-btn");
  await expect(add).toContainText("Add deck to batch");
  const zb = (await page.locator(".m-pad__zone").boundingBox())!;
  const ab = (await add.boundingBox())!;
  expect(ab.y + ab.height).toBeLessThanOrEqual(zb.y + zb.height + 1);
  const cb = (await z.locator(".m-d2-precon__change").boundingBox())!;
  expect(cb.height).toBeGreaterThanOrEqual(44);
  // The set button reads the deck; the number field reads Deck; keys rest.
  await expect(page.locator(".m-padset__code")).toHaveText("Vader");
  await expect(page.locator(".m-padset")).toHaveAttribute("aria-label", /Precon deck/);
  await expect(page.locator(".m-padnum__val")).toHaveText("Deck");
  await expect(page.locator(".m-key").first()).toHaveAttribute("aria-disabled", "true");
  const op = await page.locator(".m-keys").evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(op)).toBeLessThan(0.5);
  // A key tap does nothing while a deck is chosen.
  await page.locator('.m-keys .m-key[aria-label="8"]').click({ force: true });
  await expect(page.locator(".m-padnum__val")).toHaveText("Deck");
  // Change set returns to the choosers; a set clears the deck.
  await z.locator(".m-d2-precon__change").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-set"]').click();
  await page.locator('.m-setpick__row[data-code="SOR"]').click();
  await expect(page.locator(".m-d2-precon")).toHaveCount(0);
  await expect(page.locator(".m-padset__code")).toHaveText("SOR");
  await expect(page.locator(".m-key[aria-disabled]")).toHaveCount(0);
});

test("s3-09-precon-soft-mode-no-radios", async ({ page }) => {
  // Soft / no-limit users always add the full deck: desktop shows no radios.
  const limits = JSON.parse(readFileSync("e2e/mobile/fixtures/limits.json", "utf8"));
  limits.cap_mode = "soft";
  await page.route(
    (u) => u.pathname === "/api/settings/limits",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(limits) })
  );
  await openPad(page, "#/pad?set=SOR");
  await pickDeck(page);
  await expect(page.locator(".m-d2-precon")).toBeVisible();
  await expect(page.locator('.m-d2-precon [role="radio"]')).toHaveCount(0);
});

test("s3-09-precon-adds-to-batch", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) writes.push(r.method() + " " + r.url());
  });
  await openPad(page, "#/pad?set=SOR");
  await pickDeck(page);
  const badge = page.locator(".m-pad__entry .m-logbtn__n");
  await expect(badge).toHaveCount(0);
  await page.locator(".m-d2-precon .swu-btn").click();
  // Every deck copy is a batch row: 52 copies, one row each.
  await expect(badge).toHaveText("52");
  await expect(page.locator(".m-d2-precon__done")).toHaveText(
    "52 cards in the batch. Verify them before they reach your vault."
  );
  await expect(page.locator(".m-pad__entry .m-logbtn")).toHaveAttribute(
    "aria-label",
    "Verify cards, 52 in batch"
  );
  // The vault is untouched until the Verify cards sheet commits.
  expect(writes).toEqual([]);
  // "Add the full deck" adds the whole deck again, flagged past the cap.
  await page.locator('.m-d2-precon [role="radio"]', { hasText: "Add the full deck" }).click();
  await page.locator(".m-d2-precon .swu-btn").click();
  await expect(badge).toHaveText("104");
  // The batch outlives the tool: close and reopen -- the count is still there.
  await page.evaluate(() => {
    location.hash = "#/vault";
  });
  await expect(page.locator(".m-tool")).toHaveCount(0);
  await page.locator(".m-nav__center .swu-btn").click();
  await expect(page.locator(".m-pad__entry .m-logbtn__n")).toHaveText("104");
});
