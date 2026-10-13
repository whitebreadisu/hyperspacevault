import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLimits } from "../../context/LimitsContext";
import { DEFAULT_SORT_STATE, nextSortState } from "../../utils/cardSort";
import type { SortColumn, SortState } from "../../utils/cardSort";
import type { FilterState } from "../../utils/filters";
import type { InventoryCard } from "../../utils/inventory";
import type { PriceMode } from "../../utils/variantScope";
import type { ViewModeChangedMode } from "../../analytics/analytics";
import { capturePhone, phoneViewMode } from "../phoneAnalytics";
import { usePriceKind } from "../priceKind";
import { useVaultData } from "./useVaultData";
import {
  buildVaultList,
  freshFilterState,
  phoneSortState,
  SCOPE_VALUES,
  withFilters,
  withScope,
} from "./vaultModel";
import type { CollectionToggles, VaultFilterState, VaultList } from "./vaultModel";

// BL-247 S1-22 (+ S1-16 scope, S1-17 sort, S1-18 view): the Vault's view
// state. Filters, search, scope and sort are plain React state -- never
// persisted, as desktop (scope is transient by definition; sort is
// session-only plain state in CardsPage). View + size are remembered for the
// browser session (sessionStorage; desktop does not persist its view mode, a
// session is the tiebreaker-compatible default). Market / Low is desktop's
// persisted price kind (loadPriceKind / savePriceKind).

export type ViewMode = "rows" | "gallery";
export type RowSize = "none" | "sm" | "md" | "lg";
export type GallerySize = 1 | 2 | 3;
export const ROW_SIZES: RowSize[] = ["none", "sm", "md", "lg"];

interface ViewPrefs {
  view: ViewMode;
  rowSize: RowSize;
  gallerySize: GallerySize;
}

const VIEW_KEY = "hsv.m.vaultView";
const DEFAULT_PREFS: ViewPrefs = { view: "rows", rowSize: "md", gallerySize: 2 };

function loadPrefs(): ViewPrefs {
  try {
    const raw = JSON.parse(
      window.sessionStorage.getItem(VIEW_KEY) ?? "null"
    ) as Partial<ViewPrefs> | null;
    if (!raw) return DEFAULT_PREFS;
    return {
      view: raw.view === "gallery" ? "gallery" : "rows",
      rowSize: ROW_SIZES.includes(raw.rowSize as RowSize) ? (raw.rowSize as RowSize) : "md",
      gallerySize: [1, 2, 3].includes(raw.gallerySize as number)
        ? (raw.gallerySize as GallerySize)
        : 2,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** S1-27: view_mode_changed.mode for a view + size pair. */
export function viewModeOf(p: ViewPrefs): ViewModeChangedMode {
  return p.view === "gallery" ? `gallery_${p.gallerySize}` : `rows_${p.rowSize}`;
}

function savePrefs(p: ViewPrefs): void {
  try {
    window.sessionStorage.setItem(VIEW_KEY, JSON.stringify(p));
  } catch {
    /* best-effort */
  }
}

export interface VaultView extends VaultList {
  state: VaultFilterState;
  sort: SortState;
  prefs: ViewPrefs;
  priceKind: PriceMode;
  setQuery: (q: string) => void;
  /** S2's Filters sheet writes facets through this (scope rule applied). */
  setFilters: (next: FilterState) => void;
  setToggles: (next: CollectionToggles) => void;
  setScope: (scope: string | null) => void;
  clearAll: () => void;
  pickSort: (column: SortColumn) => void;
  setView: (view: ViewMode) => void;
  setRowSize: (s: RowSize) => void;
  setGallerySize: (s: GallerySize) => void;
  setPriceKind: (k: PriceMode) => void;
}

/** Pure core, for tests and the hook: the vault state over `cards`. */
export function useVaultViewOver(
  cards: InventoryCard[],
  setOrder: Record<string, string | null>,
  params: Record<string, string> = {}
): VaultView {
  const { limits } = useLimits();
  const [state, setState] = useState<VaultFilterState>(freshFilterState);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT_STATE);
  const [prefs, setPrefs] = useState<ViewPrefs>(loadPrefs);
  // S2-02: the shared phone price kind (card detail moves it too).
  const [priceKind, setPriceKindShared] = usePriceKind();

  const updatePrefs = useCallback((patch: Partial<ViewPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);
  // S1-27: a user's view / size pick reports the new mode when it changed
  // (desktop InventorySummary: only a genuine switch is captured).
  const pickPrefs = useCallback(
    (patch: Partial<ViewPrefs>) => {
      const next = { ...prefs, ...patch };
      if (viewModeOf(next) !== viewModeOf(prefs)) phoneViewMode(viewModeOf(next));
      updatePrefs(patch);
    },
    [prefs, updatePrefs]
  );

  // Review / deep-link params (rev4 MVault.jsx:420-447): ?set= writes the Set
  // facet, ?finish= scopes (one of the 14 values), ?q= searches, ?view= /
  // ?size= / ?gsize= pick the view. Applied once per distinct param set.
  const applied = useRef<string | null>(null);
  // F6: a query set by the ?q= param is a deep link, not a search; its
  // search_performed is skipped until the user types.
  const paramQuery = useRef<string | null>(null);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (applied.current === key) return;
    applied.current = key;
    const p = JSON.parse(key) as Record<string, string>;
    setState((s0) => {
      let s = s0;
      if (p.set) {
        const codes = p.set.split(",").filter(Boolean);
        s = withFilters(s, { ...s.filters, set: new Set(codes) });
      }
      if (p.finish && SCOPE_VALUES.includes(p.finish)) s = withScope(s, p.finish);
      if (p.q != null) {
        paramQuery.current = p.q;
        s = { ...s, query: p.q };
      }
      return s;
    });
    const patch: Partial<ViewPrefs> = {};
    if (p.view) patch.view = p.view === "gallery" ? "gallery" : "rows";
    if (p.size && ROW_SIZES.includes(p.size as RowSize)) patch.rowSize = p.size as RowSize;
    if (p.gsize && ["1", "2", "3"].includes(p.gsize))
      patch.gallerySize = Number(p.gsize) as GallerySize;
    if (Object.keys(patch).length) updatePrefs(patch);
  }, [key, updatePrefs]);

  const list = useMemo(
    () => buildVaultList(cards, state, sort, { setOrder, priceKind, limits }),
    [cards, state, sort, setOrder, priceKind, limits]
  );

  // S1-27: search_performed as desktop CardsPage -- 400 ms after the last
  // keystroke, never for an empty box; length + result count only.
  const resultsRef = useRef(0);
  useEffect(() => {
    resultsRef.current = list.list.length;
  }, [list.list.length]);
  useEffect(() => {
    if (state.query.length === 0) return undefined;
    if (state.query === paramQuery.current) return undefined;
    const t = setTimeout(() => {
      capturePhone("search_performed", {
        query_length: state.query.length,
        results_count: resultsRef.current,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [state.query]);

  return {
    ...list,
    state,
    sort,
    prefs,
    priceKind,
    setQuery: useCallback((query: string) => {
      paramQuery.current = null;
      setState((s) => ({ ...s, query }));
    }, []),
    setFilters: useCallback((next: FilterState) => setState((s) => withFilters(s, next)), []),
    setToggles: useCallback(
      (toggles: CollectionToggles) => setState((s) => ({ ...s, toggles })),
      []
    ),
    setScope: useCallback((scope: string | null) => {
      capturePhone("finish_scope_changed", { finish: scope ?? "all" });
      setState((s) => withScope(s, scope));
    }, []),
    clearAll: useCallback(() => {
      capturePhone("filters_cleared");
      setState(freshFilterState());
    }, []),
    pickSort: useCallback(
      (column: SortColumn) => {
        // FR5-05: the phone has no Set or Variants sort; the only way in
        // (pickSort is the one writer of this state -- no URL parameter,
        // nothing persisted) maps either onto "Set | #" ascending, and the
        // event reports what was applied.
        const next = phoneSortState(nextSortState(sort, column));
        capturePhone("sort_changed", { column: next.column, direction: next.direction });
        setSort(next);
      },
      [sort]
    ),
    setView: useCallback((view: ViewMode) => pickPrefs({ view }), [pickPrefs]),
    setRowSize: useCallback((rowSize: RowSize) => pickPrefs({ rowSize }), [pickPrefs]),
    setGallerySize: useCallback(
      (gallerySize: GallerySize) => pickPrefs({ gallerySize }),
      [pickPrefs]
    ),
    setPriceKind: setPriceKindShared,
  };
}

/** The Vault screen's view over the shared data instance (S1-12). */
export function useVaultView(params: Record<string, string> = {}): VaultView {
  const { cards, setOrder } = useVaultData();
  return useVaultViewOver(cards, setOrder, params);
}
