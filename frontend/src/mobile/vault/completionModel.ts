import { computePanelMetrics } from "../../utils/completion";
import type { PanelMetrics } from "../../utils/completion";
import type { InventoryCard } from "../../utils/inventory";
import type { PriceMode } from "../../utils/variantScope";

// BL-247 S1-23: the completion header's rules, as desktop InventorySummary
// (BL-163 / BL-223): the Totals switch shows only while the list is narrowed
// AND the caller is signed in; hidden, it always reads Filtered; the amber
// ring applies only while the switch shows AND reads Filtered. Metrics =
// computePanelMetrics over the filtered or the whole list.

export type TotalsScope = "filtered" | "all";

export interface CompletionView {
  metrics: PanelMetrics;
  showScopeToggle: boolean;
  effectiveScope: TotalsScope;
  /** desktop narrowedFiltered: the amber ring + the strip's funnel. */
  narrowedFiltered: boolean;
}

export function completionView(args: {
  filtered: InventoryCard[];
  all: InventoryCard[];
  baseSetCodes: Set<string>;
  priceKind: PriceMode;
  narrowed: boolean;
  isAuthenticated: boolean;
  scope: TotalsScope;
}): CompletionView {
  const showScopeToggle = args.narrowed && args.isAuthenticated;
  const effectiveScope: TotalsScope = showScopeToggle ? args.scope : "filtered";
  const cards = effectiveScope === "all" ? args.all : args.filtered;
  return {
    metrics: computePanelMetrics(cards, args.baseSetCodes, args.priceKind),
    showScopeToggle,
    effectiveScope,
    narrowedFiltered: showScopeToggle && effectiveScope === "filtered",
  };
}

/** Header money: desktop formatMoney without the cents (rev4 MSummary). */
export function wholeMoney(formatted: string): string {
  return formatted.replace(/\.\d\d$/, "");
}
