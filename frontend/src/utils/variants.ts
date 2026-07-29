// BL-102: getVariantLabel retired with CardTable.tsx (both dead since the
// BL-56 unified Cards view; CardsTable renders finish labels itself).

// BL-161 (Definition_CosmeticsBatch_2026-07-26.md §1): owner direction
// 2026-07-26 -- S was labeled "Starter"; it is "Special" (matches swuapi's
// own full-word rarity value and RarityBadge's RARITY_META key). No test
// asserted the old "Starter" string (verified via a frontend-wide grep
// before this change), so no other disposition was needed.
const RARITY_LABELS: Record<string, string> = {
  S: "Special",
  C: "Common",
  U: "Uncommon",
  R: "Rare",
  L: "Legendary",
};

export function getRarityLabel(rarity: string): string {
  return RARITY_LABELS[rarity] ?? rarity;
}
