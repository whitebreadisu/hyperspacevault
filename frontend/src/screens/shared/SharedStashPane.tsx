import { useCallback, useMemo, useState } from "react";
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
  totalPrice,
  unitPrice,
  usePrintingIndex,
} from "../../stashes/stashContents";
import type { StashPrinting, StashSort, StashSortColumn } from "../../stashes/stashContents";
import { formatMoney } from "../../utils/completion";
import type { SetOrderMap } from "../../utils/catalog";
import type { InventoryCard } from "../../utils/inventory";
import type { PriceMode } from "../../utils/variantScope";
import { CardsValueKindToggle } from "../cards/VariantScopeControls";
import { StashGallery } from "../stashes/StashGallery";
import { StatTile } from "../stashes/StashesPane";
import { StashSortBar } from "../stashes/StashSort";
import { StashTable } from "../stashes/StashTable";
import type { ValueUnit } from "../stashes/StashTable";
import "../stashes/stashes.css";
import "./sharedStash.css";

// A stash link's viewer pane (App Spec §19.1): the owner's Stashes-page
// content pane (StashesPane) narrowed to the one stash and read-only. No
// rail, no pencil, trash, Share or + New stash. The head is new: the amber
// eyebrow "<SHARE NAME>'S STASH · READ ONLY", the stash name and its
// description, omitted entirely when empty. Then the Cards and Value tiles
// (Market / Low is the viewer's own persisted choice), Table | Gallery, the
// sort bar (Recently stashed reads each row's stashed_at), the Vault's
// filters (CardsPage portals FilterPanel into `onFilterSlot`, as on the
// owner's page) and the table, whose In-stash cell is the count chip alone.
// Rows open the read-only card detail (CardsPage's popup).

interface Props {
  view: SharedStashView;
  /** The catalogue merged with the in-stash counts (useVaultDataSource
   * `fixedQuantities`). */
  cards: InventoryCard[];
  /** The Vault model's narrowed list (filters, search). */
  list: InventoryCard[];
  finishes: Set<string>;
  setOrder: SetOrderMap;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
  onOpenPrinting: (cardId: number, variantId: number, order: number[]) => void;
  onFilterSlot?: (el: HTMLElement | null) => void;
}

export function SharedStashPane({
  view,
  cards,
  list,
  finishes,
  setOrder,
  priceKind,
  onPriceKind,
  onOpenPrinting,
  onFilterSlot,
}: Props) {
  const [mode, setMode] = useState<"table" | "gallery">("table");
  const [sort, setSort] = useState<StashSort>(DEFAULT_STASH_SORT);
  const [valueUnit, setValueUnit] = useState<ValueUnit>("total");
  const slotRef = useCallback((el: HTMLDivElement | null) => onFilterSlot?.(el), [onFilterSlot]);

  const index = usePrintingIndex(cards);
  const all = useMemo(() => {
    const at = new Map(view.rows.map((r) => [r.variant_id, r.stashed_at]));
    return stashPrintings(index, view.rows, (vid) => at.get(vid) ?? null);
  }, [index, view.rows]);
  const totals = stashTotals(all, priceKind);
  const rows = useMemo(
    () =>
      sortPrintings(narrowPrintings(all, list, finishes), sort, setOrder, priceKind, (r) =>
        valueUnit === "unit" ? unitPrice(r, priceKind) : totalPrice(r, priceKind)
      ),
    [all, list, finishes, sort, setOrder, priceKind, valueUnit]
  );

  const pickSort = (column: StashSortColumn) => setSort((prev) => nextStashSort(prev, column));
  const open = (r: StashPrinting) => {
    const order: number[] = [];
    for (const x of rows) if (!order.includes(x.card.base_card_id)) order.push(x.card.base_card_id);
    onOpenPrinting(r.card.base_card_id, r.variant.variant_id, order);
  };

  const { stash } = view;
  const zero = all.length === 0;
  return (
    <div className="cards-content sp-page ss-page">
      <section className="sp-content" aria-label={stash.name}>
        <div className="sp-top">
          <div className="sp-head">
            <div className="sp-read">
              <p className="ss-eyebrow">
                {SHARED_STASH_COPY.eyebrow(view.share_name)} · {SHARED_STASH_COPY.readOnly}
              </p>
              <h1 className="sp-read__name">{stash.name}</h1>
              {stash.description ? (
                <p className="sp-read__desc ss-desc">{stash.description}</p>
              ) : null}
            </div>
            <div className="sp-stats">
              <StatTile label="Cards" value={totals.copies.toLocaleString()} />
              <StatTile
                label="Value"
                value={totals.copies === 0 ? "—" : formatMoney(totals.value)}
                control={
                  <span className="inv-summary__pricemode">
                    <CardsValueKindToggle kind={priceKind} onChange={onPriceKind} />
                  </span>
                }
              />
            </div>
          </div>
          <span role="group" aria-label="View" className="inv-summary__view-toggle sp-viewtoggle">
            {(["table", "gallery"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "inv-summary__view-toggle-btn" +
                  (mode === v ? " inv-summary__view-toggle-btn--active" : "")
                }
                aria-pressed={mode === v}
                onClick={() => setMode(v)}
              >
                {v === "table" ? "Table" : "Gallery"}
              </button>
            ))}
          </span>
        </div>
        <div className="sp-list">
          <div className="sp-list__filters" ref={slotRef} />
          <div className="sp-list__body">
            {zero ? (
              <p className="sp-zero">{SHARED_STASH_COPY.zero(stash.name)}</p>
            ) : (
              <StashSortBar sort={sort} onSort={pickSort} />
            )}
            {zero ? null : rows.length === 0 ? (
              <p className="sp-zero">{STASH_COPY.filtered}</p>
            ) : mode === "table" ? (
              <StashTable
                rows={rows}
                sort={sort}
                onSort={pickSort}
                priceKind={priceKind}
                valueUnit={valueUnit}
                onValueUnit={setValueUnit}
                onOpen={open}
              />
            ) : (
              <StashGallery rows={rows} priceKind={priceKind} onOpen={open} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
