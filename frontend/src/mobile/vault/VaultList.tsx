import { useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Range } from "@tanstack/react-virtual";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import type { PriceMode } from "../../utils/variantScope";
import { CardRow } from "./CardRow";
import { GalleryCell } from "./GalleryCell";
import type { GallerySize, RowSize, ViewMode } from "./useVaultView";

// BL-247 S1-19 / S1-20 / S1-21: the Vault list -- virtualised rows (one
// estimate per tier, measured after mount, as CardsTable.tsx:370-380) or
// virtualised gallery lines of 1 / 2 / 3 cells; an empty list is one plain
// sentence (desktop's, CardsTable.tsx:390 / GalleryGrid.tsx:402).

/** Rendered ranges snap to blocks of BLOCK items (plus overscan), so a short
 * scroll -- the header's 28 px collapse trigger, the R3-13 cut changing the
 * scroll box -- re-renders the same rows and costs no layout (the S1-06
 * probe bound of <= 4 layouts per collapse / expand holds). */
const BLOCK = 12;
function blockRange(r: Range): number[] {
  if (r.count === 0) return [];
  const start = Math.max(0, Math.floor(r.startIndex / BLOCK) * BLOCK - r.overscan);
  const end = Math.min(r.count - 1, (Math.floor(r.endIndex / BLOCK) + 1) * BLOCK - 1 + r.overscan);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

const ROW_ESTIMATE: Record<RowSize, number> = { none: 47, sm: 61, md: 83, lg: 152 };
const OVERSCAN = 8;
export const EMPTY_SENTENCE = "No cards match the current filters.";

interface Props {
  scrollEl: HTMLElement | null;
  list: InventoryCard[];
  view: ViewMode;
  rowSize: RowSize;
  gallerySize: GallerySize;
  scope: string | null;
  finishes: Set<string>;
  priceKind: PriceMode;
  isAuthenticated: boolean;
  loading: boolean;
  onOpenCard: (card: InventoryCard, variant: InventoryVariant | null) => void;
}

export function VaultList(p: Props) {
  if (!p.loading && p.list.length === 0) {
    return (
      <div className="m-empty m-empty--list">
        <p>{EMPTY_SENTENCE}</p>
      </div>
    );
  }
  return p.view === "rows" ? (
    <Rows key={p.rowSize} {...p} />
  ) : (
    <Gallery key={p.gallerySize} {...p} />
  );
}

function Rows({ scrollEl, list, rowSize, scope, priceKind, isAuthenticated, onOpenCard }: Props) {
  // eslint-disable-next-line react-hooks/incompatible-library -- same TanStack hook as CardsTable / GalleryGrid
  const v = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_ESTIMATE[rowSize],
    overscan: OVERSCAN,
    getItemKey: (i) => list[i].base_card_id,
    rangeExtractor: blockRange,
    initialRect: { width: 390, height: 700 },
  });
  return (
    <div className={"m-rows m-rows--" + rowSize} style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((it) => {
        const card = list[it.index];
        return (
          <div
            key={it.key}
            className="m-vrow"
            data-index={it.index}
            ref={v.measureElement}
            style={{ transform: `translateY(${it.start}px)` }}
          >
            <CardRow
              card={card}
              size={rowSize}
              scope={scope}
              priceKind={priceKind}
              isAuthenticated={isAuthenticated}
              onOpen={onOpenCard}
            />
          </div>
        );
      })}
    </div>
  );
}

function Gallery({
  scrollEl,
  list,
  gallerySize,
  scope,
  finishes,
  isAuthenticated,
  onOpenCard,
}: Props) {
  const lines = useMemo(() => {
    const out: InventoryCard[][] = [];
    for (let i = 0; i < list.length; i += gallerySize) out.push(list.slice(i, i + gallerySize));
    return out;
  }, [list, gallerySize]);
  // eslint-disable-next-line react-hooks/incompatible-library -- same TanStack hook as CardsTable / GalleryGrid
  const v = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => (gallerySize === 1 ? 520 : gallerySize === 2 ? 280 : 190),
    overscan: 3,
    rangeExtractor: blockRange,
    initialRect: { width: 390, height: 700 },
  });
  return (
    <div className={"m-grid m-grid--g" + gallerySize} style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((it) => (
        <div
          key={it.key}
          className="m-gline"
          data-index={it.index}
          ref={v.measureElement}
          style={{ transform: `translateY(${it.start}px)` }}
        >
          {lines[it.index].map((card) => (
            <GalleryCell
              key={card.base_card_id}
              card={card}
              finishes={finishes}
              scope={scope}
              gallerySize={gallerySize}
              isAuthenticated={isAuthenticated}
              onOpen={onOpenCard}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
