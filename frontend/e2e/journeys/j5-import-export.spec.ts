import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importReplaceAll,
  isPhone,
  journeyTest,
  openImportExport,
  openVault,
  runRestore,
  ownedTotal,
  seedSummaryTotals,
  signedInVault,
} from "./_helpers";

// Desktop-1440 only (@desktop-only; phone-390 skips cleanly). The import
// endpoint allows 30 calls per tenant per hour; J5 costs 4 imports per layout
// (preview + commit, twice) and the seed 1, so both layouts = 9 per gate run
// and a fourth promote in an hour would fail; desktop-only = 5 per run, six
// gate runs per hour. The phone import flow stays covered by the item-level
// s4 specs against the mock.
//
// BL-279 WS-3 W3-09, journey J5: a replace-all import of import-j5.csv (six
// Standard SOR cards, disjoint from the seed) through the import screen shows
// in the vault with the file's totals, and the CSV export holds the file's
// rows. Then the journey re-imports seed-a.csv with replace-all through the
// same screen and checks the seeded totals are back: with one worker the later
// journeys, and the second layout, run on the same tenant, so every journey
// leaves tenant A as it found it. (The import endpoint allows 30 calls an hour
// per tenant; a preview and a commit are two, so this journey spends four.)
const FILE = "e2e/journeys/import-j5.csv";
const SEED = "e2e/journeys/seed-a.csv";

type Row = { key: string; qty: number };

/** The rows of an inventory CSV that hold copies, keyed by set|number|variant.
 * Comment lines are skipped; rows at quantity 0 (a stepped-to-zero card keeps
 * its row) are not owned. Reads columns by header name. */
function ownedRows(csv: string): Row[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const head = lines[0].split(",");
  const at = (n: string) => head.indexOf(n);
  return lines
    .slice(1)
    .map((l) => l.split(","))
    .map((c) => ({
      key: `${c[at("set_code")]}|${c[at("card_number")]}|${c[at("variant_type")]}`,
      qty: Number(c[at("quantity")]),
    }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function backToVault(page: Page, info: Parameters<typeof openVault>[1]) {
  await page.getByRole("button", { name: "Back to Vault" }).click();
  await openVault(page, info);
}

journeyTest.describe.configure({ mode: "serial" });

journeyTest(
  "j5 @no-engines @desktop-only an import with replace-all shows in the vault and the export equals the file",
  async ({ page }, info) => {
    journeyTest.skip(isPhone(info), "J5 runs on desktop-1440 only (import rate budget)");
    const want = ownedRows(readFileSync(FILE, "utf8"));
    const copies = want.reduce((n, r) => n + r.qty, 0);
    const seeded = seedSummaryTotals();
    expect(want).toHaveLength(6);

    await signedInVault(page, info);
    await openImportExport(page, info);
    let failure: unknown;
    try {
      const line = await importReplaceAll(page, FILE);
      expect(line).toMatch(new RegExp(`\\b${want.length} rows written`));

      // The vault now shows the file's totals.
      await backToVault(page, info);
      await expect(ownedTotal(page, info)).toHaveText(String(copies), { timeout: 20_000 });

      // The export equals the file, rows in any order.
      await openImportExport(page, info);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download CSV" }).click(),
      ]);
      const exported = await (async () => {
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        return Buffer.concat(chunks).toString("utf8");
      })();
      expect(ownedRows(exported)).toEqual(want);
    } catch (err) {
      failure = err;
      throw err;
    } finally {
      // Restore tenant A through the same screen, whatever happened above.
      await runRestore(failure, async () => {
        await page.goto(info.project.name.startsWith("phone") ? "/#/vault" : "/");
        await openVault(page, info);
        await openImportExport(page, info);
        const restored = await importReplaceAll(page, SEED);
        expect(restored).toMatch(new RegExp(`\\b${seeded.variants} rows written`));
        await backToVault(page, info);
        await expect(ownedTotal(page, info)).toHaveText(String(seeded.copies), { timeout: 20_000 });
      });
    }
  }
);
