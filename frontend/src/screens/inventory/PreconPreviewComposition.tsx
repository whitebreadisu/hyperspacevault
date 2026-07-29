import { cardImageProps } from "../../utils/cardImages";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import type { PreconPreview } from "../../utils/preconPreview";

// BL-164 §5 (owner-locked composition, hover preview to the left of the
// precon dropdown's list): leader FRONT face, fully visible; the deck's base
// card centered behind it, offset up so only its title bar peeks out
// (reference: working/precon hover example.jpeg). Twin Suns/IBH variants
// double up per PreconPreview's discriminated kinds -- see
// utils/preconPreview.ts for the resolution/classification logic.

const PREVIEW_SIZES = "220px";

function CardFace({ entry, className }: { entry: AddCardsCatalogEntry; className: string }) {
  // "thumb" slot (utils/cardImages.ts): "the small-cell case (gallery cells,
  // the Add Cards preview)" -- this hover preview is exactly that case.
  const images = cardImageProps(entry.front_images, entry.front_image_url, "thumb", PREVIEW_SIZES);
  if (!images) {
    // No image at all for this side (shouldn't happen for a Leader/Base --
    // every base card has a front) -- an empty frame rather than a broken
    // <img>, matching AddCardsKeypad's own placeholder-frame idiom.
    return <div className={className} />;
  }
  return (
    <div className={className}>
      <img
        src={images.src}
        srcSet={images.srcSet}
        sizes={images.sizes}
        onError={images.onError}
        alt={entry.name}
        loading="lazy"
      />
    </div>
  );
}

/** One leader-front-over-base-peek pair (the "standard" composition), also
 * reused as each half of the "ibh" composition. */
function StandardComposition({
  leader,
  base,
}: {
  leader: AddCardsCatalogEntry;
  base: AddCardsCatalogEntry | null;
}) {
  return (
    <div className="acx-pdd__preview-comp acx-pdd__preview-comp--standard">
      {base && <CardFace entry={base} className="acx-pdd__preview-base" />}
      <CardFace entry={leader} className="acx-pdd__preview-leader" />
    </div>
  );
}

export function PreconPreviewComposition({ preview }: { preview: PreconPreview }) {
  if (preview.kind === "unresolved") return null;

  if (preview.kind === "standard") {
    return <StandardComposition leader={preview.leader} base={preview.base} />;
  }

  if (preview.kind === "dual") {
    return (
      <div className="acx-pdd__preview-comp acx-pdd__preview-comp--dual">
        {preview.base && (
          <CardFace
            entry={preview.base}
            className="acx-pdd__preview-base acx-pdd__preview-base--dual"
          />
        )}
        <div className="acx-pdd__preview-dual-leaders">
          <CardFace
            entry={preview.leaders[0]}
            className="acx-pdd__preview-leader acx-pdd__preview-leader--dual"
          />
          <CardFace
            entry={preview.leaders[1]}
            className="acx-pdd__preview-leader acx-pdd__preview-leader--dual"
          />
        </div>
      </div>
    );
  }

  // "ibh": both half-decks side by side, each its own standard composition.
  return (
    <div className="acx-pdd__preview-comp acx-pdd__preview-comp--ibh">
      {preview.halves.map((half, i) => (
        <StandardComposition key={i} leader={half.leader} base={half.base} />
      ))}
    </div>
  );
}
