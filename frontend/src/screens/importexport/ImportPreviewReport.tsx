import { useEffect, useState } from "react";
import type { ImportReport, ImportRowCard, ImportRowReport } from "../../api/inventoryImportExport";
import { SWUButton } from "../../components/SWUButton";

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

type ReportView = "problem" | "resolved";

/** BL-202 (owner dev-review of BL-200): the stacked list sections became a
 * two-view tab control -- Problem rows | Resolved rows -- each a table.
 * Owner-decided layout rules (AskUserQuestion, 2026-08-05):
 * - Trimmed/clamped rows FOLD INTO the Resolved table (they are resolved
 *   rows; the Notes column carries their kept/not-added note) instead of
 *   keeping their own section.
 * - replace_all's "Will be removed" list stays an always-visible danger
 *   section ABOVE the tab control -- §7.3's "the destructive half of the
 *   preview must be as visible as the additive half" forbids putting the
 *   deletion list behind a click.
 * - The Download problem rows control is a real button (SWUButton, same as
 *   every other action on this screen), OUTSIDE the tab panels so it's
 *   visible in either view.
 * - The totals header indicates alignment: the cells that make up the view
 *   being looked at carry the amber "aligned" treatment (the same
 *   visual language the Vault's scope affordances use for "this is
 *   adjusted to what you picked") -- Problem view aligns Unresolved +
 *   Ambiguous; Resolved view aligns Resolved + Trimmed + At ceiling. */
export function ImportPreviewReport({ report, onDownloadProblemRows }: Props) {
  const { totals, rows, removed, mode } = report;
  const problemRows = rows.filter((r) => r.status !== "resolved");
  const resolvedRows = rows.filter((r) => r.status === "resolved");

  const [view, setView] = useState<ReportView>(problemRows.length > 0 ? "problem" : "resolved");
  // A fresh report re-derives the default view (a new preview after fixing
  // the file shouldn't inherit the previous file's tab selection).
  useEffect(() => {
    setView(problemRows.length > 0 ? "problem" : "resolved");
    // Keyed by the report object identity alone: problemRows is derived
    // from it fresh every render, so `report` IS the change signal -- and
    // the reset must fire only for a NEW report, never because this
    // report's derived array got a new reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  const totalCards = totalCardsFromReport(report);
  const problemAligned = view === "problem";
  const resolvedAligned = view === "resolved";

  return (
    <div className="ie-report">
      <dl className="ie-totals">
        <TotalCell label="Rows" value={totals.rows} />
        <TotalCell label="Cards" value={totalCards} />
        <TotalCell label="Resolved" value={totals.resolved} aligned={resolvedAligned} />
        <TotalCell label="Unresolved" value={totals.unresolved} aligned={problemAligned} />
        <TotalCell label="Ambiguous" value={totals.ambiguous} aligned={problemAligned} />
        <TotalCell label="Trimmed" value={totals.trimmed} aligned={resolvedAligned} />
        <TotalCell label="At ceiling" value={totals.ceiling_clamped} aligned={resolvedAligned} />
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
          <div className="ie-table-wrap">
            <table className="ie-table">
              <thead>
                <tr>
                  <th scope="col">Card</th>
                  <th scope="col" className="ie-table__th-num">
                    Owned
                  </th>
                </tr>
              </thead>
              <tbody>
                {removed.map((r, i) => (
                  <tr key={i} className="ie-table__row--removed">
                    <td>{cardLabel(r.card)}</td>
                    <td className="ie-table__num">{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="ie-view-bar">
        <div className="ie-view-tabs" role="tablist" aria-label="Report rows">
          <button
            type="button"
            role="tab"
            aria-selected={view === "problem"}
            className={`ie-view-tab${view === "problem" ? " ie-view-tab--active" : ""}`}
            onClick={() => setView("problem")}
          >
            Problem rows ({problemRows.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "resolved"}
            className={`ie-view-tab${view === "resolved" ? " ie-view-tab--active" : ""}`}
            onClick={() => setView("resolved")}
          >
            Resolved rows ({resolvedRows.length})
          </button>
        </div>
        <SWUButton size="sm" onClick={onDownloadProblemRows}>
          Download problem rows (CSV)
        </SWUButton>
      </div>

      {view === "problem" ? (
        <section role="tabpanel" aria-label="Problem rows">
          {problemRows.length === 0 ? (
            <p className="ie-note">No problem rows — every row in the file resolved.</p>
          ) : (
            <div className="ie-table-wrap">
              <table className="ie-table">
                <thead>
                  <tr>
                    <th scope="col" className="ie-table__th-num">
                      Row
                    </th>
                    <th scope="col">Card</th>
                    <th scope="col">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {problemRows.map((r) => (
                    <ProblemTableRow key={r.row_number} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section role="tabpanel" aria-label="Resolved rows">
          {resolvedRows.length === 0 ? (
            <p className="ie-note">No rows resolved from this file.</p>
          ) : (
            <div className="ie-table-wrap">
              <table className="ie-table">
                <thead>
                  <tr>
                    <th scope="col">Card</th>
                    <th scope="col" className="ie-table__th-num">
                      Copies
                    </th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedRows.map((r) => (
                    <ResolvedTableRow key={r.row_number} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TotalCell({
  label,
  value,
  aligned = false,
}: {
  label: string;
  value: number;
  /** BL-202: this total is part of what the active view is showing --
   * carries the amber aligned treatment. */
  aligned?: boolean;
}) {
  return (
    <div className={`ie-totals__cell${aligned ? " ie-totals__cell--aligned" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ProblemTableRow({ row }: { row: ImportRowReport }) {
  return (
    <tr className="ie-table__row--problem">
      <td className="ie-table__num">{row.row_number}</td>
      <td className="ie-table__card">{cardLabel(row.card)}</td>
      <td className="ie-table__detail">
        {row.reason ? (REASON_TEXT[row.reason] ?? GENERIC_REASON_TEXT) : row.status}
        {row.candidates && row.candidates.length > 0 && (
          <div className="ie-table__candidates">
            Possible printings: {row.candidates.map(candidateLabel).join("; ")}.
          </div>
        )}
      </td>
    </tr>
  );
}

/** BL-202 (owner-decided): trimmed/clamped rows render inside the Resolved
 * table -- their kept/not-added note is a Notes entry (amber), not a
 * separate section. */
function ResolvedTableRow({ row }: { row: ImportRowReport }) {
  const notes: { text: string; className?: string }[] = [];
  if (row.trim_reason) {
    notes.push({
      text: `kept ${row.resulting_quantity}, ${row.copies_not_added} ${
        row.copies_not_added === 1 ? "copy" : "copies"
      } not added ${row.trim_reason === "ceiling" ? "(999 ceiling)" : "(keep-limit)"}`,
      className: "ie-table__note--trimmed",
    });
  }
  if (row.matched_by_fallback) notes.push({ text: "matched by fallback" });
  if (row.uuid_triple_mismatch) notes.push({ text: MISMATCH_TEXT });

  return (
    <tr className={row.trim_reason ? "ie-table__row--trimmed" : undefined}>
      <td className="ie-table__card">{cardLabel(row.card)}</td>
      <td className="ie-table__num">
        {row.current_quantity ?? 0} → {row.resulting_quantity}
      </td>
      <td className="ie-table__detail">
        {notes.map((n, i) => (
          <div key={i} className={n.className}>
            {n.text}
          </div>
        ))}
      </td>
    </tr>
  );
}
