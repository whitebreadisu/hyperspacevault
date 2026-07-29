import type { VariantDetail } from "../../api/baseCards";

/** BL-155 decomposition: pulled out of CardPopup.tsx verbatim -- this format
 * string is used by both the printings rail (CardPopupRail.tsx, as each
 * row's `title` attribute) and the inventory stepper (CardPopupInventory.tsx,
 * in its increment/decrement aria-labels), so it lives here rather than in
 * either component file to avoid one importing from the other.
 *
 * Picker/label format shared with the retired popups: "Standard – #4 – ASH". */
export function variantLabel(v: VariantDetail): string {
  return `${v.finish ?? v.variant_type} – #${v.card_number} – ${v.source_set_code}`;
}
