import type { VariantDetail } from "../../api/baseCards";
import { PriceHistoryPanel } from "./PriceHistoryPanel";

/** The two PriceHistoryPanel mount points CardPopup.tsx owns: the always-on
 * compact embed under the printings rail and the expand-below full panel.
 * Presentational wrappers only: CardPopup.tsx (the shell) owns
 * `historyExpanded` because its Escape routing reads it, not just this JSX. */

/** The COMPACT history panel is permanently embedded under the printing rows
 * and re-renders on selection because it is keyed off `variant` directly.
 * Rendered by CardPopupRail.tsx inside the rail's own scroll region
 * (`.cp-rail`). */
export function CardPopupCompactHistory({
  baseCardId,
  variant,
  onExpand,
}: {
  baseCardId: number;
  variant: VariantDetail;
  onExpand: () => void;
}) {
  return (
    <div className="cp-rail__history">
      <PriceHistoryPanel baseCardId={baseCardId} variant={variant} compact onExpand={onExpand} />
    </div>
  );
}

/** The FULL history panel appends BELOW the popup's 3-column grid (a sibling
 * inside `.cp-modal`) once the compact embed's expand affordance is used.
 * Never an overlay; closing it (× or Escape) returns to compact-only, see
 * CardPopup.tsx's Escape-routing effect. */
export function CardPopupExpandedHistory({
  baseCardId,
  variant,
  onClose,
}: {
  baseCardId: number;
  variant: VariantDetail;
  onClose: () => void;
}) {
  return (
    <div className="cp-history-expand">
      <PriceHistoryPanel
        baseCardId={baseCardId}
        variant={variant}
        compact={false}
        onClose={onClose}
      />
    </div>
  );
}
