import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import {
  NO_SESSION,
  configureImport,
  ensureVerifiedUser,
  importFile,
  openImportExport,
  transitionsDone,
  signInVerified,
} from "./more-helpers";

// S4-10: the Import configure step -- desktop ImportExportPage's form top to
// bottom, copy verbatim, as one phone column (rev4 r4-9-layout-sections,
// r4-9-targets-44, r4-9-no-overflow; m-rev4-d.css 179-237).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone Import & Export");
});
test.use({ storageState: NO_SESSION });

test.beforeEach(async ({ page, request }) => {
  await ensureVerifiedUser(request);
  await signInVerified(page);
  await openImportExport(page);
});

test("s4-10-configure-layout", async ({ page }) => {
  const imp = page.locator('[data-section="import"]');
  await expect(imp.locator(".ie-section__title")).toHaveText("Import");
  await expect(imp.locator(".ie-section__blurb")).toHaveText(
    "Preview changes before anything is written — nothing commits until you confirm."
  );
  const notes = imp.locator(".ie-format-note");
  await expect(notes.nth(0)).toHaveText(
    "Imports use the [HSV] HyperspaceVault format — the files Export produces, or the catalog reference sheet with your quantities filled in. SWUDB and SW-Unlimited-DB exports are also accepted natively."
  );
  await expect(notes.nth(1)).toHaveText(
    "Coming from another tracker? If it's SWUDB or SW-Unlimited-DB, just upload your export file as-is — it's recognized automatically. From anywhere else, download the catalog CSV and ask your favorite AI tool to convert your existing inventory file into it."
  );
  await expect(imp.locator(".ie-field-label").first()).toHaveText("File (.json, .csv, or .xlsx)");
  await expect(imp.locator(".ie-file-name")).toHaveText("No file chosen");
  await expect(imp.locator(".swu-btn", { hasText: "Choose import file" })).toBeVisible();

  const mode = imp.locator('[role=radiogroup][aria-label="Merge mode"]');
  await expect(mode.locator(".ie-field-label")).toHaveText("Merge mode");
  await expect(mode.locator(".ie-radio-option__title")).toHaveText([
    "Merge (add)",
    "Replace",
    "Replace All (destructive)",
  ]);
  await expect(mode.locator(".ie-radio-option__desc")).toHaveText([
    "Adds the file's quantities on top of what you already own.",
    "The file's quantity wins for every row it lists; rows it doesn't mention are untouched.",
    "Wipes your entire Vault and loads exactly what's in the file.",
  ]);
  const cap = imp.locator('[role=radiogroup][aria-label="Cap handling"]');
  await expect(cap.locator(".ie-field-label")).toHaveText("Keep-limits");
  await expect(cap.locator(".ie-radio-option__title")).toHaveText([
    "Add everything, even above my keep-limits",
    "Trim to my keep-limits",
  ]);
  await expect(imp.locator(".swu-btn", { hasText: "Preview import" })).toBeVisible();

  // Both groups start unpicked (desktop: no defaults).
  for (const r of await page.locator("[role=radio]").all())
    await expect(r).toHaveAttribute("aria-checked", "false");

  const geo = await page.evaluate(() => {
    const q = (s: string) => document.querySelector<HTMLElement>(s)!;
    const rect = (e: Element) => e.getBoundingClientRect();
    const radios = [...document.querySelectorAll<HTMLElement>(".m-ie [role=radio]")];
    const danger = q(".ie-radio-option__title--danger");
    const note = (n: number) => getComputedStyle(document.querySelectorAll(".ie-format-note")[n]);
    const input = q("#ie-file-input");
    return {
      // One column: every radio spans the same width.
      widths: radios.map((r) => Math.round(rect(r).width)),
      lefts: radios.map((r) => Math.round(rect(r).left)),
      heights: radios.map((r) => Math.round(rect(r).height)),
      dot: radios.map((r) => {
        const d = r.querySelector(".m-ie-radio__dot")!.getBoundingClientRect();
        return [Math.round(d.width), Math.round(d.height)];
      }),
      dangerColor: getComputedStyle(danger).color,
      blue: note(0).borderLeftColor,
      amber: note(1).borderLeftColor,
      inputType: (input as HTMLInputElement).type,
      accept: (input as HTMLInputElement).accept,
      inputFont: getComputedStyle(input).fontSize,
      // top-to-bottom order of the form's landmarks
      order: [
        "#ie-import-title",
        ".ie-format-note",
        "#ie-file-input",
        '[aria-label="Merge mode"]',
        '[aria-label="Cap handling"]',
      ].map((s) => {
        const els = [...document.querySelectorAll(s)];
        return rect(els[0]).top;
      }),
    };
  });
  expect(new Set(geo.widths).size, "one column: equal radio widths").toBe(1);
  expect(new Set(geo.lefts).size).toBe(1);
  geo.heights.forEach((h) => expect(h).toBeGreaterThanOrEqual(48));
  geo.dot.forEach((d) => expect(d).toEqual([16, 16]));
  // Replace All in red (desktop --color-danger); the two notes blue / amber.
  expect(geo.dangerColor).toBe("rgb(248, 113, 113)");
  expect(geo.blue).toBe("rgb(37, 99, 235)");
  expect(geo.amber).toBe("rgb(217, 154, 31)");
  expect([geo.inputType, geo.accept, geo.inputFont]).toEqual(["file", ".json,.csv,.xlsx", "16px"]);
  expect([...geo.order].sort((a, b) => a - b)).toEqual(geo.order);

  // Picking a radio draws its dot; the destructive one outlines in red.
  const replaceAll = page.locator('[role=radio][data-group="mode"]').nth(2);
  await replaceAll.click();
  await expect(replaceAll).toHaveAttribute("aria-checked", "true");
  await transitionsDone(page); // the 0.15 s border-colour transition
  const border = await replaceAll.evaluate((e) => getComputedStyle(e).borderTopColor);
  expect(border).toBe("rgb(248, 113, 113)");
  await page.locator('[role=radio][data-group="mode"]').nth(0).click();
  await expect(replaceAll).toHaveAttribute("aria-checked", "false");
  await transitionsDone(page);
  expect(
    await page
      .locator('[role=radio][data-group="mode"]')
      .nth(0)
      .evaluate((e) => getComputedStyle(e).borderTopColor)
  ).toBe("rgb(37, 99, 235)");
  // Choosing a file echoes its name.
  await page.locator("#ie-file-input").setInputFiles(importFile("my-vault.json"));
  await expect(page.locator(".ie-file-name")).toHaveText("my-vault.json");
});

test("s4-10-targets-44", async ({ page }) => {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".m-ie button, .m-ie input, .m-ie [role=radio], .m-ie .swu-btn"
      ),
    ]
      .filter((e) => !e.closest("[inert]"))
      .map((e) => {
        const b = e.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), t: e.textContent?.slice(0, 20) };
      })
      .filter((b) => b.w < 44 || b.h < 44)
  );
  expect(small).toEqual([]);
  // The visible picker button is 44 px tall; the real input lies over it.
  const pick = await page.evaluate(() => {
    const btn = document.querySelector(".m-ie__pick .swu-btn")!.getBoundingClientRect();
    const inp = document.querySelector("#ie-file-input")!.getBoundingClientRect();
    return {
      bh: Math.round(btn.height),
      ih: Math.round(inp.height),
      same: inp.width >= btn.width - 1,
    };
  });
  expect(pick.bh).toBeGreaterThanOrEqual(44);
  expect(pick.ih).toBeGreaterThanOrEqual(44);
  expect(pick.same).toBe(true);
});

test("s4-10-no-overflow", async ({ page }) => {
  const check = () =>
    page.evaluate(() => {
      const s = document.querySelector<HTMLElement>(".m-ie")!;
      return {
        doc: document.documentElement.scrollWidth <= innerWidth,
        screen: s.scrollWidth <= s.clientWidth,
      };
    });
  expect(await check()).toEqual({ doc: true, screen: true });
  // ... also with a long file name and the destructive option picked.
  await page
    .locator("#ie-file-input")
    .setInputFiles(importFile("a-really-long-collection-export-file-name-for-the-vault-2026.json"));
  await page.locator('[role=radio][data-group="mode"]').nth(2).click();
  expect(await check()).toEqual({ doc: true, screen: true });
});

test("s4-10-preview-locked-until-complete", async ({ page }) => {
  const rec = recorderFor(page);
  const preview = page.locator(".swu-btn", { hasText: "Preview import" });
  const locked = async () => expect(preview).toHaveAttribute("aria-disabled", "true");
  await locked();
  await preview.click({ force: true }); // aria-disabled stays tappable
  expect(rec.imports).toEqual([]);
  await page.locator("#ie-file-input").setInputFiles(importFile());
  await locked();
  await page.locator('[role=radio][data-group="mode"]').nth(0).click();
  await locked();
  await page.locator('[role=radio][data-group="cap"]').nth(1).click();
  await expect(preview).not.toHaveAttribute("aria-disabled", "true");
  // Unlocked for any pairing; configureImport sets the same three picks.
  await configureImport(page, "Replace", "Add everything");
  await expect(preview).not.toHaveAttribute("aria-disabled", "true");
});
