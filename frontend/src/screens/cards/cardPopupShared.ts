import type { VariantDetail } from "../../api/baseCards";

/** Picker/label format shared by the printings rail (CardPopupRail.tsx, each
 * row's `title` attribute) and the inventory stepper (CardPopupInventory.tsx,
 * its increment/decrement aria-labels). It lives here so neither component
 * file has to import from the other. Example: "Standard – #4 – ASH". */
export function variantLabel(v: VariantDetail): string {
  return `${v.finish ?? v.variant_type} – #${v.card_number} – ${v.source_set_code}`;
}

/** Ordering for the printings picker: base set first (the card's own
 * set_code), then other source sets alphabetically, then card_number
 * ascending within each set. The rail renders this order and the shell
 * (CardPopup.tsx) builds the same flat list for the up/down keyboard cycle,
 * so there is one ordering rule with two consumers and no second
 * implementation to drift. */
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
