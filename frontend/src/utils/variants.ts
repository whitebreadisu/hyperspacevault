// S is "Special" (App Spec §5.13), matching swuapi's own full-word rarity
// value and RarityBadge's RARITY_META key.
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
