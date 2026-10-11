import { useSyncExternalStore } from "react";
import { loadPriceKind, savePriceKind } from "../utils/variantScope";
import type { PriceMode } from "../utils/variantScope";

// BL-248 S2-02: one Market / Low for the whole phone app -- desktop's
// persisted price kind (loadPriceKind / savePriceKind, key
// swu.cardsValue.kind) behind a tiny store, so the card detail's toggle and
// the Vault (which stays mounted under it) move together (rev4's shared
// priceMode, check step card-collapsed-low).

let kind: PriceMode | null = null;
const subs = new Set<() => void>();

function get(): PriceMode {
  if (kind == null) kind = loadPriceKind();
  return kind;
}

export function setPriceKind(k: PriceMode): void {
  savePriceKind(k);
  kind = k;
  subs.forEach((f) => f());
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function usePriceKind(): [PriceMode, (k: PriceMode) => void] {
  const k = useSyncExternalStore(subscribe, get, get);
  return [k, setPriceKind];
}

/** Test seam: re-read storage on next use. */
export function resetPriceKindForTest(): void {
  kind = null;
}
