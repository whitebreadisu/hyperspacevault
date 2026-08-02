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

/** BL-192: moved from CardPopupRail.tsx verbatim so the shell (CardPopup.tsx)
 * can compute the SAME flat ordered variant list the rail renders, for the
 * up/down keyboard cycle -- one ordering rule, two consumers, instead of a
 * second implementation that could drift from the rail's own. Ordering for
 * the printings picker (design handoff §5 / mock): base set first (the
 * card's own set_code), then other source sets alphabetically, then
 * card_number ascending within each set. */
export function orderVariants(variants: VariantDetail[], baseSetCode: string): VariantDetail[] {
  const numericNumber = (v: VariantDetail) => {
    const n = Number(v.card_number);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  return [...variants].sort((a, b) => {
    const aBase = a.source_set_code === baseSetCode ? 0 : 1;
    const bBase = b.source_set_code === baseSetCode ? 0 : 1;
    if (aBase !== bBase) return aBase - bBase;
    if (a.source_set_code !== b.source_set_code) {
      return a.source_set_code.localeCompare(b.source_set_code);
    }
    return numericNumber(a) - numericNumber(b);
  });
}
