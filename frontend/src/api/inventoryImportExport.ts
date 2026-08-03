import { authedFetch } from "./authedFetch";
import { CodedApiError } from "./errors";

/** BL-54 S3: frontend types + client for the Import/Export surface, mirroring
 * backend/app/schemas/inventory_import_schema.py field-for-field
 * (Definition_ImportExport_2026-07-22.md §7 -- the authoritative contract),
 * the same "mirrors the backend schema" idiom api/deckCheck.ts's own doc
 * comment describes. Every endpoint here sits behind require_verified_email
 * (P9) except downloadCatalogReference (public, §6) -- callers must only
 * invoke the gated ones once ImportExportPage itself is reachable (App.tsx
 * mounts that pane only for verified users). */

export type ImportMode = "merge_add" | "replace" | "replace_all";
export type CapHandling = "add_above" | "trim";
export type ImportStage = "dry_run" | "commit";
export type RowStatus = "resolved" | "unresolved" | "ambiguous";
export type ReasonCode =
  | "unknown_uuid_and_triple"
  | "unknown_triple"
  | "ambiguous_triple"
  | "incomplete_identity"
  | "malformed_row";
export type TrimReason = "keep_limit" | "ceiling";

/** §7.3's `card` object -- for a resolved row this is the canonical catalog
 * identity; for unresolved/ambiguous rows it's only whatever raw identity
 * fragments the file carried. Every field optional (response_model_exclude_
 * none on the wire): a row missing a fragment simply omits that key rather
 * than sending it null. */
export interface ImportRowCard {
  swuapi_uuid?: string;
  set_code?: string;
  card_number?: string;
  variant_type?: string;
  name?: string;
  subtitle?: string;
}

/** §7.3's per-row report entry. Every field beyond row_number/status/card is
 * present only when meaningful for that row's status (exclude_none, per the
 * router's response_model_exclude_none=True) -- e.g. an ambiguous row has no
 * resulting_quantity key at all, not a null one. */
export interface ImportRowReport {
  row_number: number;
  status: RowStatus;
  reason?: ReasonCode;
  matched_by_fallback?: boolean;
  uuid_triple_mismatch?: boolean;
  candidates?: string[];
  card: ImportRowCard;
  file_quantity?: number;
  current_quantity?: number;
  resulting_quantity?: number;
  copies_not_added?: number;
  trim_reason?: TrimReason;
}

export interface ImportTotals {
  rows: number;
  resolved: number;
  matched_by_fallback: number;
  unresolved: number;
  ambiguous: number;
  trimmed: number;
  ceiling_clamped: number;
  duplicate_rows_merged: number;
  unrecognized_columns: string[];
  removed_by_replace_all: number;
}

/** §7.3 `replace_all`: one currently-owned row the file doesn't mention. */
export interface RemovedRow {
  card: ImportRowCard;
  quantity: number;
}

/** §7.3's full report -- the response shape of both the dry_run and commit
 * stages of POST /api/inventory/import (only `committed` and the actual DB
 * state differ between them). */
export interface ImportReport {
  stage: ImportStage;
  mode: ImportMode;
  cap_handling: CapHandling;
  committed: boolean;
  totals: ImportTotals;
  rows: ImportRowReport[];
  removed: RemovedRow[];
}

/** The full-file 422 codes the router raises before any report exists
 * (§7.2), rendered as an inline error rather than a report (§8.2's last
 * bullet) -- plus `email_not_verified` (the shared P9 gate, surfaced as a
 * 403 on export/import alike) and `unknown` for anything else (a genuine
 * 401/5xx/network failure), the same typed-error shape api/deckCheck.ts's
 * DeckCheckApiError uses. */
export type ImportErrorCode =
  | "file_too_large"
  | "too_many_rows"
  | "unparseable_file"
  | "unsupported_format_version"
  | "email_not_verified"
  | "unknown";

const FILE_ERROR_CODES: ReadonlySet<string> = new Set([
  "file_too_large",
  "too_many_rows",
  "unparseable_file",
  "unsupported_format_version",
]);

const CODE_MESSAGES: Record<ImportErrorCode, string> = {
  file_too_large: "That file is over the 10 MB upload limit.",
  too_many_rows: "That file has more than 20,000 rows — split it and try again.",
  unparseable_file:
    "Couldn't read that file — check that it's a valid .json, .csv, or .xlsx export.",
  unsupported_format_version: "That file's format version isn't supported by this app.",
  email_not_verified: "Verify your email to import or export your collection.",
  unknown: "Something went wrong. Please try again.",
};

/** BL-154: extends the shared CodedApiError base (api/errors.ts) rather than
 * Error directly -- the code/message/status shape was already the target
 * pattern (the audit's "parsed-body typed errors" convention, the same one
 * api/deckCheck.ts's DeckCheckApiError uses), so only the base class
 * changed here. */
export class ImportApiError extends CodedApiError<ImportErrorCode> {
  constructor(code: ImportErrorCode, status: number) {
    super(code, CODE_MESSAGES[code], status);
    this.name = "ImportApiError";
  }
}

async function toImportApiError(res: Response): Promise<ImportApiError> {
  let detail: unknown;
  try {
    detail = (await res.json())?.detail;
  } catch {
    detail = undefined;
  }
  const code: ImportErrorCode =
    typeof detail === "string" && FILE_ERROR_CODES.has(detail)
      ? (detail as ImportErrorCode)
      : detail === "email_not_verified"
        ? "email_not_verified"
        : "unknown";
  return new ImportApiError(code, res.status);
}

/** POST /api/inventory/import -- multipart/form-data (NOT a JSON body, per
 * the S2 handoff): a `file` part plus string form fields mode/cap_handling/
 * stage. `body` is left as a FormData instance and no Content-Type header is
 * set explicitly -- fetch derives the multipart boundary itself, setting it
 * by hand would omit the boundary parameter and break parsing server-side.
 * Stateless two-call design (§7.2): the same function drives both the
 * dry_run preview and the commit, distinguished only by `stage`. */
export async function runImport(
  file: File,
  mode: ImportMode,
  capHandling: CapHandling,
  stage: ImportStage
): Promise<ImportReport> {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", mode);
  body.append("cap_handling", capHandling);
  body.append("stage", stage);

  const res = await authedFetch("/api/inventory/import", { method: "POST", body });
  if (!res.ok) throw await toImportApiError(res);
  return (await res.json()) as ImportReport;
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** Content-Disposition: attachment; filename="..." -- both export endpoints
 * (§7.1/§6) always set this; the fallback is defensive only. */
function filenameFromContentDisposition(res: Response, fallback: string): string {
  const header = res.headers.get("Content-Disposition");
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/** GET /api/inventory/export?format=json|csv (§7.1). Auth + verified, like
 * runImport above. */
export async function exportInventory(format: "json" | "csv"): Promise<DownloadedFile> {
  const res = await authedFetch(`/api/inventory/export?format=${format}`);
  if (!res.ok) throw await toImportApiError(res);
  const blob = await res.blob();
  return {
    blob,
    filename: filenameFromContentDisposition(res, `hyperspacevault-inventory.${format}`),
  };
}

/** GET /api/catalog/reference.csv (§6/§7.4) -- public (P12), but routed
 * through authedFetch like every other catalog read in this app anyway (see
 * authedFetch.ts's own doc comment: attaching a token is harmless when one
 * exists and a no-op when it doesn't). */
export async function downloadCatalogReference(): Promise<DownloadedFile> {
  const res = await authedFetch("/api/catalog/reference.csv");
  if (!res.ok) throw await toImportApiError(res);
  const blob = await res.blob();
  return {
    blob,
    filename: filenameFromContentDisposition(res, "hyperspacevault-catalog-reference.csv"),
  };
}

/** Triggers a browser download for an in-memory blob -- used for the two
 * server-generated downloads above AND the client-generated "problem rows"
 * CSV (ImportPreviewReport builds that blob itself from the dry-run/commit
 * report, §8.2c). The object URL is revoked right after the synthetic click;
 * browsers keep the download alive from their own buffered copy once the
 * click fires, so the timing is safe. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
