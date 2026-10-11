import { cardImageProps } from "../../utils/cardImages";
import type { CardImageProps, CardImageSlot } from "../../utils/cardImages";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";

// BL-247 S1-19 / S1-20: which printing a row or gallery cell shows, and its
// image. Ports of desktop screens/cards/GalleryGrid.tsx pickRepresentative
// (84-105) and cellImage (123-169), which that file keeps private; the rules
// are unchanged -- only the slot / sizes are parameters, for the phone's
// thumbnail and gallery widths.

/** The cell's printing: with any Finish facet value set, the lowest-numbered
 * printing carrying one (BL-201); otherwise Standard, else the first. */
export function pickRepresentative(
  variants: InventoryVariant[],
  activeFinishes?: Set<string>
): InventoryVariant | null {
  if (variants.length === 0) return null;
  if (activeFinishes && activeFinishes.size > 0) {
    const matches = variants.filter((v) => activeFinishes.has(v.finish ?? v.variant_type));
    if (matches.length > 0)
      return matches.reduce((lowest, v) =>
        Number(v.card_number) < Number(lowest.card_number) ? v : lowest
      );
  }
  return variants.find((v) => v.finish === "Standard") ?? variants[0];
}

/** The scoped printing (first variant carrying the raw finish), or null. */
export function scopedVariant(card: InventoryCard, scope: string | null): InventoryVariant | null {
  if (!scope) return null;
  return card.variants.find((v) => (v.finish ?? v.variant_type) === scope) ?? null;
}

/** Orientation rule: no card shows landscape in a portrait cell. Leaders
 * show their portrait back; bases and back-less leaders rotate the front. */
export function cellImage(
  card: InventoryCard,
  v: InventoryVariant | null,
  slot: CardImageSlot,
  sizes: string
): { images: CardImageProps | null; rotated: boolean } {
  if (!v) return { images: null, rotated: false };
  if (card.type === "Leader" && v.back_image_url)
    return { images: cardImageProps(v.back_images, v.back_image_url, slot, sizes), rotated: false };
  return {
    images: cardImageProps(v.front_images, v.front_image_url, slot, sizes),
    rotated: card.type === "Leader" || card.type === "Base",
  };
}
