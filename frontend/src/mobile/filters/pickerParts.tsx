import { useEffect } from "react";
import type { ReactNode } from "react";
import type { SelectOption } from "../../utils/filters";
import { MIcon } from "../icons";
import { SWUButton } from "../../components/SWUButton";
import { Sheet, useSheetClose } from "../Sheet";
import { optionState } from "./filterModel";

// BL-248 stage 2B-2: the pickers' shared parts (rev4 MFilters.jsx Chip /
// CheckRow / PickerSheet frame, MFilterPickers.jsx FacetPickerSheet). A
// picker is a Sheet over Filters: X top-right, the facet in a scrolling
// body, Done in a pinned foot (the shared Sheet has no footer slot, so the
// body splits in CSS exactly as the Filters sheet does).

/** Chip: the .m-chip idiom, faceted (inert = "(0)" in the name, 0.38; an
 * inert value is tappable only while selected, to remove it). */
export function FChip({
  opt,
  selected,
  onToggle,
  className,
  children,
}: {
  opt: SelectOption;
  selected: Set<string>;
  onToggle: (value: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const s = optionState(opt, selected);
  return (
    <button
      type="button"
      className={
        "m-chip m-fchip" +
        (s.on ? " m-chip--on" : "") +
        (s.inert ? " m-fchip--inert" : "") +
        (className ? " " + className : "")
      }
      data-fv={opt.value}
      aria-label={opt.label}
      aria-pressed={s.on}
      disabled={s.blocked}
      onClick={s.blocked ? undefined : () => onToggle(opt.value)}
    >
      {children ?? opt.label}
    </button>
  );
}

/** Check row: a 48 px switch row (rev4 CheckRow). `teaser` = desktop's
 * anonymous pl-toggle (greyed, aria-disabled, still tappable). */
export function CheckRow({
  on,
  inert = false,
  label,
  fv,
  onClick,
  sub,
  className,
  children,
}: {
  on: boolean;
  inert?: boolean;
  label: string;
  fv: string;
  onClick: () => void;
  sub?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const blocked = inert && !on;
  return (
    <button
      type="button"
      className={
        "m-check m-fcheck" +
        (on ? " m-check--on" : "") +
        (inert ? " m-fcheck--inert" : "") +
        (className ? " " + className : "")
      }
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-fv={fv}
      disabled={blocked}
      onClick={blocked ? undefined : onClick}
    >
      <span className="m-check__box">{on ? <MIcon name="check" size={16} /> : null}</span>
      <span className="m-fcheck__text">{children}</span>
      {sub ? <span className="m-fcheck__sub">{sub}</span> : null}
    </button>
  );
}

/** "Name (0)" for an inert value (desktop facetedOptions' label). */
export const zero = (s: string, inert: boolean) => (inert ? `${s} (0)` : s);

/** Stacked sheets: Escape closes the top one only. The shared Sheet listens
 * on window (bubble) in every open layer, so one Escape would close Filters
 * and its picker together; this capture-phase listener on the top layer
 * runs first, stops the event and closes just this layer (leave motion). */
function EscapeClosesTop() {
  const close = useSheetClose();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);
  return null;
}

function DoneButton() {
  const close = useSheetClose();
  return (
    <SWUButton size="md" onClick={close} className="m-picker__done">
      Done
    </SWUButton>
  );
}

/** The picker frame: title, "n selected" sub, scroll body, Done foot. */
export function PickerFrame({
  id,
  title,
  selected,
  className,
  onClose,
  children,
}: {
  id: string;
  title: string;
  selected: number;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet
      title={title}
      sub={selected ? `${selected} selected` : null}
      labelId={"sheet-fpick-" + id}
      className={"m-sheet-layer--picker" + (className ? " " + className : "")}
      onClose={onClose}
    >
      <EscapeClosesTop />
      <div className="m-fpick__scroll" data-fpick-body={id}>
        {children}
      </div>
      <div className="m-fpick__foot">
        <DoneButton />
      </div>
    </Sheet>
  );
}
