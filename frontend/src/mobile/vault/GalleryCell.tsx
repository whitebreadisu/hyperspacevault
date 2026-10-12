import { parseCardDisplay } from "../../utils/catalog";
import { cardOwnedTotal, getPlaysetSize, isPlaysetComplete } from "../../utils/inventory";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { scopedOwnedCount, scopedPlaysetComplete } from "../../utils/variantScope";
import { cellImage, pickRepresentative } from "./cardImage";
import { GalleryPlate } from "./GalleryPlate";
import type { GallerySize } from "./useVaultView";

// BL-247 S1-20: one gallery cell (rev4 MVault.jsx:177-193; desktop
// GalleryGrid.tsx GalleryCell 229-350 + PlateTotal 200-228). One tap target:
// the art frame and the console plate. The art is the representative
// printing per the Finish facet (desktop BL-201 -- a scope writes that facet,
// so a scoped cell shows the lowest-numbered scoped printing). The plate:
// pips fill from the scoped count while scoped (amber), the plate's green
// ring + amber inner fill key off SCOPED completion while scoped, else
// overall (BL-222); the total is the all-printings owned number only (no
// "/limit"), green at a playset, muted at 0. Signed out: SIGN IN TO TRACK.

const SIZES: Record<GallerySize, string> = {
  1: "(max-width: 500px) 92vw, 360px",
  2: "(max-width: 500px) 46vw, 180px",
  3: "(max-width: 500px) 30vw, 120px",
};

export function GalleryCell({
  card,
  finishes,
  scope,
  gallerySize,
  isAuthenticated,
  onOpen,
}: {
  card: InventoryCard;
  finishes: Set<string>;
  scope: string | null;
  gallerySize: GallerySize;
  isAuthenticated: boolean;
  onOpen: (card: InventoryCard, variant: InventoryVariant | null) => void;
}) {
  const shown = pickRepresentative(card.variants, finishes);
  const filterDriven = finishes.size > 0 && shown != null;
  const img = cellImage(card, shown, gallerySize === 1 ? "large" : "thumb", SIZES[gallerySize]);
  const size = getPlaysetSize(card.type);
  const owned = cardOwnedTotal(card.inventory);
  const complete = isAuthenticated && isPlaysetComplete(card.inventory, card.type);
  const isScoped = isAuthenticated && scope != null;
  const scopedOwned = scope ? scopedOwnedCount(card.variants, scope) : owned;
  const filledPips = isAuthenticated ? Math.min(size, isScoped ? scopedOwned : owned) : 0;
  const scopedComplete =
    isScoped && scope != null && scopedPlaysetComplete(card.variants, scope, card.type);
  const pipsComplete = isScoped ? scopedComplete : complete;
  const { displayName } = parseCardDisplay(card);
  const finishLabel = shown && filterDriven ? ", " + (shown.finish ?? shown.variant_type) : "";

  return (
    <button
      type="button"
      className={"m-cell" + (img.images ? "" : " m-cell--empty")}
      data-card={card.base_card_id}
      data-shown={shown?.variant_id}
      onClick={() => onOpen(card, filterDriven ? shown : null)}
      aria-label={displayName + finishLabel}
    >
      <span className="m-cell__frame">
        {img.images ? (
          <img
            className={img.rotated ? "m-img--rotated" : undefined}
            src={img.images.src}
            srcSet={img.images.srcSet}
            sizes={img.images.sizes}
            onError={img.images.onError}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : null}
      </span>
      <GalleryPlate
        size={size}
        filled={filledPips}
        scoped={isScoped}
        complete={pipsComplete}
        total={owned}
        totalComplete={complete}
        isAuthenticated={isAuthenticated}
      />
    </button>
  );
}
