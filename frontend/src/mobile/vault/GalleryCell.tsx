import { parseCardDisplay } from "../../utils/catalog";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { playsetPlate } from "../../utils/variantScope";
import { cellImage, pickRepresentative } from "./cardImage";
import { GalleryPlate } from "./GalleryPlate";
import type { GallerySize } from "./useVaultView";

// One gallery cell (desktop GalleryGrid.tsx GalleryCell + PlateTotal). One
// tap target: the art frame and the console plate. The art is the
// representative printing per the Finish facet (as desktop -- a scope writes
// that facet, so a scoped cell shows the lowest-numbered scoped printing).
// The plate: pips fill from the scoped count while scoped (amber), the
// plate's green ring + amber inner fill key off SCOPED completion while
// scoped, else overall (utils/variantScope.ts playsetPlate); the total is the all-printings owned number only (no
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
  const plate = playsetPlate(card, scope, isAuthenticated);
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
        size={plate.size}
        filled={plate.filled}
        scoped={plate.scoped}
        complete={plate.pipsComplete}
        total={plate.owned}
        totalComplete={plate.complete}
        isAuthenticated={isAuthenticated}
      />
    </button>
  );
}
