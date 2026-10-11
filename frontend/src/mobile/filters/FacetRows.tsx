import { RarityBadge } from "../../components/RarityBadge";
import type { SelectOption } from "../../utils/filters";
import { MIcon } from "../icons";
import { optionState } from "./filterModel";
import type { RowChip } from "./filterModel";

// BL-248 S2-13 (R4-3 compact rows; rev4 MFilters.jsx FacetRow / RarityRow,
// m-rev4-b.css). One row per facet: a full-row button under everything opens
// the facet's picker; the label (86 px column), placeholder and chevron let
// taps through to it; each selected value is a 44 px chip drawn 30 px on top
// whose tap removes that value. Nothing selected = desktop's placeholder.

export type FacetId = "set" | "collection" | "finish";

interface FacetRowProps {
  id: FacetId;
  label: string;
  placeholder: string;
  chips: RowChip[];
  onOpen: () => void;
  onRemove: (v: string) => void;
}

export function FacetRow({ id, label, placeholder, chips, onOpen, onRemove }: FacetRowProps) {
  const summary = chips.map((c) => c.name).join(", ");
  return (
    <section
      className={"m-fgroup m-frow4" + (chips.length ? " m-frow4--on" : "")}
      data-facet={id}
      aria-label={label}
    >
      <button
        type="button"
        className="m-frow4__open"
        data-fpick={id}
        aria-haspopup="dialog"
        aria-label={`${label}: ${summary || placeholder}. Choose`}
        onClick={onOpen}
      />
      <span className="m-frow4__k" aria-hidden="true">
        {label}
      </span>
      <span className="m-frow4__chips">
        {chips.length ? (
          chips.map((c) => (
            <button
              key={c.v}
              type="button"
              className={
                "m-fsel" + (c.logo ? " m-fsel--logo" : "") + (c.scoped ? " m-fsel--scoped" : "")
              }
              data-fv={c.v}
              aria-label={`Remove ${c.name}`}
              onClick={() => onRemove(c.v)}
            >
              <span className="m-fsel__in">
                {c.logo ? (
                  <img className={"m-fsel__logo m-fsel__logo--" + c.v} src={c.logo} alt="" />
                ) : (
                  <span className="m-fsel__t">{c.text}</span>
                )}
                <MIcon name="close" size={12} className="m-fsel__x" />
              </span>
            </button>
          ))
        ) : (
          <span className="m-frow4__ph" aria-hidden="true">
            {placeholder}
          </span>
        )}
      </span>
      <MIcon name="fwd" size={18} className="m-frow4__chev" />
    </section>
  );
}

/** Rarity stays inline: one row of the five badges (icon only; the name --
 * with "(0)" when it has no match under the other filters -- is the
 * aria-label), faceted as desktop (BL-70). */
export function RarityRow({
  options,
  selected,
  onToggle,
}: {
  options: SelectOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <section className="m-fgroup m-frow4 m-frow4--rarity" data-facet="rarity" aria-label="Rarity">
      <span className="m-frow4__k" aria-hidden="true">
        Rarity
      </span>
      <div className="m-frow4__rar">
        {options.map((o) => {
          const s = optionState(o, selected);
          return (
            <button
              key={o.value}
              type="button"
              className={
                "m-chip m-fchip m-fchip--rar" +
                (s.on ? " m-chip--on" : "") +
                (s.inert ? " m-fchip--inert" : "")
              }
              data-fv={o.value}
              aria-label={o.label}
              aria-pressed={s.on}
              disabled={s.blocked}
              onClick={s.blocked ? undefined : () => onToggle(o.value)}
            >
              <RarityBadge rarity={o.value} size={24} iconOnly />
            </button>
          );
        })}
      </div>
    </section>
  );
}
