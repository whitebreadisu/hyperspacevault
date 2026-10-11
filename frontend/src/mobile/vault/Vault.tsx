import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { orderSetCodes } from "../../utils/catalog";
import type { SetMeta } from "../../utils/completion";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { publishNav } from "../card/navList";
import { go } from "../router";
import { Sheet } from "../Sheet";
import { CompletionHeader } from "./CompletionHeader";
import { completionView } from "./completionModel";
import type { TotalsScope } from "./completionModel";
import { ScopeSheet } from "./ScopeChip";
import { SetsSheet } from "./SetsSheet";
import { SortSheet } from "./SortSheet";
import { useVaultData } from "./useVaultData";
import { useVaultView } from "./useVaultView";
import { VaultList } from "./VaultList";
import { VaultScreen } from "./VaultScreen";
import type { StripSummary } from "./VaultHeader";
import { VaultStatus } from "./VaultStatus";
import "./vault.css";

// BL-247 stage 1b: the Vault screen's contents -- the status rows (S1-14),
// the list (S1-19 / S1-20 / S1-21), the scope / sort / filters sheets
// (S1-16 / S1-17; Filters is a ComingSoon sheet until S2) and search mode
// (S1-15) -- inside the 1a-s header frame (VaultScreen). Stage 1c: the
// completion panel + strip readout (S1-23) and the by-set sheet (S1-24).

type SheetName = "scope" | "sort" | "filters" | "sets" | null;
const SHEETS: SheetName[] = ["scope", "sort", "filters", "sets"];

interface Props {
  params: Record<string, string>;
  account: ReactNode;
  unread: boolean;
  onOpenChooser: () => void;
  onOpenFeedback: () => void;
  /** Search mode collapses the bottom bar too (MobileApp owns the bar). */
  onSearchMode: (on: boolean) => void;
}

export function Vault({
  params,
  account,
  unread,
  onOpenChooser,
  onOpenFeedback,
  onSearchMode,
}: Props) {
  const { isAuthenticated, loading, sets, setOrder, setNameByCode } = useVaultData();
  const vv = useVaultView(params);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searching, setSearching] = useState(false);
  const asSheet = (v: string | undefined): SheetName =>
    SHEETS.includes(v as SheetName) ? (v as SheetName) : null;
  const [sheet, setSheet] = useState<SheetName>(() => asSheet(params.sheet));
  // ?sheet= also opens when it arrives by an in-app hash change (the screen
  // does not remount): adjust state during render when the param changes.
  const [seenSheetParam, setSeenSheetParam] = useState(params.sheet);
  if (params.sheet !== seenSheetParam) {
    setSeenSheetParam(params.sheet);
    if (asSheet(params.sheet)) setSheet(asSheet(params.sheet));
  }

  // S1-23 / S1-24: desktop CardsPage's completion universe (BL-163) -- the
  // base sets by is_base_set, release-ordered for the by-set rows.
  const baseSetCodes = useMemo(
    () => new Set(sets.filter((s) => s.is_base_set).map((s) => s.code)),
    [sets]
  );
  const orderedBaseSets = useMemo<SetMeta[]>(
    () =>
      orderSetCodes(
        sets.filter((s) => s.is_base_set).map((s) => s.code),
        setOrder
      ).map((code) => ({ code, name: setNameByCode[code] ?? code })),
    [sets, setOrder, setNameByCode]
  );
  // Desktop InventorySummary: the Totals switch is plain state, Filtered first.
  const [totals, setTotals] = useState<TotalsScope>("filtered");
  const comp = useMemo(
    () =>
      completionView({
        filtered: vv.list,
        all: vv.all,
        baseSetCodes,
        priceKind: vv.priceKind,
        narrowed: vv.narrowed,
        isAuthenticated,
        scope: totals,
      }),
    [vv.list, vv.all, baseSetCodes, vv.priceKind, vv.narrowed, isAuthenticated, totals]
  );
  const summary: StripSummary = {
    pct: comp.metrics.playsetPct,
    copies: comp.metrics.totalCopies,
    value: comp.metrics.value,
    narrowed: comp.narrowedFiltered,
    authed: isAuthenticated,
  };
  const panel = (
    <CompletionHeader
      metrics={comp.metrics}
      isAuthenticated={isAuthenticated}
      showScopeToggle={comp.showScopeToggle}
      scope={comp.effectiveScope}
      narrowedFiltered={comp.narrowedFiltered}
      onScope={setTotals}
      priceKind={vv.priceKind}
      onPriceKind={vv.setPriceKind}
      onOpenSets={() => setSheet("sets")}
    />
  );

  useEffect(() => {
    onSearchMode(searching);
  }, [searching, onSearchMode]);
  useEffect(() => () => onSearchMode(false), [onSearchMode]);

  // S2-01: the detail browses the list it was opened from (rev4 M.navList,
  // set on the tap): its ids in the current order, whether it is narrowed
  // (amber "n of m"), and the scope (it picks each card's default printing).
  const openCard = useCallback(
    (card: InventoryCard, variant: InventoryVariant | null) => {
      publishNav({
        ids: vv.list.map((c) => c.base_card_id),
        narrowed: vv.narrowed,
        scope: vv.state.scope,
      });
      go("#/card/" + card.base_card_id + (variant ? "?v=" + variant.variant_id : ""));
    },
    [vv.list, vv.narrowed, vv.state.scope]
  );
  const closeSheet = useCallback(() => setSheet(null), []);

  return (
    <>
      <VaultScreen
        summary={summary}
        panel={panel}
        account={account}
        unread={unread}
        onOpenChooser={onOpenChooser}
        onOpenFeedback={onOpenFeedback}
        startCollapsed={params.collapsed === "1"}
        searching={searching}
        onScrollEl={setScrollEl}
        listKey={vv.prefs.view}
        controls={
          <VaultStatus
            vv={vv}
            searchRef={searchRef}
            onSearchFocus={() => setSearching(true)}
            onSearchBlur={() => setSearching(false)}
            onOpenFilters={() => setSheet("filters")}
            onOpenScope={() => setSheet("scope")}
            onOpenSort={() => setSheet("sort")}
            initialSizesOpen={params.sizes === "1"}
          />
        }
      >
        <VaultList
          scrollEl={scrollEl}
          list={vv.list}
          view={vv.prefs.view}
          rowSize={vv.prefs.rowSize}
          gallerySize={vv.prefs.gallerySize}
          scope={vv.state.scope}
          finishes={vv.state.filters.finish}
          priceKind={vv.priceKind}
          isAuthenticated={isAuthenticated}
          loading={loading}
          onOpenCard={openCard}
        />
      </VaultScreen>
      {sheet === "scope" ? (
        <ScopeSheet scope={vv.state.scope} onPick={vv.setScope} onClose={closeSheet} />
      ) : null}
      {sheet === "sort" ? (
        <SortSheet sort={vv.sort} onPick={vv.pickSort} onClose={closeSheet} />
      ) : null}
      {sheet === "sets" ? (
        <SetsSheet
          breakdown={vv.breakdown}
          allCount={vv.all.length}
          orderedBaseSets={orderedBaseSets}
          selected={vv.state.filters.set}
          isAuthenticated={isAuthenticated}
          priceKind={vv.priceKind}
          onPriceKind={vv.setPriceKind}
          onPickSet={(code) => vv.setFilters({ ...vv.state.filters, set: new Set([code]) })}
          onClose={closeSheet}
        />
      ) : null}
      {sheet === "filters" ? (
        <Sheet
          title="Filters"
          labelId="sheet-filters"
          className="m-sheet-layer--filters"
          onClose={closeSheet}
        >
          <p className="m-sheet__soon">Filters arrive with the next slice.</p>
        </Sheet>
      ) : null}
    </>
  );
}
