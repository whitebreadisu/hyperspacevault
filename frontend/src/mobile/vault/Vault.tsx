import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { go } from "../router";
import { Sheet } from "../Sheet";
import { ScopeSheet } from "./ScopeChip";
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
// (S1-15) -- inside the 1a-s header frame (VaultScreen).

type SheetName = "scope" | "sort" | "filters" | null;

interface Props {
  params: Record<string, string>;
  summary: StripSummary;
  panel: ReactNode;
  account: ReactNode;
  unread: boolean;
  onOpenChooser: () => void;
  onOpenFeedback: () => void;
  /** Search mode collapses the bottom bar too (MobileApp owns the bar). */
  onSearchMode: (on: boolean) => void;
}

export function Vault({
  params,
  summary,
  panel,
  account,
  unread,
  onOpenChooser,
  onOpenFeedback,
  onSearchMode,
}: Props) {
  const { isAuthenticated, loading } = useVaultData();
  const vv = useVaultView(params);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(() =>
    params.sheet === "scope" || params.sheet === "sort" || params.sheet === "filters"
      ? params.sheet
      : null
  );

  useEffect(() => {
    onSearchMode(searching);
  }, [searching, onSearchMode]);
  useEffect(() => () => onSearchMode(false), [onSearchMode]);

  const openCard = useCallback((card: InventoryCard, variant: InventoryVariant | null) => {
    go("#/card/" + card.base_card_id + (variant ? "?v=" + variant.variant_id : ""));
  }, []);
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
