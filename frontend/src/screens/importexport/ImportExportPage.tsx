import { useRef, useState } from "react";
import {
  downloadBlob,
  downloadCatalogReference,
  exportInventory,
  ImportApiError,
  runImport,
} from "../../api/inventoryImportExport";
import type {
  CapHandling,
  ImportMode,
  ImportReport,
  ImportRowReport,
} from "../../api/inventoryImportExport";
import { SWUButton } from "../../components/SWUButton";
import { BusyOverlay } from "../../components/BusyOverlay";
import { useBusyOverlay } from "../../hooks/useBusyOverlay";
import { ImportPreviewReport, totalCardsFromReport } from "./ImportPreviewReport";
import "./ImportExportPage.css";

interface Props {
  /** BL-54 S3 (§8.2e): the success state's "back to Vault" link, and the
   * only way this pane can be left besides Header's Vault tab (App owns
   * activeView, same App-owns-the-pane-switch pattern SettingsPage's
   * onNavigateCards wiring already uses via Header). */
  onBackToVault: () => void;
  /** BL-196: the Vault's (CardsPage's) own quantities refetch, threaded down
   * through App.tsx via a ref-registration (CardsPage stays mounted the
   * whole time -- see App.tsx's onQuantitiesRefreshReady -- so it never
   * re-fetched on an import commit before this existed). The commit-stage
   * busy overlay awaits it during its "Refreshing your Vault…" stage before
   * dismissing. Optional so this pane still renders standalone (e.g. tests
   * that don't wire App.tsx) -- omitting it just skips the refresh await. */
  onImported?: () => Promise<void>;
}

/** BL-196: the three server-generated downloads (export JSON/CSV, catalog
 * reference) give zero feedback while the file is generated server-side --
 * a per-button busy state (not the full-screen BusyOverlay: nothing is
 * being APPLIED here, a blocking overlay would be the wrong weight for a
 * read-only download), same label-swap idiom the Preview/Confirm buttons
 * below already use ("Previewing…"/"Importing…"). Tracked as a Set (not
 * three separate booleans) since the three downloads are independent
 * network calls that can, in principle, overlap. */
type DownloadKind = "json" | "csv" | "reference";

type Step = "configure" | "preview" | "success";

const MODE_OPTIONS: {
  value: ImportMode;
  title: string;
  description: string;
  destructive?: boolean;
}[] = [
  {
    value: "merge_add",
    title: "Merge (add)",
    description: "Adds the file's quantities on top of what you already own.",
  },
  {
    value: "replace",
    title: "Replace",
    description:
      "The file's quantity wins for every row it lists; rows it doesn't mention are untouched.",
  },
  {
    value: "replace_all",
    title: "Replace All",
    description: "Wipes your entire Vault and loads exactly what's in the file.",
    destructive: true,
  },
];

const CAP_OPTIONS: { value: CapHandling; label: string }[] = [
  { value: "add_above", label: "Add everything, even above my keep-limits" },
  { value: "trim", label: "Trim to my keep-limits" },
];

/** §8.2c's "Download problem rows (CSV)" button -- built client-side from
 * whatever report is currently on screen (dry_run preview or a commit's
 * still-returned report), never a server round trip. Column set mirrors
 * §7.3's row shape closely enough that a fixed-up file could be re-imported
 * by hand. */
function problemRowsCsv(rows: ImportRowReport[]): string {
  const header = [
    "row_number",
    "status",
    "reason",
    "set_code",
    "card_number",
    "variant_type",
    "swuapi_uuid",
    "file_quantity",
    "candidates",
  ];
  const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.row_number,
      r.status,
      r.reason ?? "",
      r.card.set_code ?? "",
      r.card.card_number ?? "",
      r.card.variant_type ?? "",
      r.card.swuapi_uuid ?? "",
      r.file_quantity ?? "",
      (r.candidates ?? []).join("|"),
    ]
      .map(quote)
      .join(",")
  );
  return [header.map(quote).join(","), ...lines].join("\r\n");
}

/** BL-54 S3 -- Definition_ImportExport_2026-07-22.md §8.2's Import / Export
 * screen. App.tsx mounts this only for signed-in, verified users (§8.1 P9)
 * -- no anonymous/unverified gate lives in this component itself, unlike
 * DeckCheckPage's own in-place sign-in prompt. Three sections top to bottom:
 * export downloads, the catalog reference download, and the import stepper
 * (configure -> preview -> success), matching the Settings-pane visual
 * idiom (.screen/.screen-heading from cards.css, section chrome mirroring
 * SettingsPage.css's .settings-section vocabulary under ie- class names). */
export function ImportExportPage({ onBackToVault, onImported }: Props) {
  const [step, setStep] = useState<Step>("configure");
  const [file, setFile] = useState<File | null>(null);
  // Owner review 2026-08-03: NO defaults on merge mode or the keep-limits
  // rule -- both choices matter enough that the user must actively pick
  // each before Preview unlocks (null = not yet chosen; the radios render
  // unselected until then).
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [capHandling, setCapHandling] = useState<CapHandling | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [successReport, setSuccessReport] = useState<ImportReport | null>(null);
  const [replaceAllConfirmed, setReplaceAllConfirmed] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  // Owner dev-review 2026-07-23: the catalog-reference button lives inside
  // the Import section now, so a download error has to surface next to the
  // button that caused it -- `source` picks which section renders it.
  const [downloadError, setDownloadError] = useState<{
    source: "export" | "reference";
    message: string;
  } | null>(null);
  // BL-196: which download button(s) are currently in flight -- button-level
  // busy state (label swap), independent of the full-screen BusyOverlay.
  const [downloadingKinds, setDownloadingKinds] = useState<ReadonlySet<DownloadKind>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlay = useBusyOverlay();

  function handleFileChange(next: File | null) {
    setFile(next);
    // A new file invalidates any report built from the old one -- clearing
    // it here (rather than leaving a stale preview reachable) means Confirm
    // is never available without a preview against the currently-selected
    // file.
    setReport(null);
    setFileError(null);
  }

  async function handleDownload(kind: DownloadKind) {
    if (downloadingKinds.has(kind)) return;
    setDownloadError(null);
    setDownloadingKinds((prev) => new Set(prev).add(kind));
    try {
      const { blob, filename } =
        kind === "reference" ? await downloadCatalogReference() : await exportInventory(kind);
      downloadBlob(blob, filename);
    } catch (err) {
      setDownloadError({
        source: kind === "reference" ? "reference" : "export",
        message:
          err instanceof ImportApiError
            ? err.message
            : "Couldn't download that file. Please try again.",
      });
    } finally {
      setDownloadingKinds((prev) => {
        const next = new Set(prev);
        next.delete(kind);
        return next;
      });
    }
  }

  async function handlePreview() {
    if (!file || !mode || !capHandling || previewing) return;
    setPreviewing(true);
    setFileError(null);
    try {
      // BL-196: dry_run never mutates inventory, so there's no "Refreshing
      // your Vault…" stage here -- just the one message through to the
      // preview report's own render (the trailing double-rAF inside run()
      // still covers that render's paint before the overlay comes down).
      const result = await overlay.run(
        { message: "Checking your file…" },
        { task: () => runImport(file, mode, capHandling, "dry_run") }
      );
      setReport(result);
      setReplaceAllConfirmed(false);
      setStep("preview");
    } catch (err) {
      setFileError(
        err instanceof ImportApiError ? err.message : "Something went wrong reading that file."
      );
    } finally {
      setPreviewing(false);
    }
  }

  const confirmBlocked =
    !file ||
    !mode ||
    !capHandling ||
    !report ||
    committing ||
    report.totals.resolved === 0 ||
    (mode === "replace_all" && !replaceAllConfirmed);

  async function handleConfirm() {
    if (!file || !mode || !capHandling || confirmBlocked) return;
    setCommitting(true);
    setFileError(null);
    // BL-196: the dry_run report already sitting in state has the exact
    // "Cards" figure the preview screen shows -- same totalCardsFromReport
    // ImportPreviewReport itself renders from, so the overlay's count and
    // the report's own headline total never drift apart.
    const count = totalCardsFromReport(report);
    try {
      const result = await overlay.run(
        { message: `Applying ${count.toLocaleString()} ${count === 1 ? "card" : "cards"}…` },
        {
          task: () => runImport(file, mode, capHandling, "commit"),
          settleStage: { message: "Refreshing your Vault…" },
          // onImported/refreshQuantities already swallows its own errors
          // (App.tsx/CardsPage.tsx) -- nothing further to catch here.
          settle: async () => {
            await onImported?.();
          },
        }
      );
      setSuccessReport(result);
      setStep("success");
    } catch (err) {
      setFileError(
        err instanceof ImportApiError ? err.message : "Something went wrong committing that import."
      );
    } finally {
      setCommitting(false);
    }
  }

  function makeProblemRowsHandler(activeReport: ImportReport | null) {
    return () => {
      if (!activeReport) return;
      const problemRows = activeReport.rows.filter((r) => r.status !== "resolved");
      if (problemRows.length === 0) return;
      downloadBlob(
        new Blob([problemRowsCsv(problemRows)], { type: "text/csv" }),
        "hyperspacevault-import-problem-rows.csv"
      );
    };
  }

  function handleStartOver() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStep("configure");
    // The forced choices reset with the rest of the session -- a fresh
    // import means fresh, deliberate picks.
    setMode(null);
    setCapHandling(null);
    setReport(null);
    setSuccessReport(null);
    setReplaceAllConfirmed(false);
    setFileError(null);
  }

  const removalCount = report?.totals.removed_by_replace_all ?? 0;

  return (
    <div className="screen ie-screen">
      {/* Owner dev-review 2026-07-23: no in-pane "Import / Export" heading
       * -- the Header's active tab already names the view. */}

      <section className="ie-section" aria-labelledby="ie-export-title">
        <div className="ie-section__head">
          <h2 className="ie-section__title" id="ie-export-title">
            Export
          </h2>
          <p className="ie-section__blurb">Download your Vault in the canonical format.</p>
        </div>
        {downloadError?.source === "export" && (
          <p className="ie-error" role="alert">
            {downloadError.message}
          </p>
        )}
        <div className="ie-actions">
          <SWUButton
            size="sm"
            active={!downloadingKinds.has("json")}
            ariaDisabled={downloadingKinds.has("json")}
            onClick={() => handleDownload("json")}
          >
            {downloadingKinds.has("json") ? "Preparing…" : "Download JSON"}
          </SWUButton>
          <SWUButton
            size="sm"
            active={!downloadingKinds.has("csv")}
            ariaDisabled={downloadingKinds.has("csv")}
            onClick={() => handleDownload("csv")}
          >
            {downloadingKinds.has("csv") ? "Preparing…" : "Download CSV"}
          </SWUButton>
        </div>
      </section>

      <section className="ie-section" aria-labelledby="ie-import-title">
        {/* Owner dev-review 2026-07-23: the catalog reference lost its own
         * section -- it lives in the Import section's top-right corner now
         * (it exists to help build an import file, so it belongs here). */}
        <div className="ie-section__head ie-section__head--import">
          <div className="ie-section__head-main">
            <h2 className="ie-section__title" id="ie-import-title">
              Import
            </h2>
            <p className="ie-section__blurb">
              Preview changes before anything is written — nothing commits until you confirm.
            </p>
            {step === "configure" && (
              // BL-173 review round 4 (owner): imports expect the
              // HyperspaceVault format -- say so up front. BL-185/BL-186
              // follow-up (owner, 2026-08-03): SWUDB + SW-Unlimited-DB
              // exports now import natively, so the amber migration tip
              // leads with upload-as-is and keeps the catalog-CSV + AI
              // conversion as the everything-else path.
              <div className="ie-format-notes">
                <p className="ie-format-note">
                  Imports use the <strong>[HSV] HyperspaceVault format</strong> — the files Export
                  produces, or the catalog reference sheet with your quantities filled in. SWUDB and
                  SW-Unlimited-DB exports are also accepted natively.
                </p>
                <p className="ie-format-note ie-format-note--amber">
                  <strong>Coming from another tracker?</strong> If it&apos;s <strong>SWUDB</strong>{" "}
                  or <strong>SW-Unlimited-DB</strong>, just upload your export file as-is —
                  it&apos;s recognized automatically. From anywhere else, download the catalog CSV
                  and ask your favorite AI tool to convert your existing inventory file into it.
                </p>
              </div>
            )}
            {step === "configure" && (
              // Owner dev-review 2026-07-23: the native file input never
              // matched the app chrome -- it's visually hidden (kept in the
              // a11y tree, still label-associated) behind an SWUButton that
              // forwards its click, with the chosen filename echoed beside
              // it.
              <div className="ie-file-field">
                <label className="ie-field-label" htmlFor="ie-file-input">
                  File (.json, .csv, or .xlsx)
                </label>
                {/* BL-186: accept widened to include .xlsx (sw-unlimited-db's
                    collection-export format) alongside the existing canonical
                    .json/.csv and SWUDB's own .csv export -- the backend's
                    format-detection seam (routers/inventory.py's
                    _looks_like_xlsx) already routes any .xlsx upload to the
                    new adapter regardless of this attribute; this is
                    browser-side file-picker filtering only. */}
                <input
                  id="ie-file-input"
                  ref={fileInputRef}
                  className="ie-file-input"
                  type="file"
                  accept=".json,.csv,.xlsx"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
                <div className="ie-file-row">
                  <SWUButton size="sm" onClick={() => fileInputRef.current?.click()}>
                    Choose file
                  </SWUButton>
                  <span className="ie-file-name">{file ? file.name : "No file chosen"}</span>
                </div>
              </div>
            )}
          </div>
          <aside className="ie-reference" aria-labelledby="ie-reference-title">
            <div className="ie-reference__text">
              <h3 className="ie-reference__title" id="ie-reference-title">
                Catalog reference
              </h3>
              <p className="ie-reference__blurb">
                Every card printing with its IDs and a quantity column, in the{" "}
                <strong>[HSV] format</strong> — fill in your quantities and import it directly.
              </p>
              {downloadError?.source === "reference" && (
                <p className="ie-error" role="alert">
                  {downloadError.message}
                </p>
              )}
            </div>
            <SWUButton
              size="sm"
              active={!downloadingKinds.has("reference")}
              ariaDisabled={downloadingKinds.has("reference")}
              onClick={() => handleDownload("reference")}
            >
              {downloadingKinds.has("reference") ? "Preparing…" : "Download catalog (CSV)"}
            </SWUButton>
          </aside>
        </div>

        {fileError && (
          <p className="ie-error" role="alert">
            {fileError}
          </p>
        )}

        {step === "configure" && (
          <div className="ie-form">
            <div className="ie-radio-group" role="radiogroup" aria-label="Merge mode">
              <span className="ie-field-label">Merge mode</span>
              {MODE_OPTIONS.map((opt) => (
                <label key={opt.value} className="ie-radio-option">
                  <input
                    type="radio"
                    name="ie-mode"
                    value={opt.value}
                    checked={mode === opt.value}
                    onChange={() => setMode(opt.value)}
                  />
                  <span className="ie-radio-option__text">
                    <span
                      className={`ie-radio-option__title${opt.destructive ? " ie-radio-option__title--danger" : ""}`}
                    >
                      {opt.title}
                      {opt.destructive ? " (destructive)" : ""}
                    </span>
                    <span className="ie-radio-option__desc">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="ie-radio-group" role="radiogroup" aria-label="Cap handling">
              <span className="ie-field-label">Keep-limits</span>
              {CAP_OPTIONS.map((opt) => (
                <label key={opt.value} className="ie-radio-option">
                  <input
                    type="radio"
                    name="ie-cap"
                    value={opt.value}
                    checked={capHandling === opt.value}
                    onChange={() => setCapHandling(opt.value)}
                  />
                  <span className="ie-radio-option__text">
                    <span className="ie-radio-option__title">{opt.label}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="ie-actions">
              <SWUButton
                size="sm"
                active={!!file && !!mode && !!capHandling && !previewing}
                ariaDisabled={!file || !mode || !capHandling || previewing}
                onClick={handlePreview}
              >
                {previewing ? "Previewing…" : "Preview import"}
              </SWUButton>
            </div>
          </div>
        )}

        {step === "preview" && report && (
          <div className="ie-form">
            <ImportPreviewReport
              report={report}
              onDownloadProblemRows={makeProblemRowsHandler(report)}
            />

            {mode === "replace_all" && (
              <label className="ie-checkbox-row">
                <input
                  type="checkbox"
                  checked={replaceAllConfirmed}
                  onChange={(e) => setReplaceAllConfirmed(e.target.checked)}
                />
                <span>
                  I understand this will permanently remove {removalCount}{" "}
                  {removalCount === 1 ? "card" : "cards"} not in this file.
                </span>
              </label>
            )}

            <div className="ie-actions">
              <button type="button" className="ie-link" onClick={() => setStep("configure")}>
                Edit options
              </button>
              <span className="ie-actions__spacer" />
              <SWUButton
                size="sm"
                active={!confirmBlocked}
                ariaDisabled={confirmBlocked}
                onClick={handleConfirm}
              >
                {committing ? "Importing…" : "Confirm import"}
              </SWUButton>
            </div>
          </div>
        )}

        {step === "success" && successReport && (
          <div className="ie-form">
            <p className="ie-success" role="status">
              Import complete — {successReport.totals.resolved} row
              {successReport.totals.resolved === 1 ? "" : "s"} written.
            </p>
            <ImportPreviewReport
              report={successReport}
              onDownloadProblemRows={makeProblemRowsHandler(successReport)}
            />
            <div className="ie-actions">
              <button type="button" className="ie-link" onClick={handleStartOver}>
                Import another file
              </button>
              <span className="ie-actions__spacer" />
              <SWUButton size="sm" onClick={onBackToVault}>
                Back to Vault
              </SWUButton>
            </div>
          </div>
        )}
      </section>
      <BusyOverlay stage={overlay.stage} />
    </div>
  );
}
