import type { ImportReport, ImportRowCard, ImportRowReport } from "../../api/inventoryImportExport";

interface Props {
  report: ImportReport;
  /** Present on both the preview (dry_run) and success (commit) renders --
   * §8.2c's "Download problem rows (CSV)" button generates its blob
   * client-side from `report.rows` regardless of stage, so a commit that
   * still left rows unresolved is just as recoverable as a preview. */
  onDownloadProblemRows: () => void;
}

const REASON_TEXT: Record<string, string> = {
  unknown_uuid_and_triple: "Not found by ID or by set/number/variant.",
  unknown_triple: "No matching card for that set/number/variant.",
  ambiguous_triple: "Matches more than one printing — pick a candidate below.",
  incomplete_identity:
    "Missing enough identity to resolve (needs a uuid, or set + number + variant).",
  malformed_row: "Quantity is missing, negative, or not a whole number.",
};

/** §7.3's `card` fragment renders as whatever identity the row actually
 * carried -- resolved rows always have set_code/card_number/variant_type
 * (the canonical DB identity); unresolved/ambiguous rows may have only a
 * uuid, only a partial triple, or nothing at all. */
function cardLabel(card: ImportRowCard): string {
  const identity = [card.set_code, card.card_number].filter(Boolean).join(" ");
  const variant = card.variant_type ? ` (${card.variant_type})` : "";
  const name = card.name ? ` — ${card.name}` : "";
  if (identity) return `${identity}${variant}${name}`;
  if (card.swuapi_uuid) return `uuid ${card.swuapi_uuid}${name}`;
  return "Row with no recognizable identity";
}

/** §8.2c's ordering: problem rows first, then trimmed/clamped rows, then the
 * resolved remainder collapsed -- "the destructive half of the preview must
 * be as visible as the additive half" (§7.3) puts `removed` (replace_all's
 * itemized deletions) ahead of even the problem rows, since removals are
 * silent unless surfaced. */
export function ImportPreviewReport({ report, onDownloadProblemRows }: Props) {
  const { totals, rows, removed, mode } = report;
  const problemRows = rows.filter((r) => r.status !== "resolved");
  const trimmedRows = rows.filter((r) => r.status === "resolved" && r.trim_reason);
  const resolvedRemainder = rows.filter((r) => r.status === "resolved" && !r.trim_reason);
  // Owner dev-review 2026-07-23: total physical copies the file carries, as
  // distinct from its row count (a row is one printing at some quantity).
  // Derived client-side from file_quantity -- malformed rows carry no
  // quantity key (exclude_none) and naturally contribute 0.
  const totalCards = rows.reduce((sum, r) => sum + (r.file_quantity ?? 0), 0);

  return (
    <div className="ie-report">
      <dl className="ie-totals">
        <TotalCell label="Rows" value={totals.rows} />
        <TotalCell label="Cards" value={totalCards} />
        <TotalCell label="Resolved" value={totals.resolved} />
        <TotalCell label="Unresolved" value={totals.unresolved} />
        <TotalCell label="Ambiguous" value={totals.ambiguous} />
        <TotalCell label="Trimmed" value={totals.trimmed} />
        <TotalCell label="At ceiling" value={totals.ceiling_clamped} />
        <TotalCell label="Duplicates merged" value={totals.duplicate_rows_merged} />
        {mode === "replace_all" && (
          <TotalCell label="Removed" value={totals.removed_by_replace_all} />
        )}
      </dl>

      {totals.unrecognized_columns.length > 0 && (
        <p className="ie-note">
          Unrecognized column{totals.unrecognized_columns.length === 1 ? "" : "s"} (ignored):{" "}
          {totals.unrecognized_columns.join(", ")}
        </p>
      )}

      {removed.length > 0 && (
        <section
          className="ie-report-section ie-report-section--danger"
          aria-label="Rows that will be removed"
        >
          <h3 className="ie-report-section__title">
            Will be removed ({removed.length}) — not present in the file
          </h3>
          <ul className="ie-row-list">
            {removed.map((r, i) => (
              <li key={i} className="ie-row ie-row--removed">
                <span className="ie-row__card">{cardLabel(r.card)}</span>
                <span className="ie-row__detail">{r.quantity} owned</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {problemRows.length > 0 && (
        <section className="ie-report-section ie-report-section--danger" aria-label="Problem rows">
          <div className="ie-report-section__head">
            <h3 className="ie-report-section__title">Problem rows ({problemRows.length})</h3>
            <button type="button" className="ie-link" onClick={onDownloadProblemRows}>
              Download problem rows (CSV)
            </button>
          </div>
          <ul className="ie-row-list">
            {problemRows.map((r) => (
              <ProblemRow key={r.row_number} row={r} />
            ))}
          </ul>
        </section>
      )}

      {trimmedRows.length > 0 && (
        <section
          className="ie-report-section ie-report-section--warning"
          aria-label="Trimmed or clamped rows"
        >
          <h3 className="ie-report-section__title">
            Trimmed / clamped rows ({trimmedRows.length})
          </h3>
          <ul className="ie-row-list">
            {trimmedRows.map((r) => (
              <li key={r.row_number} className="ie-row ie-row--trimmed">
                <span className="ie-row__card">{cardLabel(r.card)}</span>
                <span className="ie-row__detail">
                  kept {r.resulting_quantity}, {r.copies_not_added}{" "}
                  {r.copies_not_added === 1 ? "copy" : "copies"} not added
                  {r.trim_reason === "ceiling" ? " (999 ceiling)" : " (keep-limit)"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {resolvedRemainder.length > 0 && (
        <details className="ie-report-section">
          <summary className="ie-report-section__title">
            {resolvedRemainder.length} more resolved row
            {resolvedRemainder.length === 1 ? "" : "s"}
          </summary>
          <ul className="ie-row-list">
            {resolvedRemainder.map((r) => (
              <li key={r.row_number} className="ie-row">
                <span className="ie-row__card">{cardLabel(r.card)}</span>
                <span className="ie-row__detail">
                  {r.current_quantity ?? 0} → {r.resulting_quantity}
                  {r.matched_by_fallback ? " · matched by fallback" : ""}
                  {r.uuid_triple_mismatch ? " · uuid/triple mismatch" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TotalCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="ie-totals__cell">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ProblemRow({ row }: { row: ImportRowReport }) {
  return (
    <li className="ie-row ie-row--problem">
      <span className="ie-row__card">
        Row {row.row_number}: {cardLabel(row.card)}
      </span>
      <span className="ie-row__detail">
        {row.reason ? (REASON_TEXT[row.reason] ?? row.reason) : row.status}
        {row.candidates && row.candidates.length > 0 && (
          <> — candidates: {row.candidates.join(", ")}</>
        )}
      </span>
    </li>
  );
}
