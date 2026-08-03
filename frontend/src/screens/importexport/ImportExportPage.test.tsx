import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImportExportPage } from "./ImportExportPage";
import { ImportApiError } from "../../api/inventoryImportExport";
import type { ImportReport } from "../../api/inventoryImportExport";

// Only the network-calling functions are mocked -- ImportApiError itself is
// kept real (importOriginal) so its CODE_MESSAGES-driven .message and the
// `instanceof` checks in ImportExportPage's catch blocks both see the exact
// same class/messages production code does, the same "typed error class
// stays real" shape SettingsPage.test.tsx/deckCheck.test.ts use for their
// own API errors.
const { runImport, exportInventory, downloadCatalogReference, downloadBlob } = vi.hoisted(() => ({
  runImport: vi.fn(),
  exportInventory: vi.fn(),
  downloadCatalogReference: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock("../../api/inventoryImportExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/inventoryImportExport")>();
  return { ...actual, runImport, exportInventory, downloadCatalogReference, downloadBlob };
});

function makeFile(name = "cards.csv"): File {
  return new File(["swuapi_uuid,set_code,card_number,variant_type,quantity\n"], name, {
    type: "text/csv",
  });
}

function baseReport(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    stage: "dry_run",
    mode: "merge_add",
    cap_handling: "add_above",
    committed: false,
    totals: {
      rows: 1,
      resolved: 1,
      matched_by_fallback: 0,
      unresolved: 0,
      ambiguous: 0,
      trimmed: 0,
      ceiling_clamped: 0,
      duplicate_rows_merged: 0,
      unrecognized_columns: [],
      removed_by_replace_all: 0,
    },
    rows: [
      {
        row_number: 1,
        status: "resolved",
        card: { set_code: "SOR", card_number: "1", variant_type: "Standard", name: "Card One" },
        file_quantity: 1,
        current_quantity: 0,
        resulting_quantity: 1,
      },
    ],
    removed: [],
    ...overrides,
  };
}

async function renderPage(onBackToVault: () => void = vi.fn(), onImported?: () => Promise<void>) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<ImportExportPage onBackToVault={onBackToVault} onImported={onImported} />);
  });
  return utils;
}

/** BL-196: a controllable promise for tests that need to observe the busy
 * overlay WHILE a call is still in flight (rather than mocking a value that
 * resolves before the test can ever see the pending state). */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function selectFile(): Promise<File> {
  const input = screen.getByLabelText(/file \(\.json, \.csv, or \.xlsx\)/i) as HTMLInputElement;
  const file = makeFile();
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  return file;
}

async function clickPreview() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /preview import/i }));
  });
}

// Owner review 2026-08-03: merge mode + keep-limits rule are forced choices
// (no defaults) -- every preview flow must pick both first, exactly like a
// real user now has to.
async function selectModeAndCap(
  modeName: RegExp = /merge \(add\)/i,
  capName: RegExp = /add everything, even above my keep-limits/i
) {
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: modeName }));
    fireEvent.click(screen.getByRole("radio", { name: capName }));
  });
}

describe("ImportExportPage export section (BL-54 S3, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads JSON via exportInventory + downloadBlob", async () => {
    exportInventory.mockResolvedValue({
      blob: new Blob(["{}"], { type: "application/json" }),
      filename: "hyperspacevault-inventory_2026-07-22.json",
    });
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    });

    expect(exportInventory).toHaveBeenCalledWith("json");
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadBlob.mock.calls[0][1]).toBe("hyperspacevault-inventory_2026-07-22.json");
  });

  it("downloads CSV via exportInventory + downloadBlob", async () => {
    exportInventory.mockResolvedValue({
      blob: new Blob(["a,b"], { type: "text/csv" }),
      filename: "hyperspacevault-inventory_2026-07-22.csv",
    });
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    });

    expect(exportInventory).toHaveBeenCalledWith("csv");
  });

  it("shows an inline error when the export download fails", async () => {
    exportInventory.mockRejectedValue(new ImportApiError("email_not_verified", 403));
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/verify your email/i);
  });

  // BL-196 (owner scope addition): the two export downloads + the catalog
  // reference download give zero feedback while the server generates the
  // file -- a button-level busy state (label swap, matching the
  // Preview/Confirm buttons' own "Previewing…"/"Importing…" idiom), NOT the
  // full-screen BusyOverlay (nothing is being applied here).
  it("shows 'Preparing…' on the JSON button while its download is in flight, restored on resolve", async () => {
    const { promise, resolve } = deferred<{ blob: Blob; filename: string }>();
    exportInventory.mockReturnValue(promise);
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preparing…" })).toBeInTheDocument()
    );
    // Sibling buttons are untouched -- this is per-button state, not a
    // page-wide lock.
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeInTheDocument();

    await act(async () => resolve({ blob: new Blob(["{}"]), filename: "x.json" }));

    expect(screen.getByRole("button", { name: "Download JSON" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preparing…" })).not.toBeInTheDocument();
  });

  it("shows 'Preparing…' on the CSV button while its download is in flight, restored on reject", async () => {
    const { promise, reject } = deferred<{ blob: Blob; filename: string }>();
    exportInventory.mockImplementation((format: string) =>
      format === "csv" ? promise : Promise.resolve({ blob: new Blob(["x"]), filename: "x" })
    );
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preparing…" })).toBeInTheDocument()
    );

    await act(async () => reject(new ImportApiError("unknown", 500)));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download CSV" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Preparing…" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

// DISPOSITION (owner dev-review 2026-07-23, REPLACE): the catalog reference
// was its own section with a text-link trigger; it now lives inside the
// Import section's top-right callout behind an SWUButton ("Download catalog
// (CSV)"). The download-wiring assertion survives; the standalone-section
// shape it asserted is designed away.
describe("ImportExportPage catalog reference (inside Import section)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads the catalog reference via downloadCatalogReference + downloadBlob", async () => {
    downloadCatalogReference.mockResolvedValue({
      blob: new Blob(["x"], { type: "text/csv" }),
      filename: "hyperspacevault-catalog-reference_2026-07-22.csv",
    });
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download catalog \(csv\)/i }));
    });

    expect(downloadCatalogReference).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringContaining("catalog-reference")
    );
  });

  it("renders the catalog reference callout inside the Import section", async () => {
    await renderPage();
    const callout = screen.getByText("Catalog reference").closest(".ie-reference");
    expect(callout).not.toBeNull();
    const section = callout!.closest(".ie-section");
    expect(section).toContainElement(screen.getByRole("heading", { name: "Import" }));
  });

  it("shows a reference download error inside the callout, not the Export section", async () => {
    downloadCatalogReference.mockRejectedValue(new ImportApiError("email_not_verified", 403));
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download catalog \(csv\)/i }));
    });

    const alert = screen.getByRole("alert");
    expect(alert.closest(".ie-reference")).not.toBeNull();
  });

  // BL-196 (owner scope addition): button-level busy state, same idiom as
  // the export section's own JSON/CSV buttons.
  it("shows 'Preparing…' on the catalog-reference button while its download is in flight", async () => {
    const { promise, resolve } = deferred<{ blob: Blob; filename: string }>();
    downloadCatalogReference.mockReturnValue(promise);
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /download catalog \(csv\)/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preparing…" })).toBeInTheDocument()
    );

    await act(async () => resolve({ blob: new Blob(["x"]), filename: "ref.csv" }));

    expect(screen.getByRole("button", { name: /download catalog \(csv\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preparing…" })).not.toBeInTheDocument();
  });

  // CREATE (BL-173 review round 4, owner): the Import section states the
  // expected format up front and points other-tracker users at the catalog
  // CSV + AI-conversion migration path.
  // REPLACE (BL-185/BL-186 follow-up, owner 2026-08-03): the notes now lead
  // with the native SWUDB / SW-Unlimited-DB acceptance; the AI-conversion
  // path survives as the everything-else fallback.
  it("renders the two format notes (native-format acceptance + migration tip) at the configure step", async () => {
    await renderPage();
    const formatNote = screen.getByText(/HyperspaceVault format/i).closest(".ie-format-note");
    expect(formatNote).not.toBeNull();
    expect(formatNote!.textContent).toMatch(/SW-Unlimited-DB/i);
    expect(formatNote!.textContent).toMatch(/accepted natively/i);

    const migrationNote = screen
      .getByText(/coming from another tracker/i)
      .closest(".ie-format-note");
    expect(migrationNote).not.toBeNull();
    expect(migrationNote).not.toBe(formatNote);
    expect(migrationNote!.textContent).toMatch(/upload your export file as-is/i);
    expect(migrationNote!.textContent).toMatch(/favorite AI tool/i);
    expect(migrationNote!.textContent).toMatch(/catalog CSV/i);
  });
});

// Owner dev-review 2026-07-23 (CREATE): configure-step chrome — the header
// tab already names the view (no in-pane h1), and the native file input is
// hidden behind an SWUButton that forwards its click.
describe("ImportExportPage chrome (dev-review polish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders no in-pane 'Import / Export' heading", async () => {
    await renderPage();
    expect(screen.queryByRole("heading", { name: /import \/ export/i })).not.toBeInTheDocument();
  });

  it("forwards the Choose file button's click to the hidden native input", async () => {
    await renderPage();
    const input = screen.getByLabelText(/file \(\.json, \.csv, or \.xlsx\)/i) as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(screen.getByRole("button", { name: "Choose file" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("echoes the chosen file's name next to the Choose file button", async () => {
    await renderPage();
    expect(screen.getByText("No file chosen")).toBeInTheDocument();

    await selectFile();

    expect(screen.getByText("cards.csv")).toBeInTheDocument();
    expect(screen.queryByText("No file chosen")).not.toBeInTheDocument();
  });
});

describe("ImportExportPage import stepper (BL-54 S3, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // REPLACE (owner review 2026-08-03): Preview is now gated on file AND both
  // forced choices -- the old test only knew about the file gate.
  it("disables Preview import until a file is chosen AND both choices are made", async () => {
    await renderPage();
    const previewBtn = screen.getByRole("button", { name: /preview import/i });
    expect(previewBtn.getAttribute("aria-disabled")).toBe("true");

    await selectFile();
    expect(previewBtn.getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /merge \(add\)/i }));
    });
    expect(previewBtn.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(previewBtn);
    expect(runImport).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("radio", { name: /add everything, even above my keep-limits/i })
      );
    });
    // SWUButton omits aria-disabled entirely when enabled.
    expect(previewBtn.getAttribute("aria-disabled")).not.toBe("true");
  });

  // REPLACE (owner review 2026-08-03): merge_add/add_above are no longer
  // DEFAULTS -- they're the explicit picks this flow now makes; the radios
  // start unselected.
  it("starts with no mode/cap selected and calls runImport with the user's explicit picks", async () => {
    runImport.mockResolvedValue(baseReport());
    await renderPage();
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLInputElement).checked).toBe(false);
    }
    const file = await selectFile();
    await selectModeAndCap();
    await clickPreview();

    expect(runImport).toHaveBeenCalledWith(file, "merge_add", "add_above", "dry_run");
    expect(screen.getByText("Card One", { exact: false })).toBeInTheDocument();
  });

  it("shows total cards (summed file quantities) alongside the row count", async () => {
    runImport.mockResolvedValue(
      baseReport({
        totals: { ...baseReport().totals, rows: 2, resolved: 2 },
        rows: [
          {
            row_number: 1,
            status: "resolved",
            card: { set_code: "SOR", card_number: "1", variant_type: "Standard" },
            file_quantity: 3,
            current_quantity: 0,
            resulting_quantity: 3,
          },
          {
            row_number: 2,
            status: "resolved",
            card: { set_code: "SOR", card_number: "2", variant_type: "Standard" },
            file_quantity: 2,
            current_quantity: 0,
            resulting_quantity: 2,
          },
        ],
      })
    );
    await renderPage();
    await selectFile();
    await selectModeAndCap();
    await clickPreview();

    const cardsCell = screen.getByText("Cards").closest(".ie-totals__cell")!;
    expect(cardsCell).toHaveTextContent("5");
  });

  it("renders problem rows before trimmed rows before the collapsed resolved remainder (problem-rows-first)", async () => {
    runImport.mockResolvedValue(
      baseReport({
        totals: {
          rows: 3,
          resolved: 2,
          matched_by_fallback: 0,
          unresolved: 1,
          ambiguous: 0,
          trimmed: 1,
          ceiling_clamped: 0,
          duplicate_rows_merged: 0,
          unrecognized_columns: [],
          removed_by_replace_all: 0,
        },
        rows: [
          {
            row_number: 1,
            status: "unresolved",
            reason: "unknown_triple",
            card: { set_code: "SOR", card_number: "99", variant_type: "Standard" },
            file_quantity: 1,
          },
          {
            row_number: 2,
            status: "resolved",
            card: { set_code: "SOR", card_number: "1", variant_type: "Standard" },
            file_quantity: 5,
            current_quantity: 0,
            resulting_quantity: 3,
            copies_not_added: 2,
            trim_reason: "keep_limit",
          },
          {
            row_number: 3,
            status: "resolved",
            card: { set_code: "SOR", card_number: "2", variant_type: "Standard" },
            file_quantity: 1,
            current_quantity: 0,
            resulting_quantity: 1,
          },
        ],
      })
    );
    await renderPage();
    await selectFile();
    await selectModeAndCap();
    await clickPreview();

    const text = document.body.textContent ?? "";
    const problemIdx = text.indexOf("Problem rows");
    const trimmedIdx = text.indexOf("Trimmed / clamped rows");
    const resolvedIdx = text.indexOf("more resolved row");
    expect(problemIdx).toBeGreaterThan(-1);
    expect(trimmedIdx).toBeGreaterThan(problemIdx);
    expect(resolvedIdx).toBeGreaterThan(trimmedIdx);
  });

  it("disables Confirm import when the report has 0 resolved rows", async () => {
    runImport.mockResolvedValue(
      baseReport({
        totals: {
          rows: 1,
          resolved: 0,
          matched_by_fallback: 0,
          unresolved: 1,
          ambiguous: 0,
          trimmed: 0,
          ceiling_clamped: 0,
          duplicate_rows_merged: 0,
          unrecognized_columns: [],
          removed_by_replace_all: 0,
        },
        rows: [
          {
            row_number: 1,
            status: "unresolved",
            reason: "malformed_row",
            card: {},
          },
        ],
      })
    );
    await renderPage();
    await selectFile();
    await selectModeAndCap();
    await clickPreview();

    const confirmBtn = screen.getByRole("button", { name: /confirm import/i });
    expect(confirmBtn.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(confirmBtn);
    expect(runImport).toHaveBeenCalledTimes(1); // only the dry_run call -- no commit fired
  });

  it("gates Confirm behind the explicit checkbox for replace_all, naming the removal count", async () => {
    runImport.mockResolvedValue(
      baseReport({
        mode: "replace_all",
        totals: {
          rows: 1,
          resolved: 1,
          matched_by_fallback: 0,
          unresolved: 0,
          ambiguous: 0,
          trimmed: 0,
          ceiling_clamped: 0,
          duplicate_rows_merged: 0,
          unrecognized_columns: [],
          removed_by_replace_all: 2,
        },
        removed: [
          { card: { set_code: "SHD", card_number: "9", variant_type: "Standard" }, quantity: 3 },
          { card: { set_code: "SHD", card_number: "10", variant_type: "Standard" }, quantity: 1 },
        ],
      })
    );
    await renderPage();
    await selectFile();

    await selectModeAndCap(/replace all/i);
    await clickPreview();

    expect(runImport).toHaveBeenCalledWith(expect.any(File), "replace_all", "add_above", "dry_run");
    expect(screen.getByText(/permanently remove 2 cards/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /confirm import/i });
    expect(confirmBtn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirmBtn);
    expect(runImport).toHaveBeenCalledTimes(1); // still just the dry_run -- commit blocked

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirmBtn.getAttribute("aria-disabled")).toBeNull();
  });

  it("commits on Confirm and shows the success state with the final report summary", async () => {
    const dryRun = baseReport();
    const committed = baseReport({ stage: "commit", committed: true });
    runImport.mockResolvedValueOnce(dryRun).mockResolvedValueOnce(committed);
    const onBackToVault = vi.fn();
    await renderPage(onBackToVault);
    const file = await selectFile();
    await selectModeAndCap();
    await clickPreview();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));
    });

    expect(runImport).toHaveBeenNthCalledWith(2, file, "merge_add", "add_above", "commit");
    expect(screen.getByRole("status")).toHaveTextContent(/import complete/i);
    expect(screen.getByText(/1 row written/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to vault/i }));
    expect(onBackToVault).toHaveBeenCalledTimes(1);
  });

  it("renders a 422 full-file failure as an inline error, not a report", async () => {
    runImport.mockRejectedValue(new ImportApiError("unparseable_file", 422));
    await renderPage();
    await selectFile();
    await selectModeAndCap();
    await clickPreview();

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't read that file/i);
    expect(screen.queryByText("Card One", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
  });

  it("renders a 422 failure on commit as an inline error too", async () => {
    runImport
      .mockResolvedValueOnce(baseReport())
      .mockRejectedValueOnce(new ImportApiError("too_many_rows", 422));
    await renderPage();
    await selectFile();
    await selectModeAndCap();
    await clickPreview();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/more than 20,000 rows/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// DISPOSITION (BL-196, CREATE): net-new coverage -- the busy overlay wraps
// both runImport stages (dry_run/commit) plus, on commit, a hold through
// `onImported` before dismissing. deferred() lets each test observe the
// overlay's staged message WHILE the underlying call is still pending,
// rather than mocking a value that resolves before the assertion runs.
describe("ImportExportPage busy overlay (BL-196)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Checking your file…' while dry_run is in flight, hides once it resolves", async () => {
    const { promise, resolve } = deferred<ImportReport>();
    runImport.mockReturnValue(promise);
    await renderPage();
    await selectFile();
    await selectModeAndCap();

    fireEvent.click(screen.getByRole("button", { name: /preview import/i }));

    await waitFor(() => expect(screen.getByText("Checking your file…")).toBeInTheDocument());
    // No "Applying"/"Refreshing" staging on the read-only preview path.
    expect(screen.queryByText(/refreshing your vault/i)).not.toBeInTheDocument();

    await act(async () => resolve(baseReport()));

    await waitFor(() => expect(screen.queryByText("Checking your file…")).not.toBeInTheDocument());
    expect(screen.getByText("Card One", { exact: false })).toBeInTheDocument();
  });

  it("surfaces the dry_run error inline and hides the overlay without staging a report", async () => {
    const { promise, reject } = deferred<ImportReport>();
    runImport.mockReturnValue(promise);
    await renderPage();
    await selectFile();
    await selectModeAndCap();

    fireEvent.click(screen.getByRole("button", { name: /preview import/i }));
    await waitFor(() => expect(screen.getByText("Checking your file…")).toBeInTheDocument());

    await act(async () => reject(new ImportApiError("unparseable_file", 422)));

    await waitFor(() => expect(screen.queryByText("Checking your file…")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't read that file/i);
  });

  it("stages 'Applying N cards…' then 'Refreshing your Vault…' on commit, holding until onImported settles", async () => {
    runImport.mockResolvedValueOnce(baseReport()); // the dry_run behind Preview
    const { promise: commitPromise, resolve: resolveCommit } = deferred<ImportReport>();
    const { promise: importedPromise, resolve: resolveImported } = deferred<void>();
    const onImported = vi.fn(() => importedPromise);
    await renderPage(vi.fn(), onImported);
    await selectFile();
    await selectModeAndCap();
    await clickPreview();

    runImport.mockReturnValueOnce(commitPromise);
    fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));

    // baseReport()'s one row carries file_quantity: 1 -- same totalCards
    // figure the preview screen's own "Cards" total cell shows.
    await waitFor(() => expect(screen.getByText(/applying 1 card…/i)).toBeInTheDocument());

    await act(async () => resolveCommit(baseReport({ stage: "commit", committed: true })));

    await waitFor(() => expect(screen.getByText("Refreshing your Vault…")).toBeInTheDocument());
    expect(onImported).toHaveBeenCalledTimes(1);
    // Still covered by the overlay -- the success screen hasn't rendered.
    expect(screen.queryByText(/import complete/i)).not.toBeInTheDocument();

    await act(async () => resolveImported());

    await waitFor(() =>
      expect(screen.queryByText("Refreshing your Vault…")).not.toBeInTheDocument()
    );
    expect(screen.getByText(/import complete/i)).toBeInTheDocument();
  });

  // RETIRE (owner pick, 2026-08-03): the DEV-only "Preview overlay" button
  // was variant-pick scaffolding, stripped with the switcher when the owner
  // locked the orbit animation -- the behavior it pinned no longer exists.
});

describe("ImportExportPage reject-CSV download (BL-54 S3, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a client-side CSV containing exactly the problem rows, not the resolved ones", async () => {
    runImport.mockResolvedValue(
      baseReport({
        totals: {
          rows: 3,
          resolved: 1,
          matched_by_fallback: 0,
          unresolved: 1,
          ambiguous: 1,
          trimmed: 0,
          ceiling_clamped: 0,
          duplicate_rows_merged: 0,
          unrecognized_columns: [],
          removed_by_replace_all: 0,
        },
        rows: [
          {
            row_number: 1,
            status: "unresolved",
            reason: "unknown_triple",
            card: { set_code: "SOR", card_number: "99", variant_type: "Standard" },
            file_quantity: 2,
          },
          {
            row_number: 2,
            status: "ambiguous",
            reason: "ambiguous_triple",
            candidates: ["uuid-a", "uuid-b"],
            card: { set_code: "SEC", card_number: "1127", variant_type: "Serialized Prestige" },
            file_quantity: 1,
          },
          {
            row_number: 3,
            status: "resolved",
            card: { set_code: "SOR", card_number: "1", variant_type: "Standard" },
            file_quantity: 1,
            current_quantity: 0,
            resulting_quantity: 1,
          },
        ],
      })
    );
    await renderPage();
    await selectFile();
    await selectModeAndCap();
    await clickPreview();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download problem rows/i }));
    });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = downloadBlob.mock.calls[0];
    expect(filename).toBe("hyperspacevault-import-problem-rows.csv");
    const csv = await (blob as Blob).text();
    const lines = csv.trim().split("\r\n");
    // header + exactly the 2 problem rows -- the 1 resolved row is excluded.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("row_number");
    expect(csv).toContain("unknown_triple");
    expect(csv).toContain("ambiguous_triple");
    expect(csv).toContain("uuid-a|uuid-b");
    // Row 3 (the resolved row) never appears in the reject CSV.
    expect(csv).not.toContain('"3","resolved"');
  });
});
