import { Fragment } from "react";
import { groupBy } from "../../utils/addCardsResolver";
import type { VerificationRow } from "../../utils/addCardsResolver";
import type { CardSet } from "../../api/sets";

/** BL-151 S2b (§4-REV): this is now the ONE "Verify Cards" screen for both
 * the manual (hand-typed) flow and the precon-deck flow -- previously the
 * precon flow rendered a visually-different sibling component
 * (AddCardsPreconVerification), which the owner's dev-review flagged as a
 * look-alike rather than a genuinely shared screen. Both callers now map
 * their own native data (VerificationItem for manual, ImportReport rows for
 * precon) into the same flattened VerificationRow shape before rendering
 * here -- see addCardsResolver.ts's toVerificationRow and
 * utils/preconImport.ts's verificationRowsFromReport for the two adapters. */

// "SOR — Spark of Rebellion" once the set list has loaded, else just the
// code. Labels the per-set groups in this table (BL-61 — a batch can span
// multiple sets, so verification groups by set).
function setLabel(code: string, sets: CardSet[]): string {
  const s = sets.find((x) => x.code === code);
  return s ? `${code} — ${s.name}` : code;
}

interface SectionProps {
  title: string;
  kind: "add" | "skip";
  count: number;
  items: VerificationRow[];
  sets: CardSet[];
  /** BL-151 S2b: an extra class for the precon flow's data-integrity section
   * (a left accent bar, see AddCardsModal.css's .ac-precon-verify__integrity)
   * -- undefined for every ordinary add/skip section in both flows. */
  extraClassName?: string;
}

function Section({ title, kind, count, items, sets, extraClassName }: SectionProps) {
  const groups = groupBy(items, (item) => item.groupKey);
  const colSpan = kind === "skip" ? 6 : 5;

  return (
    <section
      className={`ac-verify__section ac-verify__section--${kind}${
        extraClassName ? ` ${extraClassName}` : ""
      }`}
    >
      <div className="ac-verify__section-title">
        <span>{title}</span>
        <span className="ac-verify__section-rule" />
        <span className="ac-verify__count">
          {count} {count === 1 ? "card" : "cards"}
        </span>
      </div>
      <table className="ac-verify__table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Card#</th>
            <th>Name</th>
            <th style={{ width: 160 }}>Set</th>
            <th style={{ width: 140 }}>Finish</th>
            <th style={{ width: 100 }}>Inventory</th>
            {kind === "skip" && <th>Reason</th>}
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([groupKey, groupItems]) => (
            <Fragment key={groupKey}>
              <tr className="ac-verify__group-head">
                <td colSpan={colSpan}>{setLabel(groupKey, sets)}</td>
              </tr>
              {groupItems.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
                    {item.cardNumber}
                  </td>
                  <td className="ac-verify__name">
                    {item.name}
                    {item.subtitle && (
                      <div
                        style={{
                          fontSize: 11,
                          fontStyle: "italic",
                          color: "var(--color-text-muted)",
                          fontWeight: 400,
                        }}
                      >
                        {item.subtitle}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      color: item.isOP ? "var(--variant-op)" : "var(--color-text-muted)",
                    }}
                  >
                    {item.setText}
                  </td>
                  <td>{item.finishText}</td>
                  <td>
                    <span className="ac-dot-row">
                      <span className={`ac-dot ac-dot--${item.dotColor}`} aria-hidden="true" />
                      <span>{item.inventoryText}</span>
                    </span>
                    {/* BL-35: soft-cap over-limit rows stay in "will add" --
                        flagged here rather than moved to the skip section.
                        BL-151 S2b: precon's partially-trimmed rows reuse this
                        exact same note idiom (verificationRowsFromReport). */}
                    {item.overLimitNote && (
                      <div className="ac-verify__over-limit-note">{item.overLimitNote}</div>
                    )}
                  </td>
                  {kind === "skip" && <td className="ac-verify__skip-reason">{item.skipReason}</td>}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface Props {
  willAdd: VerificationRow[];
  willSkip: VerificationRow[];
  sets: CardSet[];
  /** BL-151 S2b: precon-only, optional -- unresolved/ambiguous ImportReport
   * rows. Should never occur in practice (BL-151 S1's data is uuid-resolved
   * at prep time, a hard invariant of the static precon data), so this
   * renders as its own prominent data-integrity section ahead of the two
   * standard ones whenever it's non-empty. Omitted entirely by the manual
   * flow, which has no such bucket. */
  unresolvedRows?: VerificationRow[];
}

export function AddCardsVerification({ willAdd, willSkip, sets, unresolvedRows }: Props) {
  return (
    <div className="ac-verify">
      {unresolvedRows && unresolvedRows.length > 0 && (
        <Section
          title="Unresolved rows — this shouldn't happen with precon data"
          kind="skip"
          count={unresolvedRows.length}
          items={unresolvedRows}
          sets={sets}
          extraClassName="ac-precon-verify__integrity"
        />
      )}
      <Section
        title="The following cards will be added to inventory"
        kind="add"
        count={willAdd.length}
        items={willAdd}
        sets={sets}
      />
      {willSkip.length > 0 && (
        <Section
          title="The following cards will not be added"
          kind="skip"
          count={willSkip.length}
          items={willSkip}
          sets={sets}
        />
      )}
    </div>
  );
}
