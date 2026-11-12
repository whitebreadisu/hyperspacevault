import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SharedStashView } from "../../api/sharedView";
import {
  DEFAULT_STASH_SORT,
  narrowPrintings,
  nextStashSort,
  SHARED_STASH_COPY,
  sortPrintings,
  STASH_COPY,
  stashPrintings,
  stashTotals,
  usePrintingIndex,
} from "../../stashes/stashContents";
import type { StashPrinting, StashSort } from "../../stashes/stashContents";
import { formatMoney } from "../../utils/completion";
import { useVaultData } from "../../vault/useVaultData";
import { publishNav, setOpener, setOpenSource } from "../card/navList";
import { FiltersSheet } from "../filters/FiltersSheet";
import { MIcon } from "../icons";
import { go } from "../router";
import { useVaultView } from "../vault/useVaultView";
import { VaultScreen } from "../vault/VaultScreen";
import { SearchField } from "../vault/VaultStatus";
import { Line, Panel, Readout, Tile } from "../stashes/StashScreen";
import { StashSortSheet, stashSortLabel } from "../stashes/StashSortSheet";
import "../stashes/stashes.css";

// A stash link's viewer on the phone (App Spec §19.1, §25.6): the owner's
// inside-a-stash screen (StashScreen) narrowed to read-only, in the shared
// pane MobileApp mounts for a stash link. The panel's head is the eyebrow
// "<SHARE NAME>'S STASH" with Market | Low; then the stash name, its
// description on one line (a tap opens the full text; omitted when empty),
// CARDS and VALUE. Below: search ("Search this stash"), Filters, the count,
// the stash sort and list / gallery -- no pencil, trash or Return. Rows
// open the card detail over the share (MobileApp's share scope), whose
// quantities are the in-stash counts.

type SheetName = "filters" | "sort" | null;

export function SharedStashScreen({
  view,
  account,
  unread,
  onOpenChooser,
  onOpenFeedback,
  onSearchMode,
  onRequestSignIn,
}: {
  view: SharedStashView;
  account: ReactNode;
  unread: boolean;
  onOpenChooser: () => void;
  onOpenFeedback: () => void;
  onSearchMode: (on: boolean) => void;
  onRequestSignIn?: () => void;
}) {
  const { cards, setOrder, loading } = useVaultData();
  const vv = useVaultView();
  const [mode, setMode] = useState<"rows" | "gallery">("rows");
  const [sheet, setSheet] = useState<SheetName>(null);
  const [sort, setSort] = useState<StashSort>(DEFAULT_STASH_SORT);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onSearchMode(searching);
  }, [searching, onSearchMode]);
  useEffect(() => () => onSearchMode(false), [onSearchMode]);

  const index = usePrintingIndex(cards);
  const all = useMemo(() => {
    const at = new Map(view.rows.map((r) => [r.variant_id, r.stashed_at]));
    return stashPrintings(index, view.rows, (vid) => at.get(vid) ?? null);
  }, [index, view.rows]);
  const rows = useMemo(
    () =>
      sortPrintings(
        narrowPrintings(all, vv.list, vv.state.filters.finish),
        sort,
        setOrder,
        vv.priceKind
      ),
    [all, vv.list, vv.state.filters.finish, sort, setOrder, vv.priceKind]
  );

  // Until the catalogue is in (the rows join to it), the read's own totals.
  const totals = loading
    ? {
        copies: view.totals.copies,
        value: vv.priceKind === "low" ? view.totals.value_low : view.totals.value_market,
      }
    : stashTotals(all, vv.priceKind);
  const copies = totals.copies.toLocaleString();
  const value = totals.copies === 0 ? "—" : formatMoney(totals.value);
  const { stash } = view;

  const openRow = (r: StashPrinting) => {
    const ids: number[] = [];
    for (const x of rows) if (!ids.includes(x.card.base_card_id)) ids.push(x.card.base_card_id);
    publishNav({
      ids,
      narrowed: vv.narrowed,
      scope: null,
      source: mode === "gallery" ? "gallery" : "row",
      finishes: [...vv.state.filters.finish],
    });
    setOpenSource(mode === "gallery" ? "gallery" : "row");
    const active = document.activeElement;
    setOpener(active instanceof HTMLElement && active !== document.body ? active : null);
    go("#/card/" + r.card.base_card_id + "?v=" + r.variant.variant_id);
  };

  // Empty is the read's own answer, never a catalogue still loading.
  const zero = view.rows.length === 0;
  const n = loading ? view.rows.length : rows.length;
  const controls = (
    <div className="m-vault__controls m-stashctl">
      <div className="m-vault__searchrow">
        <SearchField
          value={vv.state.query}
          onChange={vv.setQuery}
          inputRef={searchRef}
          onFocus={() => setSearching(true)}
          onBlur={() => setSearching(false)}
          narrowed={vv.narrowed}
          placeholder="Search this stash"
        />
        {vv.narrowed ? (
          <button type="button" className="m-clearbtn" onClick={vv.clearAll}>
            Clear
          </button>
        ) : null}
        <button
          type="button"
          className={"m-filterbtn" + (vv.activeCount ? " m-filterbtn--on" : "")}
          onClick={() => setSheet("filters")}
          aria-label={vv.activeCount ? `Filters, ${vv.activeCount} active` : "Filters"}
        >
          <MIcon name="filter" size={20} />
          <span>Filters</span>
          {vv.activeCount ? <span className="m-filterbtn__n">{vv.activeCount}</span> : null}
        </button>
      </div>
      <div className="m-vault__status m-stashctl__status">
        <span className={"m-count" + (vv.narrowed ? " m-count--narrowed" : "")}>
          {n} {n === 1 ? "printing" : "printings"}
        </span>
        <button
          type="button"
          className="m-sortbtn m-sortbtn--icon"
          onClick={() => setSheet("sort")}
          aria-haspopup="dialog"
          aria-label={stashSortLabel(sort)}
        >
          <MIcon name="sort" size={20} />
        </button>
        <span className="m-seg m-stashctl__view" role="group" aria-label="View">
          <button
            type="button"
            className={"m-seg__btn" + (mode === "rows" ? " m-seg__btn--on" : "")}
            aria-pressed={mode === "rows"}
            aria-label="List"
            onClick={() => setMode("rows")}
          >
            <MIcon name="rows" size={18} />
          </button>
          <button
            type="button"
            className={"m-seg__btn" + (mode === "gallery" ? " m-seg__btn--on" : "")}
            aria-pressed={mode === "gallery"}
            aria-label="Gallery"
            onClick={() => setMode("gallery")}
          >
            <MIcon name="grid" size={18} />
          </button>
        </span>
      </div>
    </div>
  );

  return (
    <>
      <VaultScreen
        className="m-stashscreen m-sharedstash"
        summary={{ pct: 0, copies: totals.copies, value: totals.value, narrowed: false }}
        readout={{
          content: <Readout name={stash.name} copies={copies} value={value} />,
          label: `${stash.name}: cards ${copies}, value ${value}`,
        }}
        panel={
          <Panel
            stash={stash}
            copies={copies}
            value={value}
            sub={null}
            priceKind={vv.priceKind}
            onPriceKind={vv.setPriceKind}
            eyebrow={SHARED_STASH_COPY.eyebrow(view.share_name)}
          />
        }
        account={account}
        unread={unread}
        onOpenChooser={onOpenChooser}
        onOpenFeedback={onOpenFeedback}
        searching={searching}
        listKey={mode}
        controls={controls}
      >
        {zero ? (
          <p className="m-stashes__note m-stashes__zero">{SHARED_STASH_COPY.zero(stash.name)}</p>
        ) : loading ? (
          <p className="m-stashes__note" role="status">
            {SHARED_STASH_COPY.loading}
          </p>
        ) : rows.length === 0 ? (
          <div className="m-empty m-empty--list">
            <p>{STASH_COPY.filtered}</p>
          </div>
        ) : mode === "rows" ? (
          <div className="m-stashlines">
            {rows.map((r) => (
              <Line
                key={r.variant.variant_id}
                row={r}
                priceKind={vv.priceKind}
                onOpen={() => openRow(r)}
              />
            ))}
          </div>
        ) : (
          <div className="m-stashgrid">
            {rows.map((r) => (
              <Tile
                key={r.variant.variant_id}
                row={r}
                priceKind={vv.priceKind}
                onOpen={() => openRow(r)}
              />
            ))}
          </div>
        )}
      </VaultScreen>
      {sheet === "filters" ? (
        <FiltersSheet
          vv={vv}
          onClose={() => setSheet(null)}
          onRequestSignIn={() => {
            setSheet(null);
            onRequestSignIn?.();
          }}
        />
      ) : null}
      {sheet === "sort" ? (
        <StashSortSheet
          sort={sort}
          onPick={(c) => setSort((prev) => nextStashSort(prev, c))}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}
