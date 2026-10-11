import type { PanelMetrics } from "../../utils/completion";
import { formatMoney } from "../../utils/completion";
import type { PriceMode } from "../../utils/variantScope";
import { MIcon } from "../icons";
import { wholeMoney } from "./completionModel";
import type { TotalsScope } from "./completionModel";
import "./completion.css";

// BL-247 S1-23: the collection panel inside the expanded Vault header (rev4
// MHome.jsx:12-62 MScopeToggle + MSummary; CSS m-layout.css:421-445,
// m-rev2.css:33-39, m-rev3.css:89-114). Head: "Your collection", or -- while
// the list is narrowed and the caller signed in -- "Totals" with desktop's
// Filtered / All switch (amber while Filtered, with the amber ring); the
// Market / Low segment at the right (desktop's persisted price kind). Both
// segments are drawn 34 px with 44 px targets (R3-2). Body: Playsets % + ten
// ticks, Cards owned + unique, Value (+ unpriced) and "By set", one button
// that opens the by-set sheet (S1-24). Signed out: em dashes and empty
// ticks, "— unique", and the body opens nothing (desktop InventorySummary's
// signed-out rules).

const EM_DASH = "—";

/** The Market / Low segment (rev4 MPriceMode, .m-seg--sm) -- the header's
 * and the by-set sheet's (same widths, R4-11). Never amber. */
export function PriceSeg({
  mode,
  onChange,
}: {
  mode: PriceMode;
  onChange: (m: PriceMode) => void;
}) {
  return (
    <span className="m-seg m-seg--sm m-priceseg" role="group" aria-label="Price">
      {(["market", "low"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={"m-seg__btn" + (mode === m ? " m-seg__btn--on" : "")}
          aria-pressed={mode === m}
          onClick={(e) => {
            e.stopPropagation();
            onChange(m);
          }}
        >
          {m === "market" ? "Market" : "Low"}
        </button>
      ))}
    </span>
  );
}

function ScopeToggle({
  scope,
  onChange,
}: {
  scope: TotalsScope;
  onChange: (s: TotalsScope) => void;
}) {
  const filtered = scope === "filtered";
  return (
    <span
      className={"m-seg m-seg--sm m-scope" + (filtered ? " m-seg--amber" : "")}
      role="group"
      aria-label="Totals"
    >
      {(
        [
          ["filtered", "Filtered"],
          ["all", "All"],
        ] as const
      ).map(([k, l]) => (
        <button
          key={k}
          type="button"
          className={"m-seg__btn" + (scope === k ? " m-seg__btn--on" : "")}
          aria-pressed={scope === k}
          aria-label={
            k === "filtered" ? "Totals: filtered, matching the list" : "Totals: all, every card"
          }
          onClick={(e) => {
            e.stopPropagation();
            onChange(k);
          }}
        >
          {l}
        </button>
      ))}
    </span>
  );
}

export function Ticks({ pct, authed, narrow }: { pct: number; authed: boolean; narrow?: boolean }) {
  const filled = authed ? Math.round(pct / 10) : 0;
  const complete = authed && pct >= 100;
  return (
    <span
      className={
        "inv-summary__ticks" +
        (narrow ? " m-ticks--narrow" : " m-metric__ticks") +
        (narrow && complete ? " m-ticks--complete" : "")
      }
      aria-hidden="true"
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={"inv-summary__tick" + (i < filled ? " inv-summary__tick--filled" : "")}
        />
      ))}
    </span>
  );
}

interface Props {
  metrics: PanelMetrics;
  isAuthenticated: boolean;
  showScopeToggle: boolean;
  scope: TotalsScope;
  narrowedFiltered: boolean;
  onScope: (s: TotalsScope) => void;
  priceKind: PriceMode;
  onPriceKind: (m: PriceMode) => void;
  onOpenSets: () => void;
}

export function CompletionHeader({
  metrics,
  isAuthenticated: authed,
  showScopeToggle,
  scope,
  narrowedFiltered,
  onScope,
  priceKind,
  onPriceKind,
  onOpenSets,
}: Props) {
  const pct = authed ? `${metrics.playsetPct}%` : EM_DASH;
  const copies = authed ? metrics.totalCopies.toLocaleString() : EM_DASH;
  const value = authed ? wholeMoney(formatMoney(metrics.value)) : EM_DASH;
  const facts = (
    <>
      <span className="m-metric">
        <span className="m-metric__label">Playsets</span>
        <span className="m-metric__value">{pct}</span>
        <Ticks pct={metrics.playsetPct} authed={authed} />
      </span>
      <span className="m-metric">
        <span className="m-metric__label">Cards owned</span>
        <span className="m-metric__value">{copies}</span>
        <span className="m-metric__sub">
          {authed ? metrics.uniqueOwned.toLocaleString() : EM_DASH} unique
        </span>
      </span>
      <span className="m-metric">
        <span className="m-metric__label">Value</span>
        <span className="m-metric__value m-metric__value--money">{value}</span>
        {authed && metrics.unpricedCount > 0 ? (
          <span className="m-metric__sub">{metrics.unpricedCount} unpriced</span>
        ) : null}
      </span>
    </>
  );
  return (
    <div className={"m-summary" + (narrowedFiltered ? " m-summary--amber" : "")}>
      <div className="m-summary__inner">
        <div className="m-summary__head">
          {showScopeToggle ? (
            <span className="m-summary__scope">
              <span className="m-summary__label">Totals</span>
              <ScopeToggle scope={scope} onChange={onScope} />
            </span>
          ) : (
            <span className="m-summary__label">Your collection</span>
          )}
          <PriceSeg mode={priceKind} onChange={onPriceKind} />
        </div>
        {authed ? (
          <button
            type="button"
            className="m-summary__body"
            onClick={onOpenSets}
            aria-label={`Completion by set. Playsets ${pct}, ${copies} cards owned, value ${value}`}
          >
            {facts}
            <span className="m-summary__by">
              By set <MIcon name="fwd" size={16} />
            </span>
          </button>
        ) : (
          <div className="m-summary__body">
            {facts}
            {/* Desktop: the breakdown opens only when signed in; the row
                keeps its height so the header does not change size. */}
            <span className="m-summary__by m-summary__by--off" aria-hidden="true">
              By set <MIcon name="fwd" size={16} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
