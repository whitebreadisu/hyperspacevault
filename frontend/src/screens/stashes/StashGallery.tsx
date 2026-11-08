import { parseCardDisplay } from "../../utils/catalog";
import { formatCardValue } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { cellImage } from "../../mobile/vault/cardImage";
import { finishName, stashChipClass, unitPrice } from "../../stashes/stashContents";
import type { StashPrinting } from "../../stashes/stashContents";

// Desktop 1b's gallery: one 132 × 184 tile per printing, each showing that
// printing's own art (leaders their portrait back, bases rotated into
// portrait -- the Vault's cellImage rule), over a 34 px steel-ring plate:
// count chip · finish · unit price. A tile opens the card detail on its
// printing.

export function StashGallery({
  rows,
  priceKind,
  onOpen,
}: {
  rows: StashPrinting[];
  priceKind: PriceMode;
  onOpen: (row: StashPrinting) => void;
}) {
  return (
    <div className="sp-gallery">
      {rows.map((r) => {
        const img = cellImage(r.card, r.variant, "thumb", "132px");
        const { displayName } = parseCardDisplay(r.card);
        const fin = finishName(r.variant);
        return (
          <button
            key={r.variant.variant_id}
            type="button"
            className="sp-tile"
            data-variant={r.variant.variant_id}
            onClick={() => onOpen(r)}
            aria-label={`${displayName}, ${fin}, ${r.qty} in this stash`}
          >
            <span className="sp-tile__art">
              {img.images ? (
                <img
                  className={img.rotated ? "sp-tile__img sp-tile__img--rotated" : "sp-tile__img"}
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
            <span className="sp-plate">
              <span className="sp-plate__inner">
                <span className={stashChipClass(r.qty, r.card) + " sp-plate__chip"}>{r.qty}</span>
                <span className="sp-plate__fin">{fin}</span>
                <span className="sp-plate__price">{formatCardValue(unitPrice(r, priceKind))}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
