import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

/** The 3 same-origin serving URLs for one side of a variant (ADR-0012),
 * derived from front_image_url/back_image_url -- server-side on the detail
 * endpoint, client-side (utils/cardImages.ts's deriveRenditions) for the
 * list. */
export interface ImageRenditions {
  original: string;
  w640: string;
  w320: string;
}

/** One variant's current price. Present only when tcgcsv has a mapping AND
 * at least one priced day for this variant -- an unpriced variant carries
 * `price: null` on its parent, never a PriceInfo with every field null.
 * market/low stay individually nullable even when the row exists (tcgcsv
 * occasionally omits a tier for a given day; the price still ships with its
 * as_of, never blanks the whole thing). No mid/high fields -- the API
 * surface only carries market + low (see backend's
 * schemas/base_card_detail_schema.py PriceInfo docstring). */
export interface PriceInfo {
  market: number | null;
  low: number | null;
  as_of: string;
}

/** The one-price-per-card aggregate GET /api/base-cards computes per the
 * `?pricing=standard|cheapest` query param. Not present on the detail
 * endpoint's response (the popup shows per-variant PriceInfo instead) --
 * carried here for BaseCardCatalog type fidelity with the list endpoint's
 * actual response shape; no frontend code reads it. */
export interface DisplayPrice {
  value: number | null;
  as_of: string | null;
}

/** SLIM catalog-only variant shape -- what the GET /api/base-cards *list*
 * nests (App Spec §12: the list carries no per-tenant data and no
 * front_images/back_images). Quantities come separately from getQuantities
 * (api/inventory.ts) and are merged client-side.
 *
 * `stamped`, `source_set_name`, `stamp_group`, `front_images` and
 * `back_images` are list-absent: no list consumer (filters/sort/table/
 * gallery/Add Cards resolver) reads them. `front_images`/`back_images` are
 * derived client-side from `front_image_url`/`back_image_url` (see
 * utils/cardImages.ts's deriveRenditions, wired through utils/inventory.ts's
 * toInventoryCards). Every list-absent field ships on VariantDetail below,
 * which re-declares the full field set instead of extending this one.
 *
 * `price` is additive-optional (the backend's CardVariantCatalogResponse
 * carries it): the Collection-value completion panel needs every owned
 * variant's own market/low price catalog-wide, with a Standard-price
 * fallback, which the list's per-card `display_price` aggregate can't
 * supply. `undefined` (key absent, a stale cached response) and `null` (no
 * price row) both mean "no price for this printing" (see
 * utils/completion.ts). */
export interface CatalogVariant {
  variant_id: number;
  variant_type: string;
  finish: string | null;
  channel: string;
  source_set_code: string;
  card_number: string;
  front_image_url: string | null;
  back_image_url: string | null;
  price?: PriceInfo | null;
}

/** The list endpoint's slim variant shape with the caller's per-tenant
 * quantity merged in client-side (vault/useVaultData.ts's mergeQuantities
 * over getBaseCardsList + getQuantities) -- fed to toInventoryCards
 * (utils/inventory.ts). NOT the same as VariantDetail below, which is the
 * full detail-endpoint shape -- the list path never carries VariantDetail's
 * detail-only fields, so pretending otherwise here would just be a
 * type-level lie. */
export interface CatalogVariantWithQuantity extends CatalogVariant {
  quantity: number;
}

/** Full variant shape -- what GET /api/base-cards/{id} (detail; card detail
 * / card-inventory popups) nests. Re-declared rather than extending
 * CatalogVariant, which does not carry every field this one needs.
 *
 * front_images/back_images are additive and optional -- `?:` (not just
 * `| null`) because a stale CDN-cached response that predates the field
 * omits the keys entirely. Every consumer must go through
 * utils/cardImages.ts's cardImageProps, which falls back to the plain
 * front_image_url/back_image_url hotlink when these are absent.
 *
 * `price` is additive the same way: absent on a stale cached response that
 * predates the field, and null for the small slice of variants with no
 * tcgcsv mapping/price (tokens always null). */
export interface VariantDetail {
  variant_id: number;
  variant_type: string;
  finish: string | null;
  channel: string;
  stamped: boolean;
  source_set_code: string;
  source_set_name: string;
  card_number: string;
  front_image_url: string | null;
  back_image_url: string | null;
  front_images?: ImageRenditions | null;
  back_images?: ImageRenditions | null;
  stamp_group: string | null;
  price?: PriceInfo | null;
  quantity: number;
}

/** SLIM base-card fields -- what BaseCardCatalog below nests directly.
 * Deliberately NOT shared with BaseCardDetailFields (further down) via a
 * common supertype -- the two field sets diverge (this one omits set_name/
 * type2/double_sided/is_unique/front_text/back_text/epic_action/artist,
 * which no list consumer reads), and a shared base would force them back
 * into lockstep. */
interface BaseCardCatalogFields {
  id: number;
  set_code: string;
  base_card_number: string;
  name: string;
  subtitle: string | null;
  type: string;
  rarity: string;
  cost: number | null;
  power: number | null;
  hp: number | null;
  arena: string | null;
  is_token: boolean;
  aspects: string[];
  keywords: string[];
  traits: string[];
}

/** One base card from the catalog-only list (see BaseCardCatalogFields/
 * CatalogVariant docs above). */
export interface BaseCardCatalog extends BaseCardCatalogFields {
  variants: CatalogVariant[];
  display_price?: DisplayPrice | null;
}

/** BaseCardCatalog with quantity merged onto each variant client-side --
 * what toInventoryCards (utils/inventory.ts) consumes as its list-side
 * input. BaseCardDetail is the wrong type for this: the list does not carry
 * its detail-only fields. */
export interface BaseCardCatalogWithQuantity extends Omit<BaseCardCatalog, "variants"> {
  variants: CatalogVariantWithQuantity[];
}

/** Full base-card fields -- what BaseCardDetail nests. Kept separate from
 * BaseCardCatalogFields (not shared via inheritance) for the reason given
 * on BaseCardCatalogFields above. */
interface BaseCardDetailFields {
  id: number;
  set_code: string;
  set_name: string;
  base_card_number: string;
  name: string;
  subtitle: string | null;
  type: string;
  type2: string | null;
  double_sided: boolean;
  rarity: string;
  cost: number | null;
  power: number | null;
  hp: number | null;
  arena: string | null;
  is_unique: boolean | null;
  front_text: string | null;
  back_text: string | null;
  epic_action: string | null;
  artist: string | null;
  is_token: boolean;
  aspects: string[];
  keywords: string[];
  traits: string[];
}

/** One base card whose variants carry quantities -- the detail endpoint's
 * response. */
export interface BaseCardDetail extends BaseCardDetailFields {
  variants: VariantDetail[];
}

export async function getBaseCardDetail(baseCardId: number): Promise<BaseCardDetail> {
  const res = await authedFetch(`/api/base-cards/${baseCardId}`);
  if (!res.ok) {
    throw new ApiError(`Failed to fetch base card ${baseCardId}: ${res.status}`, res.status);
  }
  return res.json();
}

export interface BaseCardListFilters {
  set_code?: string;
  type?: string;
  rarity?: string;
}

/** The list fetch (ADR-0005): one call returns every base card with its
 * variants nested. It is *catalog data only* (no per-tenant quantity),
 * publicly CDN/browser-cached server-side, so it uses plain fetch: sending
 * an Authorization header here would be pointless (the endpoint is
 * tenant-less) and would fragment the shared cache entry. Quantities come
 * from getQuantities (api/inventory.ts) and are merged in
 * vault/useVaultData.ts. variant_type is intentionally not a filter here
 * (mirrors the backend's list_base_cards) since it's a per-variant facet and
 * would defeat the point of returning whole base cards with their full
 * variant tail. */
export async function getBaseCardsList(
  filters: BaseCardListFilters = {}
): Promise<BaseCardCatalog[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  const res = await fetch(`/api/base-cards${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new ApiError(`Failed to fetch base cards: ${res.status}`, res.status);
  return res.json();
}

/** One daily market-price point in a variant's history series. */
export interface PriceHistoryPoint {
  as_of: string;
  market: number | null;
}

export type PriceHistoryRange = "30d" | "90d" | "1y" | "all";

export interface PriceHistoryResponse {
  variant_id: number;
  range: string;
  series: PriceHistoryPoint[];
}

/** GET /api/base-cards/{base_card_id}/price-history. Anonymous and
 * catalog-cacheable (same posture as getBaseCardsList above): plain fetch,
 * no Authorization header, no per-tenant variance possible. 404s (thrown as
 * an ApiError here) if variant_id isn't actually a printing of
 * base_card_id. */
export async function getPriceHistory(
  baseCardId: number,
  variantId: number,
  range: PriceHistoryRange = "90d"
): Promise<PriceHistoryResponse> {
  const params = new URLSearchParams({ variant_id: String(variantId), range });
  const res = await fetch(`/api/base-cards/${baseCardId}/price-history?${params.toString()}`);
  if (!res.ok) {
    throw new ApiError(
      `Failed to fetch price history for variant ${variantId}: ${res.status}`,
      res.status
    );
  }
  return res.json();
}
