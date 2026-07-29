import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

/** BL-76 Phase 3 (ADR-0012): the 3 same-origin serving URLs for one side of
 * a variant, derived server-side from front_image_url/back_image_url. */
export interface ImageRenditions {
  original: string;
  w640: string;
  w320: string;
}

/** BL-136 P4 (Definition_Pricing_2026-07-16.md §4): one variant's current
 * price. Present only when tcgcsv has a mapping AND at least one priced day
 * for this variant -- an unpriced variant carries `price: null` on its
 * parent, never a PriceInfo with every field null. market/low stay
 * individually nullable even when the row exists (tcgcsv occasionally omits
 * a tier for a given day; decided policy: the price still ships with its
 * as_of, never blanks the whole thing). No mid/high fields -- the shipped
 * API surface only carries market + low (see backend's
 * schemas/base_card_detail_schema.py PriceInfo docstring). */
export interface PriceInfo {
  market: number | null;
  low: number | null;
  as_of: string;
}

/** BL-136 P4: the one-price-per-card aggregate GET /api/base-cards computes
 * per the `?pricing=standard|cheapest` query param. Not present on the
 * detail endpoint's response (the popup shows per-variant PriceInfo
 * instead) -- carried here for BaseCardCatalog type fidelity with the list
 * endpoint's actual response shape (BL-141's future list/gallery work). */
export interface DisplayPrice {
  value: number | null;
  as_of: string | null;
}

/** SLIM catalog-only variant shape (BL-101, slimmed further by BL-146,
 * Design_SparseList_2026-07-25.md §2) -- what the GET /api/base-cards
 * *list* nests. Carries no per-tenant data; quantities come separately from
 * getQuantities (api/inventory.ts) and are merged client-side.
 *
 * BL-146: `stamped`, `source_set_name`, `stamp_group`, `price`,
 * `front_images`, `back_images` dropped -- a census of every list consumer
 * (filters/sort/table/gallery/Add Cards resolver) found zero reads of any
 * of them. `front_images`/`back_images` specifically are now derived
 * client-side from `front_image_url`/`back_image_url` (see
 * utils/cardImages.ts's deriveRenditions, wired through
 * utils/inventory.ts's toInventoryCards) instead of shipped by the API.
 * `stamped`/`source_set_name`/`stamp_group`/`front_images`/`back_images`
 * are still list-absent -- every one still ships on VariantDetail below,
 * which re-declares the full field set instead of extending this one.
 *
 * BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): `price` is back,
 * additive-optional (backend re-attached it to CardVariantCatalogResponse)
 * -- the Collection-value completion panel needs every owned variant's own
 * market/low price catalog-wide, with a Standard-price fallback, which the
 * list's per-card `display_price` aggregate can't supply. `undefined`
 * (key absent) is a stale pre-BL-163 cached response; `null` is a real,
 * priced-nothing variant -- callers must treat those two differently (see
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

/** BL-146: the list endpoint's slim variant shape with the caller's
 * per-tenant quantity merged in client-side (CardsPage.tsx merges
 * getBaseCardsList + getQuantities) -- fed to toInventoryCards
 * (utils/inventory.ts). NOT the same as VariantDetail below, which is the
 * (still-fat) detail-endpoint shape -- the list path never carries
 * VariantDetail's detail-only fields, so pretending otherwise here would
 * just be a type-level lie. */
export interface CatalogVariantWithQuantity extends CatalogVariant {
  quantity: number;
}

/** Full (pre-BL-146) variant shape -- what GET /api/base-cards/{id} (detail;
 * card detail / card-inventory popups) nests. Re-declared rather than
 * extending CatalogVariant (BL-146: that interface no longer carries every
 * field this one needs) -- the detail endpoint's actual fields are
 * unchanged, only the TS inheritance relationship moved.
 *
 * front_images/back_images (BL-76 Phase 3) are additive and optional --
 * `?:` (not just `| null`) because a stale CDN-cached response from before
 * this field existed omits the keys entirely. Every consumer must go
 * through utils/cardImages.ts's cardImageProps, which falls back to the
 * plain front_image_url/back_image_url hotlink when these are absent.
 *
 * `price` (BL-136 P4, BL-140) is additive the same way: absent on a stale
 * cached response from before this field existed, and null for the small
 * slice of variants with no tcgcsv mapping/price (tokens always null). */
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

/** SLIM base-card fields (BL-146) -- what BaseCardCatalog below nests
 * directly. Deliberately NOT shared with BaseCardDetailFields (further
 * down) via a common supertype -- the two field sets diverge (this one
 * dropped set_name/type2/double_sided/is_unique/front_text/back_text/
 * epic_action/artist, zero list-consumer reads per the BL-146 census), and
 * a shared base would force them back into lockstep. */
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

/** One base card from the catalog-only list (BL-101, slimmed by BL-146 --
 * see BaseCardCatalogFields/CatalogVariant docs above). */
export interface BaseCardCatalog extends BaseCardCatalogFields {
  variants: CatalogVariant[];
  display_price?: DisplayPrice | null;
}

/** BL-146: BaseCardCatalog with quantity merged onto each variant
 * client-side -- what toInventoryCards (utils/inventory.ts) actually
 * consumes as its list-side input, replacing the old (structurally
 * incorrect post-slim) use of BaseCardDetail for this purpose. */
export interface BaseCardCatalogWithQuantity extends Omit<BaseCardCatalog, "variants"> {
  variants: CatalogVariantWithQuantity[];
}

/** Full (pre-BL-146) base-card fields -- what BaseCardDetail nests. Kept
 * separate from BaseCardCatalogFields (not shared via inheritance) for the
 * same reason as VariantDetail above -- the detail endpoint's fields are
 * unchanged, only the TS shape it used to derive from is gone. */
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
  // BL-154: migrated from a bare `throw new Error`.
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

/** BL-44 Slice B (ADR-0005): the payload-shrink list fetch -- one call
 * returns every base card with its variants nested. Since BL-101's
 * catalog/quantity split this is *catalog data only* (no per-tenant
 * quantity), publicly CDN/browser-cached server-side, so it uses plain
 * fetch: sending an Authorization header here would be pointless (the
 * endpoint is tenant-less) and would fragment the shared cache entry.
 * Quantities come from getQuantities (api/inventory.ts) and are merged in
 * CardsPage. variant_type is intentionally not a filter here (mirrors the
 * backend's list_base_cards) since it's a per-variant facet and would
 * defeat the point of returning whole base cards with their full variant
 * tail. */
export async function getBaseCardsList(
  filters: BaseCardListFilters = {}
): Promise<BaseCardCatalog[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  const res = await fetch(`/api/base-cards${qs ? `?${qs}` : ""}`);
  // BL-154: migrated from a bare `throw new Error`.
  if (!res.ok) throw new ApiError(`Failed to fetch base cards: ${res.status}`, res.status);
  return res.json();
}

/** BL-136 P4 (Definition_Pricing_2026-07-16.md §4): one daily market-price
 * point in a variant's history series. */
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

/** GET /api/base-cards/{base_card_id}/price-history -- BL-140. Anonymous
 * and catalog-cacheable (same posture as getBaseCardsList above): plain
 * fetch, no Authorization header, no per-tenant variance possible. 404s
 * (thrown as an Error here) if variant_id isn't actually a printing of
 * base_card_id. */
export async function getPriceHistory(
  baseCardId: number,
  variantId: number,
  range: PriceHistoryRange = "90d"
): Promise<PriceHistoryResponse> {
  const params = new URLSearchParams({ variant_id: String(variantId), range });
  const res = await fetch(`/api/base-cards/${baseCardId}/price-history?${params.toString()}`);
  // BL-154: migrated from a bare `throw new Error`.
  if (!res.ok) {
    throw new ApiError(
      `Failed to fetch price history for variant ${variantId}: ${res.status}`,
      res.status
    );
  }
  return res.json();
}
