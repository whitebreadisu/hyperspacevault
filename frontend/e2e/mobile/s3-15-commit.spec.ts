import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import { addTimes, key, openPad, openVerify, typeNum } from "./tool-helpers";

// S3-15: "Add N cards to vault" commits through desktop's paths -- keypad
// copies -> one adjustCard per printing with the folded delta (handleCommit),
// precon copies -> runImport(file, "merge_add", capHandling, "commit") with
// desktop's import file rebuilt from the admitted deck copies
// (handlePreconCommit); the quantities refresh; "N cards added." then the
// sheet closes; errors stay inline in the sheet. Seeded from rev4
// r4-14-verify-commit (mock adjust + import routes).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

test("s3-15-commit-adjusts-quantities", async ({ page }) => {
  const rec = recorderFor(page);
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 2); // owned 1 of 3: both fit
  await addTimes(page, 35, 1); // owned 3 of 3: not added
  await openVerify(page);
  const s = page.locator(".m-sheet-layer--verify");
  await s.locator(".m-d2-verify__commit").click();
  await expect(s.locator(".m-d2-verify__success")).toHaveText("2 cards added.");
  // One adjust per printing with the folded delta; the blocked copy is not sent.
  expect(rec.adjust).toEqual([{ variantId: 7221, delta: 2 }]);
  expect(rec.imports).toEqual([]);
  // ... then the sheet closes on its own; only the written copies left the
  // batch (F1) -- the not-added SOR 35 copy is still there.
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator(".m-logbtn__n")).toHaveText("1");
  // The quantities refreshed: SOR 87 now reads 3 of 3 (at limit, red).
  await key(page, "Clear number");
  await typeNum(page, 87);
  await expect(page.locator(".m-readout")).toContainText("In vault 3/3 (at limit)");
});

test("s3-15-commit-mixed-batch-precon-import", async ({ page }) => {
  const rec = recorderFor(page);
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 1);
  // The Darth Vader starter deck, default "Don't add copies above my keep-limits".
  await page.locator(".m-pad__entry .m-padset").click();
  await page.locator('.m-setchooser[aria-controls="m-setchooser-precon"]').click();
  await page.locator('.m-d2-deck[data-deck="SOR-VADER"]').click();
  await page.locator(".m-d2-precon .swu-btn", { hasText: "Add deck to batch" }).click();
  await expect(page.locator(".m-logbtn__n")).toHaveText("53");
  await openVerify(page);
  const s = page.locator(".m-sheet-layer--verify");
  // Desktop's data-integrity section (deck copies the fixture catalogue does
  // not hold) sits ahead of the two standard sections.
  await expect(s.locator(".m-vsec")).toHaveCount(3);
  const order = await s
    .locator(".m-vsec")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section));
  expect(order).toEqual(["unresolved", "add", "skip"]);
  await expect(s.locator('.m-vsec[data-section="unresolved"] .m-vsec__title')).toHaveText(
    "Unresolved rows — this shouldn't happen with precon data"
  );
  const adds = await s.locator('.m-vsec[data-section="add"] .m-vfyrow').count();
  await s.locator(".m-d2-verify__commit").click();
  await expect(s.locator(".m-d2-verify__success")).toHaveText(`${adds} cards added.`);
  expect(rec.adjust).toEqual([{ variantId: 7221, delta: 1 }]);
  expect(rec.imports).toHaveLength(1);
  const imp = rec.imports[0];
  expect([imp.mode, imp.capHandling, imp.stage]).toEqual(["merge_add", "trim", "commit"]);
  expect(imp.file.format_version).toBe("swu-inv/1");
  expect(imp.file.cards.reduce((n, c) => n + c.quantity, 0)).toBe(adds - 1);
  expect(new Set(imp.file.cards.map((c) => c.swuapi_uuid)).size).toBe(imp.file.cards.length);
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0, { timeout: 3000 });
});

test("s3-15-commit-error-inline", async ({ page }) => {
  const rec = recorderFor(page);
  await page.route(
    (u) => /^\/api\/inventory\/\d+\/adjust$/.test(u.pathname),
    (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"boom"}' })
  );
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 1);
  await openVerify(page);
  const s = page.locator(".m-sheet-layer--verify");
  await s.locator(".m-d2-verify__commit").click();
  // The error stays inline in the sheet; the batch and the sheet stay.
  await expect(s.locator(".m-d2-verify__error")).toHaveText(
    "Something went wrong adding those cards. Try again."
  );
  await expect(s.locator('[role="alert"]')).toHaveCount(1);
  await expect(s.locator(".m-d2-verify__success")).toHaveCount(0);
  await expect(s.locator(".m-vfyrow")).toHaveCount(1);
  await expect(page.locator(".m-logbtn__n")).toHaveText("1");
  // The browser's own "Failed to load resource" line for the 500 is expected.
  rec.consoleErrors.splice(
    0,
    rec.consoleErrors.length,
    ...rec.consoleErrors.filter((m) => !/status of 500/.test(m))
  );
});

test("s3-15-commit-escape-locked-and-keeps-not-added", async ({ page }) => {
  // F1: while the commit is in flight Escape does not close the sheet, and
  // on success only the written copies leave the batch -- the not-added copy
  // stays for the user to act on.
  const rec = recorderFor(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((res) => (release = res));
  await page.route(
    (u) => /^\/api\/inventory\/\d+\/adjust$/.test(u.pathname),
    async (r) => {
      await gate;
      await r.fallback();
    }
  );
  await openPad(page, "#/pad?set=SOR");
  await addTimes(page, 87, 1);
  await addTimes(page, 35, 1); // owned 3 of 3: not added
  await openVerify(page);
  const s = page.locator(".m-sheet-layer--verify");
  await s.locator(".m-d2-verify__commit").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await expect(s).toBeVisible();
  release();
  await expect(s.locator(".m-d2-verify__success")).toHaveText("1 card added.");
  await expect(page.locator(".m-sheet-layer")).toHaveCount(0, { timeout: 3000 });
  expect(rec.adjust).toEqual([{ variantId: 7221, delta: 1 }]);
  // The not-added copy is still in the batch.
  await expect(page.locator(".m-logbtn__n")).toHaveText("1");
});
