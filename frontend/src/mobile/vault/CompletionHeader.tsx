import { formatMoney } from "../../utils/completion";
import type { StripSummary } from "./VaultHeader";

// BL-247: the collection panel inside the expanded Vault header (rev4
// MHome.jsx:25-61 MSummary; CSS m-layout.css:421-439). Stage 1a-s builds the
// static three-fact body the header collapse is measured against; S1-23
// (stage 1c) wires computePanelMetrics, the Totals Filtered / All toggle, the
// Market / Low segment and the By set entry.

interface Props {
  summary: StripSummary;
  unique: number;
}

export function CompletionHeader({ summary, unique }: Props) {
  const filled = Math.round(summary.pct / 10);
  return (
    <div className="m-summary">
      <div className="m-summary__inner">
        <div className="m-summary__head">
          <span className="m-summary__label">Your collection</span>
        </div>
        <div className="m-summary__body">
          <span className="m-metric">
            <span className="m-metric__label">Playsets</span>
            <span className="m-metric__value">{summary.pct}%</span>
            <span className="inv-summary__ticks m-metric__ticks">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className={"inv-summary__tick" + (i < filled ? " inv-summary__tick--filled" : "")}
                />
              ))}
            </span>
          </span>
          <span className="m-metric">
            <span className="m-metric__label">Cards owned</span>
            <span className="m-metric__value">{summary.copies}</span>
            <span className="m-metric__sub">{unique} unique</span>
          </span>
          <span className="m-metric">
            <span className="m-metric__label">Value</span>
            <span className="m-metric__value m-metric__value--money">
              {formatMoney(summary.value).replace(/\.\d\d$/, "")}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
