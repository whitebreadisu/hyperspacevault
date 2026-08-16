import type { LimitCell, TypeCategory } from "../api/settingsLimits";

/** BL-25: pure keep-limit resolution shared by the enforcement pre-checks
 * (addCardsResolver's maxCopies, CardPopup's stepper disable) and
 * the settings grid. Mirrors the backend's BL-24 vocabulary
 * (app/services/limits.py + app/ingestion/swuapi_classify.py): a variant's
 * limit bucket is its `finish` when non-null, else its `channel`; its
 * category is "singleton" for Leader/Base base cards, "standard" otherwise.
 *
 * Deliberately separate from utils/inventory.ts's completion math
 * (getPlaysetSize / isPlaysetComplete / PLAYSET_SIZE): completion visuals
 * stay on the fixed 1/3 playset constants by design -- keep-limits govern
 * what you may ADD, not what counts as a complete playset. Do not merge the
 * two. */

/** The 8 frozen finishes, in the settings grid's display order. */
export const FINISH_BUCKETS = [
  "Standard",
  "Standard Foil",
  "Hyperspace",
  "Hyperspace Foil",
  "Standard Prestige",
  "Foil Prestige",
  "Serialized Prestige",
  "Showcase",
] as const;

/** The 7 provenance channels, in the settings grid's display order. */
export const CHANNEL_BUCKETS = [
  "Weekly Play",
  "Judge",
  "Convention",
  "Promo / Tournament-tier",
  "Movie",
  "Prerelease",
  "Retail",
] as const;

/** The canonical 15-bucket vocabulary (finishes first, then channels) --
 * the frontend mirror of the backend's ALL_LIMIT_BUCKETS, ordered for
 * display. */
export const CANONICAL_BUCKETS: readonly string[] = [...FINISH_BUCKETS, ...CHANNEL_BUCKETS];

export const ALL_TYPE_CATEGORIES: readonly TypeCategory[] = ["singleton", "standard"];

/** Code defaults (BL-24): what every cell resolves to when the tenant has no
 * override -- and what the whole matrix falls back to for anonymous /
 * not-yet-fetched users, so pre-auth behavior is byte-identical to the old
 * hardcoded Leader/Base=1, everything-else=3. */
export const DEFAULT_LIMITS: Record<TypeCategory, number> = {
  singleton: 1,
  standard: 3,
};

/** The unconditional technical cap (BL-24 QUANTITY_CEILING). "No limit"
 * cells are treated as this for pre-check purposes -- the backend blocks at
 * 999 with reason "ceiling" regardless of configuration. */
export const QUANTITY_CEILING = 999;

const SINGLETON_TYPES = new Set(["Leader", "Base"]);

/** "singleton" for Leader/Base base cards, "standard" for everything else. */
export function typeCategoryOf(type: string): TypeCategory {
  return SINGLETON_TYPES.has(type) ? "singleton" : "standard";
}

/** A variant's limit bucket: its finish when it has one, else its channel.
 * Both fields exist on every catalog variant (utils/catalog.ts Variant). */
export function limitBucketOf(finish: string | null, channel: string): string {
  return finish ?? channel;
}

/** The effective limits matrix as a lookup map, keyed by
 * `${type_category}|${limit_bucket}`. null means "not fetched" everywhere a
 * matrix is accepted -- resolution falls back to DEFAULT_LIMITS. */
export type LimitsMatrix = Record<string, LimitCell>;

export function matrixKey(category: TypeCategory, bucket: string): string {
  return `${category}|${bucket}`;
}

/** Index a GET/PUT response's cell list into a LimitsMatrix. */
export function toMatrix(cells: LimitCell[]): LimitsMatrix {
  const matrix: LimitsMatrix = {};
  for (const cell of cells) {
    matrix[matrixKey(cell.type_category, cell.limit_bucket)] = cell;
  }
  return matrix;
}

/** The effective max_quantity for a cell: the matrix's value when fetched
 * (which may be null = "No limit"), else the code default. Unknown buckets
 * (a cell absent from a fetched matrix -- shouldn't happen, the GET returns
 * the full matrix) also fall back to the code default. */
export function effectiveLimit(
  limits: LimitsMatrix | null,
  category: TypeCategory,
  bucket: string
): number | null {
  const cell = limits?.[matrixKey(category, bucket)];
  if (cell === undefined) return DEFAULT_LIMITS[category];
  return cell.max_quantity;
}

/** The numeric cap enforcement pre-checks compare against: the effective
 * limit, with "No limit" (null) mapped to the 999 technical ceiling. */
export function enforcementCap(
  limits: LimitsMatrix | null,
  category: TypeCategory,
  bucket: string
): number {
  return effectiveLimit(limits, category, bucket) ?? QUANTITY_CEILING;
}

/** BL-217: the Vault's "over my keep limit" filter predicate -- a card
 * qualifies when ANY of its variants owns more than its bucket's effective
 * limit. Reuses the exact bucket/category resolution the popup steppers
 * (CardPopupInventory's InventoryPlate) and addCardsResolver's maxCopies
 * already use (limitBucketOf + typeCategoryOf + effectiveLimit) rather than
 * re-deriving it. A bucket resolving to "No limit" (effectiveLimit === null)
 * can never be over-cap -- the 999 QUANTITY_CEILING is a technical add-time
 * stop, not a keep-limit, and is deliberately NOT consulted here (unlike
 * enforcementCap above, which exists for exactly that different purpose).
 * `type` is the base card's `type` (Leader/Base/...), the same field
 * typeCategoryOf already classifies elsewhere -- one category applies to
 * every variant of a card, only the per-variant bucket differs. */
export function cardOverCap(
  variants: readonly { finish: string | null; channel: string; quantity: number }[],
  type: string,
  limits: LimitsMatrix | null
): boolean {
  const category = typeCategoryOf(type);
  return variants.some((v) => {
    const limit = effectiveLimit(limits, category, limitBucketOf(v.finish, v.channel));
    return limit !== null && v.quantity > limit;
  });
}
