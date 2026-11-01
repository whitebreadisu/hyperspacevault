import { useState } from "react";
import type { BaseCard } from "../utils/catalog";
import "./VariantsTooltip.css";

interface Props {
  card: BaseCard;
  /** code -> full set name, built from getSets() (e.g. "SOR" -> "Spark of Rebellion"). */
  setNameByCode: Record<string, string>;
}

/** Sort order for the tooltip lines: the base card's own set first, then
 * other sets by set code, then card_number ascending within each set. */
function sortVariants(card: BaseCard): BaseCard["variants"] {
  const numericNumber = (n: string) => {
    const v = Number(n);
    return Number.isNaN(v) ? Number.MAX_SAFE_INTEGER : v;
  };
  return [...card.variants].sort((a, b) => {
    const aBase = a.source_set_code === card.set_code ? 0 : 1;
    const bBase = b.source_set_code === card.set_code ? 0 : 1;
    if (aBase !== bBase) return aBase - bBase;
    if (a.source_set_code !== b.source_set_code) {
      return a.source_set_code.localeCompare(b.source_set_code);
    }
    return numericNumber(a.card_number) - numericNumber(b.card_number);
  });
}

export function VariantsTooltip({ card, setNameByCode }: Props) {
  const [open, setOpen] = useState(false);
  const ordered = sortVariants(card);
  const count = card.variants.length;

  return (
    <span
      className="vt-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* The hover target shows the card's variant count. aria-label keeps
          the accessible name descriptive for screen readers since the
          rendered glyph is a bare number. */}
      <button
        type="button"
        className="vt-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${count} variant${count === 1 ? "" : "s"}`}
      >
        {count}
      </button>
      {open && (
        <div className="vt-popover" role="tooltip">
          {ordered.map((v) => {
            const label = v.finish ?? v.variant_type;
            const setName = setNameByCode[v.source_set_code] ?? v.source_set_code;
            return (
              <div key={v.variant_id} className="vt-popover__row">
                {`${label} – ${v.card_number} – ${setName}`}
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}
