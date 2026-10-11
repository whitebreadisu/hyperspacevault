import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ImportReport, ImportRowReport } from "../../api/inventoryImportExport";
import { totalCardsFromReport } from "../../screens/importexport/ImportPreviewReport";
import { MSWUButton } from "../MSWUButton";
import {
  GENERIC_REASON_TEXT,
  MISMATCH_TEXT,
  REASON_TEXT,
  candidateLabel,
  cardLabel,
} from "./importFork";
import type { ReasonCopy } from "./importFork";

// BL-250 S4-11: the dry-run / commit report as a phone list. Same information
// and copy as desktop ImportPreviewReport.tsx (totals, unrecognized columns,
// the always-visible "Will be removed" danger section, Problem | Resolved
// views, the problem-rows download, error + recommendation + possible
// printings, resolved current -> resulting with trim / fallback / mismatch
// notes), with its fixed-column tables ported into stacked rows.
// TIEBREAKER S4-11 (paging): desktop scrolls a 360 px table; a phone has no
// inner scroll, so rows render PAGE at a time with a 44 px "Show more".

const PAGE = 100;

type View = "problem" | "resolved";

function Total({ label, value, aligned }: { label: string; value: number; aligned?: boolean }) {
  return (
    <div className={`ie-totals__cell${aligned ? " ie-totals__cell--aligned" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ProblemRow({ row }: { row: ImportRowReport }) {
  const copy: ReasonCopy = row.reason
    ? (REASON_TEXT[row.reason] ?? GENERIC_REASON_TEXT)
    : { error: row.status, recommendation: "" };
  return (
    <li className="m-ie-row m-ie-row--problem">
      <div className="m-ie-row__head">
        <span className="m-ie-row__num">{row.row_number}</span>
        <span className="m-ie-row__card">{cardLabel(row.card)}</span>
      </div>
      <div className="ie-table__error">{copy.error}</div>
      {copy.recommendation && (
        <div className="ie-table__recommendation">
          <span className="ie-table__recommendation-label">Recommendation:</span>{" "}
          {copy.recommendation}
        </div>
      )}
      {row.candidates && row.candidates.length > 0 && (
        <div className="ie-table__candidates">
          Possible printings: {row.candidates.map(candidateLabel).join("; ")}.
        </div>
      )}
    </li>
  );
}

function ResolvedRow({ row }: { row: ImportRowReport }) {
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
    <li className={"m-ie-row" + (row.trim_reason ? " m-ie-row--trimmed" : "")}>
      <div className="m-ie-row__head">
        <span className="m-ie-row__card">{cardLabel(row.card)}</span>
        <span className="m-ie-row__qty">
          {row.current_quantity ?? 0} → {row.resulting_quantity}
        </span>
      </div>
      {notes.map((n, i) => (
        <div key={i} className={"ie-table__detail " + (n.className ?? "")}>
          {n.text}
        </div>
      ))}
    </li>
  );
}

function Paged<T>({ items, render }: { items: T[]; render: (item: T, i: number) => ReactNode }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <>
      <ul className="m-ie-list">{items.slice(0, shown).map(render)}</ul>
      {items.length > shown ? (
        <MSWUButton size="touch" onClick={() => setShown((n) => n + PAGE)}>
          {`Show more (${items.length - shown})`}
        </MSWUButton>
      ) : null}
    </>
  );
}

interface Props {
  report: ImportReport;
  onDownloadProblemRows: () => void;
}

export function ImportReportList({ report, onDownloadProblemRows }: Props) {
  const { totals, rows, removed, mode } = report;
  const problemRows = rows.filter((r) => r.status !== "resolved");
  const resolvedRows = rows.filter((r) => r.status === "resolved");
  const [view, setView] = useState<View>(problemRows.length > 0 ? "problem" : "resolved");
  useEffect(() => {
    setView(problemRows.length > 0 ? "problem" : "resolved");
    // A NEW report re-derives the default view (as desktop); keyed by identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  return (
    <div className="ie-report m-ie-report">
      <dl className="ie-totals">
        <Total label="Rows" value={totals.rows} />
        <Total label="Cards" value={totalCardsFromReport(report)} />
        <Total label="Resolved" value={totals.resolved} aligned={view === "resolved"} />
        <Total label="Unresolved" value={totals.unresolved} aligned={view === "problem"} />
        <Total label="Ambiguous" value={totals.ambiguous} aligned={view === "problem"} />
        <Total label="Trimmed" value={totals.trimmed} aligned={view === "resolved"} />
        <Total label="Duplicates merged" value={totals.duplicate_rows_merged} />
        {mode === "replace_all" && <Total label="Removed" value={totals.removed_by_replace_all} />}
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
          <Paged
            items={removed}
            render={(r, i) => (
              <li key={i} className="m-ie-row m-ie-row--removed">
                <div className="m-ie-row__head">
                  <span className="m-ie-row__card">{cardLabel(r.card)}</span>
                  <span className="m-ie-row__qty">Owned {r.quantity}</span>
                </div>
              </li>
            )}
          />
        </section>
      )}

      <div className="m-ie-tabs" role="tablist" aria-label="Report rows">
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
      <MSWUButton size="touch" onClick={onDownloadProblemRows}>
        Download problem rows (CSV)
      </MSWUButton>

      {view === "problem" ? (
        <section key="p" role="tabpanel" aria-label="Problem rows">
          {problemRows.length === 0 ? (
            <p className="ie-note">No problem rows — every row in the file resolved.</p>
          ) : (
            <Paged items={problemRows} render={(r) => <ProblemRow key={r.row_number} row={r} />} />
          )}
        </section>
      ) : (
        <section key="r" role="tabpanel" aria-label="Resolved rows">
          {resolvedRows.length === 0 ? (
            <p className="ie-note">No rows resolved from this file.</p>
          ) : (
            <Paged
              items={resolvedRows}
              render={(r) => <ResolvedRow key={r.row_number} row={r} />}
            />
          )}
        </section>
      )}
    </div>
  );
}
