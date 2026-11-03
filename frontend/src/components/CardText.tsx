import type { ReactNode } from "react";
import { hasCardTextMarkup, parseCardText } from "../utils/cardText";
import type { CardTextInline } from "../utils/cardText";
import "./CardText.css";

// One card-text field of the rules-text panel (.cp-text), shared by desktop
// CardPopupView, phone CardInfo, EpicActionText and so the public card pages
// (App Spec §10, "Card-text markup tokens"): `<uq>` draws the unique mark,
// `<bullet>` lists draw as a list. A field with no token renders the plain
// paragraph it always did. Pure (no window or document): the pages
// server-render and hydrate the same markup.

/** The printed unique mark: an outlined diamond around a solid one, in the
 * text colour, sized to the line. */
export function UniqueMark() {
  return (
    <svg
      className="cp-text__unique"
      viewBox="0 0 12 12"
      role="img"
      aria-label="unique"
      focusable="false"
    >
      <path
        d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M6 3.6 L8.4 6 L6 8.4 L3.6 6 Z" fill="currentColor" />
    </svg>
  );
}

function Inline({ parts }: { parts: CardTextInline[] }) {
  return <>{parts.map((p, i) => (typeof p === "string" ? p : <UniqueMark key={i} />))}</>;
}

export function CardText({
  text,
  label,
}: {
  /** The field's text, mojibake already repaired. */
  text: string | null | undefined;
  /** Leads the first line (the epic-action label). */
  label?: ReactNode;
}) {
  if (!text) return null;
  if (!hasCardTextMarkup(text)) {
    return (
      <p className="cp-text__body">
        {label}
        {text}
      </p>
    );
  }
  const blocks = parseCardText(text);
  if (blocks.length === 1 && blocks[0].kind === "paragraph") {
    return (
      <p className="cp-text__body">
        {label}
        <Inline parts={blocks[0].parts} />
      </p>
    );
  }
  const leadsWithList = blocks[0]?.kind !== "paragraph";
  return (
    <div className="cp-text__body cp-text__body--blocks">
      {label && leadsWithList ? <p className="cp-text__para">{label}</p> : null}
      {blocks.map((b, i) =>
        b.kind === "paragraph" ? (
          <p key={i} className="cp-text__para">
            {i === 0 ? label : null}
            <Inline parts={b.parts} />
          </p>
        ) : (
          <ul key={i} className="cp-text__list">
            {b.items.map((item, j) => (
              <li key={j}>
                <Inline parts={item} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
