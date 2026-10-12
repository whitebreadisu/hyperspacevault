import { useMemo } from "react";
import { buildSetBreakdown, formatMoney } from "../../utils/completion";
import type { SetMeta } from "../../utils/completion";
import type { InventoryCard } from "../../utils/inventory";
import type { PriceMode } from "../../utils/variantScope";
import { SetLogo } from "../SetLogo";
import { Sheet, useSheetClose } from "../Sheet";
import { PriceSeg, Ticks } from "./CompletionHeader";
import { wholeMoney } from "./completionModel";

// BL-247 S1-24: Completion by set (rev4 MSheet.jsx:105-155; CSS m-rev2.css:
// 65-80, m-rev4.css:68-88). One row per base set, in display order (newest first): the set
// image (BL-257 FR3-01: laid out by its artwork -- SetLogo) and three equal facts (Playsets % + ticks, Cards, Value). Rows =
// desktop buildSetBreakdown over desktop's breakdownCards universe -- every
// narrowing except the Set facet (BL-224: the rows are the Set facet's own
// menu, so a menu never filters itself). Its own Market / Low segment (the
// header's control: drawn 34 / hit 44, same widths, never amber). A row tap
// writes the Set facet to that set and closes the sheet.

const EM_DASH = "—";

function Rows({
  rows,
  selected,
  authed,
  onPick,
}: {
  rows: ReturnType<typeof buildSetBreakdown>;
  selected: Set<string>;
  authed: boolean;
  onPick: (code: string) => void;
}) {
  const close = useSheetClose();
  if (rows.length === 0) return <div className="m-bysets__empty">No base-set cards in scope</div>;
  return (
    <div className="m-setrows">
      {rows.map((s) => {
        const on = selected.has(s.code);
        const pct = authed ? `${s.playsetPct}%` : EM_DASH;
        const cards = authed ? s.totalCopies.toLocaleString() : EM_DASH;
        const value = authed ? wholeMoney(formatMoney(s.value)) : EM_DASH;
        const complete = authed && s.playsetPct >= 100;
        return (
          <button
            key={s.code}
            type="button"
            className={"m-setrow m-setrow--r2" + (on ? " m-setrow--on" : "")}
            aria-pressed={on}
            data-set={s.code}
            aria-label={`${s.name}: playsets ${pct}, ${cards} cards, ${value}. Show this set`}
            onClick={() => {
              onPick(s.code);
              close();
            }}
          >
            <SetLogo code={s.code} box="sets" imgClassName="m-setrow__logo" />
            <span className="m-bys__fact m-bys__fact--pct">
              <span className={"m-bys__v" + (complete ? " m-bys__v--complete" : "")}>{pct}</span>
              <Ticks pct={s.playsetPct} authed={authed} narrow />
            </span>
            <span className="m-bys__fact">
              <span className="m-bys__v">{cards}</span>
            </span>
            <span className="m-bys__fact">
              <span className="m-bys__v">{value}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  breakdown: InventoryCard[];
  allCount: number;
  orderedBaseSets: SetMeta[];
  selected: Set<string>;
  isAuthenticated: boolean;
  priceKind: PriceMode;
  onPriceKind: (m: PriceMode) => void;
  onPickSet: (code: string) => void;
  onClose: () => void;
}

export function SetsSheet({
  breakdown,
  allCount,
  orderedBaseSets,
  selected,
  isAuthenticated,
  priceKind,
  onPriceKind,
  onPickSet,
  onClose,
}: Props) {
  const rows = useMemo(
    () => buildSetBreakdown(breakdown, orderedBaseSets, priceKind),
    [breakdown, orderedBaseSets, priceKind]
  );
  const otherFilters = breakdown.length < allCount;
  return (
    <Sheet
      title="Completion by set"
      labelId="sheet-sets"
      className="m-sheet-layer--sets"
      onClose={onClose}
    >
      <div className="m-bysets">
        <div className="m-bysets__top">
          <span className="m-bysets__note">
            {otherFilters ? "Rows follow your other filters" : "Your whole collection"}
          </span>
          <PriceSeg mode={priceKind} onChange={onPriceKind} />
        </div>
        <div className="m-bysets__cols" aria-hidden="true">
          <span className="m-bysets__colset">Set</span>
          <span>Playsets</span>
          <span>Cards</span>
          <span>Value</span>
        </div>
        <Rows rows={rows} selected={selected} authed={isAuthenticated} onPick={onPickSet} />
      </div>
    </Sheet>
  );
}
