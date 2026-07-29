import type { VariantDetail } from "../../api/baseCards";
import { PriceHistoryPanel } from "./PriceHistoryPanel";

/** BL-155 decomposition: the two PriceHistoryPanel mount points CardPopup.tsx
 * owns -- the always-on compact embed under the printings rail, and the
 * expand-below full panel -- pulled out verbatim into their own wrappers.
 * CardPopup.tsx (the shell) still owns `historyExpanded` itself (it's read by
 * the shell's own Escape-routing logic, not just used to gate this JSX), so
 * these are presentational wrappers only, not stateful. */

/** BL-140 design-conformance pass: chartPlacement=under-printings -- the
 * COMPACT history panel is permanently embedded under the printing rows,
 * re-rendering on selection since it's keyed off `variant` directly. Rendered
 * by CardPopupRail.tsx, inside the rail's own scroll region (`.cp-rail`). */
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

/** BL-140 design-conformance pass: historyEmbed=expand-below -- the FULL
 * history panel appends BELOW the popup's 3-column grid (a sibling inside
 * `.cp-modal`) once the compact embed's ⤢ affordance is used. Never an
 * overlay; closing it (× or Escape) returns to compact-only, see
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
