import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  downloadBlob,
  downloadCatalogReference,
  exportInventory,
  ImportApiError,
  runImport,
} from "../../api/inventoryImportExport";
import type { CapHandling, ImportMode, ImportReport } from "../../api/inventoryImportExport";
import { BusyOverlay } from "../../components/BusyOverlay";
import { useBusyOverlay } from "../../hooks/useBusyOverlay";
import "../../screens/importexport/ImportExportPage.css";
import { totalCardsFromReport } from "../../screens/importexport/ImportPreviewReport";
import { MIcon } from "../icons";
import { MSWUButton } from "../MSWUButton";
import { capturePhone, phoneScreenViewed } from "../phoneAnalytics";
import { go } from "../router";
import { useVaultData } from "../vault/useVaultData";
import { ImportReportList } from "./ImportReportList";
import { CAP_OPTIONS, MODE_OPTIONS, fileFormat, problemRowsCsv } from "./importFork";
import { ShellHead } from "./ShellHead";
import "./more.css";
import "./importexport.css";

// BL-250 S4-08 … S4-12: Import & Export at #/more/importexport -- desktop
// ImportExportPage.tsx's configure -> preview -> success stepper on a phone
// (rev4 MImportExport.jsx + m-rev4-d.css 179-237: one column, radios as
// whole-row 48 px buttons with a drawn dot, Replace All in red). Gate = the
// desktop's view forcing (App.tsx): anonymous -> back to More with sign-in;
// signed in but unverified -> back to More (the row there explains why).
// Copy is desktop's, verbatim. TIEBREAKER S4-11: the Replace All confirmation
// sits on the PREVIEW step (desktop parity), not the configure step (rev4,
// which had no preview). TIEBREAKER S4-11: the commit button reads desktop's
// "Confirm import" (the brief's "Import" is shorthand).

type Step = "configure" | "preview" | "success";
type DownloadKind = "json" | "csv" | "reference";

interface Props {
  fromMore: boolean;
  signedIn: boolean;
  emailVerified: boolean;
  onRequestSignIn: () => void;
}

function Radio({
  on,
  danger,
  group,
  onClick,
  children,
}: {
  on: boolean;
  danger?: boolean;
  group: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-group={group}
      className={
        "ie-radio-option m-ie-radio" +
        (danger ? " ie-radio-option--danger" : "") +
        (on ? " m-ie-radio--on" : "")
      }
      onClick={onClick}
    >
      <span className="m-ie-radio__dot" aria-hidden="true" />
      <span className="ie-radio-option__text">{children}</span>
    </button>
  );
}

export function ImportExportScreen({ fromMore, signedIn, emailVerified, onRequestSignIn }: Props) {
  const allowed = signedIn && emailVerified;
  // S4-08: desktop's forcing -- not reachable anonymous or unverified.
  useEffect(() => {
    if (allowed) return;
    go("#/more", true);
    if (!signedIn) onRequestSignIn();
    // Once per mount: the redirect unmounts this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!allowed) return null;
  return <ImportExportBody fromMore={fromMore} />;
}

function ImportExportBody({ fromMore }: { fromMore: boolean }) {
  const [step, setStep] = useState<Step>("configure");
  const [file, setFile] = useState<File | null>(null);
  // Owner review 2026-08-03 (desktop): NO defaults on either radio group.
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [capHandling, setCapHandling] = useState<CapHandling | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [successReport, setSuccessReport] = useState<ImportReport | null>(null);
  const [replaceAllConfirmed, setReplaceAllConfirmed] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [downloadError, setDownloadError] = useState<{
    source: "export" | "reference";
    message: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<ReadonlySet<DownloadKind>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlay = useBusyOverlay();
  const { refreshQuantities } = useVaultData();
  // S4-12: desktop's import_export screen_viewed -- sent here, on the gated
  // body only, so a forced-back visitor counts as viewing More (desktop: cards).
  useEffect(() => phoneScreenViewed("import_export"), []);
  const scrollTop = () => {
    const el = document.querySelector(".m-ie");
    if (el) el.scrollTop = 0;
  };

  function handleFileChange(next: File | null) {
    setFile(next);
    setReport(null);
    setFileError(null);
  }

  async function handleDownload(kind: DownloadKind) {
    if (downloading.has(kind)) return;
    setDownloadError(null);
    setDownloading((prev) => new Set(prev).add(kind));
    try {
      const { blob, filename } =
        kind === "reference" ? await downloadCatalogReference() : await exportInventory(kind);
      downloadBlob(blob, filename);
      // BL-235: only the two real inventory exports count.
      if (kind !== "reference") capturePhone("export_performed", { format: kind });
    } catch (err) {
      setDownloadError({
        source: kind === "reference" ? "reference" : "export",
        message:
          err instanceof ImportApiError
            ? err.message
            : "Couldn't download that file. Please try again.",
      });
    } finally {
      setDownloading((prev) => {
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
      const result = await overlay.run(
        { message: "Checking your file…" },
        { task: () => runImport(file, mode, capHandling, "dry_run") }
      );
      setReport(result);
      setReplaceAllConfirmed(false);
      setStep("preview");
      scrollTop();
      capturePhone("import_dry_run", {
        format: fileFormat(file),
        rows: result.totals.rows,
        error_rows: result.totals.rows - result.totals.resolved,
      });
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
    if (!file || !mode || !capHandling || !report || confirmBlocked) return;
    setCommitting(true);
    setFileError(null);
    const count = totalCardsFromReport(report);
    try {
      const result = await overlay.run(
        { message: `Applying ${count.toLocaleString()} ${count === 1 ? "card" : "cards"}…` },
        {
          task: () => runImport(file, mode, capHandling, "commit"),
          settleStage: { message: "Refreshing your Vault…" },
          settle: async () => {
            await refreshQuantities().catch(() => {});
          },
        }
      );
      setSuccessReport(result);
      setStep("success");
      scrollTop();
      capturePhone("import_committed", { mode, rows_applied: result.totals.resolved });
    } catch (err) {
      setFileError(
        err instanceof ImportApiError ? err.message : "Something went wrong committing that import."
      );
    } finally {
      setCommitting(false);
    }
  }

  function problemRowsHandler(active: ImportReport | null) {
    return () => {
      if (!active) return;
      const problemRows = active.rows.filter((r) => r.status !== "resolved");
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
    setMode(null);
    setCapHandling(null);
    setReport(null);
    setSuccessReport(null);
    setReplaceAllConfirmed(false);
    setFileError(null);
    scrollTop();
  }

  const removalCount = report?.totals.removed_by_replace_all ?? 0;
  const ready = !!file && !!mode && !!capHandling && !previewing;
  const dl = (kind: DownloadKind, label: string) => (
    <MSWUButton
      size="touch"
      active={!downloading.has(kind)}
      ariaDisabled={downloading.has(kind)}
      onClick={() => handleDownload(kind)}
    >
      {downloading.has(kind) ? "Preparing…" : label}
    </MSWUButton>
  );

  return (
    <div
      className="m-screen m-shellscreen m-ie"
      role="dialog"
      aria-labelledby="m-ie-title"
      data-step={step}
    >
      <div className="m-shell">
        <div className="m-shell__panel">
          <ShellHead
            title="Import & Export"
            titleId="m-ie-title"
            fromMore={fromMore}
            locked={previewing || committing}
          />

          {step === "configure" && (
            <section className="ie-section" aria-labelledby="ie-export-title" data-section="export">
              <div className="ie-section__head">
                <h2 className="ie-section__title" id="ie-export-title">
                  Export
                </h2>
                <p className="ie-section__blurb">Download your Vault in the canonical format.</p>
                {downloadError?.source === "export" && (
                  <p className="ie-error" role="alert">
                    {downloadError.message}
                  </p>
                )}
                <div className="ie-actions">
                  {dl("json", "Download JSON")}
                  {dl("csv", "Download CSV")}
                </div>
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
                {dl("reference", "Download catalog (CSV)")}
              </aside>
            </section>
          )}

          <section className="ie-section" aria-labelledby="ie-import-title" data-section="import">
            <div className="ie-section__head">
              <h2 className="ie-section__title" id="ie-import-title">
                {step === "preview" ? "Import preview" : "Import"}
              </h2>
              <p className="ie-section__blurb">
                Preview changes before anything is written — nothing commits until you confirm.
              </p>
              {step === "configure" && (
                <div className="ie-format-notes">
                  <p className="ie-format-note">
                    Imports use the <strong>[HSV] HyperspaceVault format</strong> — the files Export
                    produces, or the catalog reference sheet with your quantities filled in. SWUDB
                    and SW-Unlimited-DB exports are also accepted natively.
                  </p>
                  <p className="ie-format-note ie-format-note--amber">
                    <strong>Coming from another tracker?</strong> If it&apos;s{" "}
                    <strong>SWUDB</strong> or <strong>SW-Unlimited-DB</strong>, just upload your
                    export file as-is — it&apos;s recognized automatically. From anywhere else,
                    download the catalog CSV and ask your favorite AI tool to convert your existing
                    inventory file into it.
                  </p>
                </div>
              )}
              {step === "configure" && (
                <div className="ie-file-field">
                  <label className="ie-field-label" htmlFor="ie-file-input">
                    File (.json, .csv, or .xlsx)
                  </label>
                  <div className="ie-file-row">
                    {/* The real <input type=file> lies over the 44 px button, invisible: a
                        tap lands on the native picker itself (no programmatic click(), which
                        iOS Safari can swallow), and the input is itself a >= 44 px target. */}
                    <span className="m-ie__pick">
                      <span inert aria-hidden="true">
                        <MSWUButton size="touch">Choose import file</MSWUButton>
                      </span>
                      <input
                        id="ie-file-input"
                        ref={fileInputRef}
                        className="ie-file-input"
                        type="file"
                        accept=".json,.csv,.xlsx"
                        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                      />
                    </span>
                    <span className="ie-file-name">{file ? file.name : "No file chosen"}</span>
                  </div>
                </div>
              )}
            </div>

            {fileError && (
              <p className="ie-error" role="alert">
                {fileError}
              </p>
            )}

            {step === "configure" && (
              <div className="ie-form">
                <div className="ie-radio-row">
                  <div className="ie-radio-group" role="radiogroup" aria-label="Merge mode">
                    <span className="ie-field-label">Merge mode</span>
                    {MODE_OPTIONS.map((opt) => (
                      <Radio
                        key={opt.value}
                        group="mode"
                        on={mode === opt.value}
                        danger={opt.destructive}
                        onClick={() => setMode(opt.value)}
                      >
                        <span
                          className={`ie-radio-option__title${opt.destructive ? " ie-radio-option__title--danger" : ""}`}
                        >
                          {opt.title}
                          {opt.destructive ? " (destructive)" : ""}
                        </span>
                        <span className="ie-radio-option__desc">{opt.description}</span>
                      </Radio>
                    ))}
                  </div>
                  <div className="ie-radio-group" role="radiogroup" aria-label="Cap handling">
                    <span className="ie-field-label">Keep-limits</span>
                    {CAP_OPTIONS.map((opt) => (
                      <Radio
                        key={opt.value}
                        group="cap"
                        on={capHandling === opt.value}
                        onClick={() => setCapHandling(opt.value)}
                      >
                        <span className="ie-radio-option__title">{opt.label}</span>
                      </Radio>
                    ))}
                  </div>
                </div>
                <div className="ie-actions">
                  <MSWUButton
                    size="touch"
                    active={ready}
                    ariaDisabled={!ready}
                    onClick={handlePreview}
                  >
                    {previewing ? "Previewing…" : "Preview import"}
                  </MSWUButton>
                </div>
              </div>
            )}

            {step === "preview" && report && (
              <div className="ie-form">
                <ImportReportList
                  report={report}
                  onDownloadProblemRows={problemRowsHandler(report)}
                />

                {mode === "replace_all" && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={replaceAllConfirmed}
                    className={
                      "ie-checkbox-row m-check m-ie__check" +
                      (replaceAllConfirmed ? " m-check--on" : "")
                    }
                    onClick={() => setReplaceAllConfirmed((c) => !c)}
                  >
                    <span className="m-check__box">
                      {replaceAllConfirmed ? <MIcon name="check" size={16} /> : null}
                    </span>
                    <span>
                      I understand this will permanently remove {removalCount}{" "}
                      {removalCount === 1 ? "card" : "cards"} not in this file.
                    </span>
                  </button>
                )}

                {report.totals.resolved === 0 && (
                  <p className="ie-note">
                    Nothing in this file could be matched to the catalog, so there&apos;s nothing to
                    import yet — fix the rows above and preview again.
                  </p>
                )}

                <div className="ie-actions m-ie__foot">
                  <MSWUButton size="touch" onClick={() => setStep("configure")}>
                    Cancel
                  </MSWUButton>
                  <span className="ie-actions__spacer" />
                  <MSWUButton
                    size="touch"
                    active={!confirmBlocked}
                    ariaDisabled={confirmBlocked}
                    onClick={handleConfirm}
                  >
                    {committing ? "Importing…" : "Confirm import"}
                  </MSWUButton>
                </div>
              </div>
            )}

            {step === "success" && successReport && (
              <div className="ie-form">
                <p className="ie-success" role="status">
                  Import complete — {successReport.totals.resolved} row
                  {successReport.totals.resolved === 1 ? "" : "s"} written.
                </p>
                <ImportReportList
                  report={successReport}
                  onDownloadProblemRows={problemRowsHandler(successReport)}
                />
                <div className="ie-actions m-ie__foot">
                  <button type="button" className="ie-link m-ie__link" onClick={handleStartOver}>
                    Import another file
                  </button>
                  <span className="ie-actions__spacer" />
                  <MSWUButton size="touch" onClick={() => go("#/vault")}>
                    Back to Vault
                  </MSWUButton>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      {createPortal(<BusyOverlay stage={overlay.stage} />, document.body)}
    </div>
  );
}
