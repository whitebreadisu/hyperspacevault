import type { ImportReport, ImportRowCard, ImportRowReport } from "../../api/inventoryImportExport";

interface Props {
  report: ImportReport;
  /** Present on both the preview (dry_run) and success (commit) renders --
   * §8.2c's "Download problem rows (CSV)" button generates its blob
   * client-side from `report.rows` regardless of stage, so a commit that
   * still left rows unresolved is just as recoverable as a preview. */
  onDownloadProblemRows: () => void;
}

/** BL-200 copy pass (specification_documents/analysis/
 * BL200_Import_ErrorState_Census_2026-08-05.md, §B) -- owner-approved
 * verbatim. Every row-level reason code the backend can send is covered
 * here now (was 5 of 9 -- the four adapter-era codes from BL-185/BL-186
 * used to fall through to GENERIC_REASON_TEXT below and leak their raw
 * snake_case string). Each string is the census's "what happened" sentence
 * followed by its "what to do next" sentence. */
const REASON_TEXT: Record<string, string> = {
  malformed_row:
    "This row's quantity isn't a number we can use. Fix it in the file to a whole number (0 or more) and re-import — everything else went through fine.",
  unknown_uuid_and_triple:
    "We couldn't find this card in the catalog — neither its ID nor its set/number/printing matched anything. Check the row against the catalog reference sheet, or it may be from a set we don't carry yet.",
  unknown_triple:
    "No card in the catalog matches that set, number, and printing. Double-check the row against the catalog reference sheet — it's usually a number or printing-type typo.",
  incomplete_identity:
    "This row doesn't say enough about which card it is. Fill in the card's ID, or all three of set, number, and printing type, and re-import.",
  unmapped_set:
    "This card is from a set (or promo series) we don't have in the catalog yet. Leave it out for now — you can add it by hand once the set lands in HyperspaceVault.",
  unknown_set_and_number:
    "We know that set, but there's no card at that number. Double-check the card number — and note that token cards can't be imported from SWUDB files.",
  unmapped_column:
    "This copy is logged under a promo column (like Judge or Event Exclusive) that we can't safely match to a specific printing. Add these few cards by hand in your Vault — everything in the regular columns imports normally.",
  unknown_variant_for_column:
    "We found the spot in the spreadsheet, but no printing of that card matches this column (and sometimes the card number itself is off). Check the card number and which column the quantity is in against the card's real printings.",
  ambiguous_triple:
    "This row matches more than one printing of the same card, and we don't guess. Let the rest import, then add this card by hand from your Vault — the possible printings are listed below.",
};

/** BL-200: the `?? row.reason` fallback used to render a raw snake_case
 * code verbatim whenever REASON_TEXT was missing an entry -- now that every
 * reason code the backend sends is covered above, this only fires for a
 * future/unrecognized code this build doesn't know about yet, but it must
 * still never show system vocabulary. Not itself drafted in the BL-200
 * census (every code it censused now has a real entry above); written to
 * match the census's stated voice (casual-but-competent, no raw codes). */
const GENERIC_REASON_TEXT =
  "This row couldn't be imported, and we don't have a more specific reason to show yet. It's safe to skip for now — everything else in the file still went through.";

/** BL-200 candidate display: "SET number · variant type · name", subtitle
 * appended when present -- the ambiguous-row candidates used to render as
 * bare swuapi UUIDs (see the census's "Candidate display" section). */
function candidateLabel(card: ImportRowCard): string {
  const identity = [card.set_code, card.card_number].filter(Boolean).join(" ");
  const parts = [identity, card.variant_type].filter((p): p is string => !!p);
  let name = card.name ?? "";
  if (card.subtitle) name = name ? `${name} — ${card.subtitle}` : card.subtitle;
  if (name) parts.push(name);
  return parts.join(" · ");
}

/** BL-200 §C2: the resolved-row "heads-up" flag used to hardcode "uuid/
 * triple mismatch" for every format, which was actively wrong for SWUDB/
 * XLSX rows (they never carried a uuid or a triple -- their mismatch is a
 * foil/stamp disagreement instead). The census's own recommendation is one
 * honest string that covers both without naming uuid/triple/foil internals
 * ("if the owner wants precision later, the flag would need a format-aware
 * split in the payload" -- not requested yet), so this replaces the old
 * per-format-wrong string rather than branching on format. */
const MISMATCH_TEXT =
  "heads-up — some details in this row didn't fully agree, so double-check it landed on the right printing";

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

// Owner dev-review 2026-07-23: total physical copies the file carries, as
// distinct from its row count (a row is one printing at some quantity).
// Derived client-side from file_quantity -- malformed rows carry no
// quantity key (exclude_none) and naturally contribute 0.
// BL-196: exported (was a local var in ImportPreviewReport below) -- the
// commit-stage busy overlay message on ImportExportPage ("Applying N
// cards…") wants the exact same figure the preview screen already labels
// "Cards", computed from the same still-in-hand dry_run report rather than
// re-deriving it.
export function totalCardsFromReport(report: ImportReport): number {
  return report.rows.reduce((sum, r) => sum + (r.file_quantity ?? 0), 0);
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
  const totalCards = totalCardsFromReport(report);

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
                  {r.uuid_triple_mismatch ? ` · ${MISMATCH_TEXT}` : ""}
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
        {row.reason ? (REASON_TEXT[row.reason] ?? GENERIC_REASON_TEXT) : row.status}
        {row.candidates && row.candidates.length > 0 && (
          <> Possible printings: {row.candidates.map(candidateLabel).join("; ")}.</>
        )}
      </span>
    </li>
  );
}
