import { parseCardDisplay } from "../../utils/catalog";
import { getPlaysetSize } from "../../utils/inventory";
import { formatCardValue } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { cellImage } from "../../mobile/vault/cardImage";
import { finishName, unitPrice } from "../../stashes/stashContents";
import type { StashPrinting } from "../../stashes/stashContents";

// Desktop 1b's gallery, on the Vault's gallery classes: one `gallery-cell`
// per printing (140 x 196 `gallery-cell__frame`, each printing's own art --
// leaders their portrait back, bases rotated into portrait, the Vault's
// cellImage rule and `gallery-cell__img--rotated`) over the Vault's
// `gallery-plate` (green ring at a playset): the count (the plate's
// `gallery-plate__total`, green at a playset) · finish · unit price. A
// tile opens the card detail on its printing.

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
        const img = cellImage(r.card, r.variant, "thumb", "140px");
        const { displayName } = parseCardDisplay(r.card);
        const fin = finishName(r.variant);
        const complete = r.qty >= getPlaysetSize(r.card.type);
        return (
          <button
            key={r.variant.variant_id}
            type="button"
            className={"gallery-cell" + (img.images ? "" : " gallery-cell--empty")}
            data-variant={r.variant.variant_id}
            onClick={() => onOpen(r)}
            aria-label={`${displayName}, ${fin}, ${r.qty} in this stash`}
          >
            <span className="gallery-cell__frame">
              {img.images ? (
                <img
                  className={
                    "gallery-cell__img" + (img.rotated ? " gallery-cell__img--rotated" : "")
                  }
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
            <span className={"gallery-plate" + (complete ? " gallery-plate--complete" : "")}>
              <span className="gallery-plate__inner sp-plate__inner">
                <span
                  className={
                    "gallery-plate__total" + (complete ? " gallery-plate__total--complete" : "")
                  }
                >
                  {r.qty}
                </span>
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
