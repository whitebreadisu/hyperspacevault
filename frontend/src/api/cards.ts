import type { ImageRenditions } from "./baseCards";

/** The flat one-row-per-variant card shape. No endpoint returns it (the app
 * reads /api/base-cards); it exists because CardWithQty (api/inventory.ts)
 * extends it, and the Add Cards resolver test fixtures are deliberately
 * typed against that flat-variant shape (see utils/addCardsResolver.ts's
 * contract note). */
export interface Card {
  id: number;
  base_card_id: number;
  set_id: number;
  set_code: string;
  base_card_number: string;
  card_number: string;
  name: string;
  subtitle: string | null;
  rarity: string;
  type: string;
  variant_type: string;
  finish: string | null;
  channel: string;
  stamped: boolean;
  is_token: boolean;
  source_set_code: string;
  swuapi_id: string;
  front_image_url: string | null;
  back_image_url: string | null;
  /** Additive/optional -- see api/baseCards.ts's VariantDetail doc comment
   * for why `?:` and not just `| null`. */
  front_images?: ImageRenditions | null;
  back_images?: ImageRenditions | null;
  stamp_group: string | null;
  aspects: string[];
  keywords: string[];
  traits: string[];
  cost: number | null;
  power: number | null;
  hp: number | null;
  arena: string | null;
}
