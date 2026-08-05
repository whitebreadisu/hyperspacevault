import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { cardOwnedTotal, getPlaysetSize, isPlaysetComplete } from "../../utils/inventory";
import { cardImageProps } from "../../utils/cardImages";
import type { CardImageProps } from "../../utils/cardImages";

/** BL-73 Stage 1: uniform portrait cell, matching the 2.5:3.5 card ratio used
 * by the BL-62 Add Cards preview frame (AddCardsModal.css's
 * `.ac-pad__resolve-image`, 132x185 -- same ratio, sized up slightly for a
 * gallery-density grid). Landscape sources never render landscape here --
 * see cellImage's orientation rule (leader backs / rotated base fronts). */
const CELL_WIDTH = 140;
const CELL_HEIGHT = 196;
/** BL-111 F4 (design handoff §4, Option D "Plate + hover dossier"): each
 * cell grew a console plate footer below the art. PLATE_HEIGHT/CELL_GAP feed
 * both the CSS (.gallery-cell / .gallery-plate in cards.css) and the
 * virtualizer's row pitch below -- the two must never disagree, same
 * reasoning as `columns` further down. */
const PLATE_HEIGHT = 24;
const CELL_GAP = 4;
const CELL_TOTAL_HEIGHT = CELL_HEIGHT + CELL_GAP + PLATE_HEIGHT;
const GRID_GAP = 14;
const ROW_HEIGHT = CELL_TOTAL_HEIGHT + GRID_GAP;
const OVERSCAN = 3;
/** Fallback column count before the container has been measured (matches
 * CardsTable's `initialRect: { width: 1200 }` jsdom/SSR convention -- see
 * src/test/setup.ts). */
const DEFAULT_CONTAINER_WIDTH = 1200;

interface Props {
  cards: InventoryCard[];
  /** BL-201: `displayedFinish` is non-null ONLY when the active Finish
   * filter drove the cell's image pick (pickRepresentative's filter
   * branch) -- the finish the collector is literally looking at. CardsPage
   * feeds it to the popup's initialFinish so the click-through opens on
   * the displayed printing; null (no filter / fallback pick) keeps the
   * popup's own default rules (BL-193 scope preselect, then Standard). */
  onSelectCard: (baseCardId: number, displayedFinish?: string | null) => void;
  /** Active Finish filter selection (FilterState.finish, BL-90/BL-73
   * follow-up from Jeremy's dev review) -- an empty set means "no finish
   * filter active" and pickRepresentative falls back to the Standard/base
   * rule below. Passed as just the Set rather than the whole FilterState so
   * GalleryGrid doesn't take on a dependency on every other facet. */
  activeFinishes?: Set<string>;
  /** BL-111 F4: drives the plate's signed-in vs. "SIGN IN TO TRACK" state
   * and gates the hover dossier (anonymous users get no dossier -- there is
   * nothing tenant-specific to show). */
  isAuthenticated: boolean;
}

/** Representative variant for the gallery cell's image.
 * - No finish filter active (activeFinishes empty/undefined): the Standard
 *   printing if present, else the first variant in API order -- same rule as
 *   the unified CardPopup's `pickRepresentative` (screens/cards/
 *   CardPopup.tsx, BL-111 F5), applied here to the card's own image instead
 *   of the popup's.
 * - Finish filter active: pick a variant whose finish matches the filter --
 *   matching mirrors applyFilters' own check (`v.finish ?? v.variant_type`
 *   against the filter set, utils/filters.ts) so a card that's in the
 *   `filtered` array (guaranteed >=1 matching variant) always has a match
 *   here too. Multiple matches: lowest card_number wins (numeric compare --
 *   card_number is a digit string, e.g. "045" < "132"). Still tied: Jeremy
 *   doesn't care which -- first in array order (Array.prototype.find is
 *   already stable, so no extra sort is needed for that case). Falls back to
 *   the no-filter rule if nothing matches (shouldn't happen given the
 *   filtered-array guarantee, but keeps this function total).
 *
 * BL-201: `filterDriven` reports WHICH branch produced the pick -- true only
 * for the filter branch above, so the caller can tell "the collector chose
 * to look at this finish" (feeds the popup's initial selection) apart from
 * "the default Standard/base rule happened to run" (popup keeps its own
 * rules). */
function pickRepresentative(
  variants: InventoryVariant[],
  activeFinishes?: Set<string>
): { variant: InventoryVariant | null; filterDriven: boolean } {
  if (variants.length === 0) return { variant: null, filterDriven: false };
  if (activeFinishes && activeFinishes.size > 0) {
    const matches = variants.filter((v) => activeFinishes.has(v.finish ?? v.variant_type));
    if (matches.length > 0) {
      return {
        variant: matches.reduce((lowest, v) =>
          Number(v.card_number) < Number(lowest.card_number) ? v : lowest
        ),
        filterDriven: true,
      };
    }
  }
  return {
    variant: variants.find((v) => v.finish === "Standard") ?? variants[0],
    filterDriven: false,
  };
}

/** Orientation rule (Jeremy's dev review of the BL-73 Stage 1 build): no
 * card may display landscape in the gallery.
 * - Leader: the front is the landscape side; the back is the portrait/
 *   deployed side -- show the back. A leader whose representative has no
 *   back image falls back to the Base treatment below so it still never
 *   renders landscape.
 * - Base: fronts are landscape by design and have no portrait side --
 *   rotate the front 90° to fill the portrait cell (the `rotated` flag
 *   maps to .gallery-cell__img--rotated in cards.css).
 * - Every other type: front image, unrotated.
 * A card with no usable image at all keeps the placeholder cell so sort
 * positions stay stable. */
/** BL-76 Phase 3: "thumb" candidates sized around the CELL_WIDTH cell --
 * the util falls back to the plain hotlinked URL on its own when
 * front_images/back_images are absent (stale cached catalog response). */
const CELL_SIZES = `${CELL_WIDTH}px`;

function cellImage(
  card: InventoryCard,
  representative: InventoryVariant | null
): { images: CardImageProps | null; rotated: boolean } {
  if (!representative) return { images: null, rotated: false };
  if (card.type === "Leader" && representative.back_image_url) {
    return {
      images: cardImageProps(
        representative.back_images,
        representative.back_image_url,
        "thumb",
        CELL_SIZES
      ),
      rotated: false,
    };
  }
  if (card.type === "Leader" || card.type === "Base") {
    return {
      images: cardImageProps(
        representative.front_images,
        representative.front_image_url,
        "thumb",
        CELL_SIZES
      ),
      rotated: true,
    };
  }
  return {
    images: cardImageProps(
      representative.front_images,
      representative.front_image_url,
      "thumb",
      CELL_SIZES
    ),
    rotated: false,
  };
}

/** BL-111 F4: per-finish owned breakdown for the hover dossier -- playset-
 * completion semantics (utils/inventory.ts), deliberately NOT the
 * configurable keep-limits system (utils/limits.ts). Groups card.inventory
 * quantities by `finish ?? variant_type` (same fallback applyFilters/
 * CardPopup use elsewhere), in first-seen variant order with
 * Standard pulled to the front -- mirrors the design prototype's
 * `distinctFinishes`/`demo` helpers (claude_design/design_handoff_swu_restyle/
 * prototypes/gallery-view/GalleryCellOptions.jsx). Finishes with zero owned
 * copies are dropped -- the dossier only lists what's actually owned. */
export interface FinishBreakdownEntry {
  key: string;
  qty: number;
}

export function ownedFinishBreakdown(card: InventoryCard): FinishBreakdownEntry[] {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const v of card.variants) {
    const key = v.finish ?? v.variant_type;
    if (!totals.has(key)) {
      totals.set(key, 0);
      order.push(key);
    }
    totals.set(key, (totals.get(key) ?? 0) + (card.inventory[v.variant_id] ?? 0));
  }
  order.sort((a, b) => (a === "Standard" ? -1 : 0) - (b === "Standard" ? -1 : 0));
  return order.map((key) => ({ key, qty: totals.get(key) ?? 0 })).filter((entry) => entry.qty > 0);
}

/** Shared owned/limit readout (plate + dossier header) -- Russo One, green
 * when the playset is complete, muted when nothing is owned yet, otherwise
 * the neutral text color. Raw `owned` is shown even past `size` (overflow) --
 * deliberately not clamped, matching the design prototype's `Total`. */
function PlateTotal({ owned, size, complete }: { owned: number; size: number; complete: boolean }) {
  const stateClass = complete
    ? " gallery-plate__total--complete"
    : owned === 0
      ? " gallery-plate__total--empty"
      : "";
  return (
    <span className={`gallery-plate__total${stateClass}`}>
      {owned}
      <span className="gallery-plate__total-limit">/{size}</span>
    </span>
  );
}

interface GalleryCellProps {
  card: InventoryCard;
  images: CardImageProps | null;
  rotated: boolean;
  isAuthenticated: boolean;
  onSelect: () => void;
}

/** BL-111 F4 (design handoff §4, Option D "Plate + hover dossier" -- final):
 * one clickable unit -- art frame, console plate footer (playset pips +
 * owned/limit), and (signed-in, hovered) a dossier tooltip listing owned
 * copies per finish. Hover state is local React state (mouseenter/leave),
 * mirroring the codebase's existing hover-tooltip idiom
 * (components/VariantsTooltip.tsx) rather than a CSS :hover reveal, so the
 * dossier stays directly testable. Touch devices never fire
 * mouseenter/mouseleave, so the dossier simply never appears there -- the
 * cell's own click/tap still opens the detail popup (design handoff's
 * "mobile note": no extra work needed). */
function GalleryCell({ card, images, rotated, isAuthenticated, onSelect }: GalleryCellProps) {
  const [hovered, setHovered] = useState(false);
  const size = getPlaysetSize(card.type);
  const owned = cardOwnedTotal(card.inventory);
  const complete = isAuthenticated && isPlaysetComplete(card.inventory, card.type);
  const showDossier = isAuthenticated && hovered;
  const breakdown = showDossier ? ownedFinishBreakdown(card) : [];
  const filledPips = Math.min(size, owned);

  return (
    <button
      type="button"
      className={`gallery-cell${images ? "" : " gallery-cell--empty"}`}
      onClick={onSelect}
      aria-label={card.name}
    >
      <div className="gallery-cell__frame">
        {images && (
          <img
            className={`gallery-cell__img${rotated ? " gallery-cell__img--rotated" : ""}`}
            src={images.src}
            srcSet={images.srcSet}
            sizes={images.sizes}
            onError={images.onError}
            alt={card.name}
            loading="lazy"
          />
        )}
      </div>
      {/* Owner dev review 2026-07-26 (round 3): the dossier's hover trigger
          is the inventory PLATE only, not the whole tile -- same
          hover-the-count scoping the table's Playset chip got in round 2. */}
      <div
        className={`gallery-plate${complete ? " gallery-plate--complete" : ""}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          className={`gallery-plate__inner${
            isAuthenticated ? "" : " gallery-plate__inner--signed-out"
          }`}
        >
          {isAuthenticated ? (
            <>
              <span className="gallery-plate__pips">
                {Array.from({ length: size }).map((_, i) => (
                  <span
                    key={i}
                    className={`gallery-plate__pip${
                      i < filledPips ? " gallery-plate__pip--filled" : ""
                    }`}
                  />
                ))}
              </span>
              <PlateTotal owned={owned} size={size} complete={complete} />
            </>
          ) : (
            <span className="gallery-plate__sign-in">SIGN IN TO TRACK</span>
          )}
        </div>
      </div>
      {showDossier && (
        <div className="gallery-dossier" role="tooltip">
          <div className="gallery-dossier__inner">
            <div
              className={`gallery-dossier__head${
                breakdown.length ? " gallery-dossier__head--with-rows" : ""
              }`}
            >
              <span className="gallery-dossier__label">OWNED</span>
              <PlateTotal owned={owned} size={size} complete={complete} />
            </div>
            {breakdown.length === 0 ? (
              <div className="gallery-dossier__empty">NO COPIES OWNED</div>
            ) : (
              breakdown.map((entry) => (
                <div key={entry.key} className="gallery-dossier__row">
                  <span className="gallery-dossier__row-label">{entry.key}</span>
                  <span className="gallery-dossier__row-qty">{entry.qty}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </button>
  );
}

/** Gallery view of the Cards screen (BL-73 Stage 1 art + BL-111 F4 console
 * plate/dossier) -- the *same* filtered/sorted `cards` array CardsTable
 * renders, so filters, sort order, and the owned/incomplete toggles affect
 * it identically (see CardsPage's `filtered`). Sort order flows
 * left-to-right, top-to-bottom.
 *
 * Virtualized with @tanstack/react-virtual, same library/pattern as
 * CardsTable -- but a table virtualizes one row per card, while a grid needs
 * to virtualize *rows of N cells*. N (columns-per-row) depends on the
 * container's measured width (a ResizeObserver-free resize listener,
 * defaulting to DEFAULT_CONTAINER_WIDTH before the first measurement/in
 * jsdom), and that same `columns` value drives both the row-grouping math
 * below and the CSS grid-template-columns of each rendered row, so the two
 * can never disagree about how many cards are in a row. */
export function GalleryGrid({ cards, onSelectCard, activeFinishes, isAuthenticated }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(DEFAULT_CONTAINER_WIDTH);

  useEffect(() => {
    const measure = () => {
      if (scrollRef.current) setContainerWidth(scrollRef.current.offsetWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const columns = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (CELL_WIDTH + GRID_GAP)));
  const rowCount = Math.ceil(cards.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Testing note: see CardsTable.tsx / src/test/setup.ts -- react-virtual
    // measures the scroll container via offsetWidth/offsetHeight, which
    // jsdom always reports as 0 without the global mock in setup.ts.
    // initialRect is the pre-measurement fallback.
    initialRect: { width: DEFAULT_CONTAINER_WIDTH, height: 600 },
  });

  // Must run before any early return -- hooks can't be called conditionally.
  if (cards.length === 0) {
    return <p className="placeholder">No cards match the current filters.</p>;
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div className="gallery-grid-wrapper" ref={scrollRef}>
      <div className="gallery-grid-scroll" style={{ height: totalSize }}>
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columns;
          const rowCards = cards.slice(startIndex, startIndex + columns);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              className="gallery-grid-row"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${columns}, ${CELL_WIDTH}px)`,
              }}
            >
              {rowCards.map((card) => {
                const { variant: representative, filterDriven } = pickRepresentative(
                  card.variants,
                  activeFinishes
                );
                const { images, rotated } = cellImage(card, representative);
                // BL-201: only a filter-driven pick carries its finish to
                // the click-through -- the default Standard/base pick sends
                // null so the popup keeps its own rules (scope, Standard).
                const displayedFinish =
                  filterDriven && representative
                    ? (representative.finish ?? representative.variant_type)
                    : null;
                return (
                  <GalleryCell
                    key={card.base_card_id}
                    card={card}
                    images={images}
                    rotated={rotated}
                    isAuthenticated={isAuthenticated}
                    onSelect={() => onSelectCard(card.base_card_id, displayedFinish)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
