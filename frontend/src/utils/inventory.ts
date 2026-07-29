import type { BaseCard, SetOrderMap, Variant } from "./catalog";
import { sortBaseCards } from "./catalog";
import type { BaseCardCatalogWithQuantity } from "../api/baseCards";
import { deriveRenditions } from "./cardImages";

export const PLAYSET_SIZE = 3;

const SINGLETON_TYPES = new Set(["Leader", "Base"]);

export function getPlaysetSize(type: string): number {
  return SINGLETON_TYPES.has(type) ? 1 : PLAYSET_SIZE;
}

export function cardOwnedTotal(inventory: Record<number, number>): number {
  return Object.values(inventory).reduce((sum, qty) => sum + (qty || 0), 0);
}

export function isPlaysetComplete(inventory: Record<number, number>, type: string): boolean {
  return cardOwnedTotal(inventory) >= getPlaysetSize(type);
}

export function isOwned(inventory: Record<number, number>): boolean {
  return cardOwnedTotal(inventory) > 0;
}

export interface InventoryVariant extends Variant {
  quantity: number;
}

export interface InventoryCard extends BaseCard {
  variants: InventoryVariant[];
  inventory: Record<number, number>;
}

export function cardOwnedTotalFromVariants(variants: InventoryVariant[]): number {
  return variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
}

/** BL-44 Slice B (ADR-0005): builds the same InventoryCard shape/inventory-map
 * `groupWithInventory` used to build (see git history), but from the
 * base-cards *list* endpoint's already-nested-by-base-card response instead
 * of a flat per-variant CardWithQty[] that had to be grouped client-side.
 * There is no grouping pass here -- each entry in `baseCards` already *is*
 * one base card; this only reshapes field names and rebuilds the
 * `inventory: variant_id -> quantity` map (still keyed by variant id, still
 * fed straight from each variant's `quantity`) that PlaysetCell (screens/
 * cards/PlaysetCell.tsx -- the merged Playset/Inventory cell, BL-162) and
 * the completion math (isPlaysetComplete/isOwned) all read.
 * One fetch (getBaseCardsList) now serves both auth states: quantity is real
 * when signed in and 0 across the board when anonymous (server-side,
 * optional-auth), so this same mapping is correct for both.
 *
 * BL-146: parameter type changed from BaseCardDetail[] (the fat detail
 * shape) to BaseCardCatalogWithQuantity[] (the slim list shape + merged
 * quantity, api/baseCards.ts) -- the list endpoint never actually returned
 * BaseCardDetail's fields even before this split (quantity itself was
 * always a client-side merge, see CardsPage.tsx), but the two shapes were
 * structurally compatible by coincidence until the list slimmed down.
 * front_images/back_images are now computed here via deriveRenditions
 * (utils/cardImages.ts) instead of read off the response, since the API no
 * longer ships them on the list at all (Design_SparseList_2026-07-25.md
 * §3). */
export function toInventoryCards(
  baseCards: BaseCardCatalogWithQuantity[],
  setOrder: SetOrderMap = {}
): InventoryCard[] {
  const result: InventoryCard[] = baseCards.map((base) => {
    const inventory: Record<number, number> = {};
    const variants: InventoryVariant[] = base.variants.map((v) => {
      inventory[v.variant_id] = v.quantity;
      return {
        variant_id: v.variant_id,
        variant_type: v.variant_type,
        finish: v.finish,
        channel: v.channel,
        source_set_code: v.source_set_code,
        card_number: v.card_number,
        front_image_url: v.front_image_url,
        back_image_url: v.back_image_url,
        front_images: v.front_image_url ? deriveRenditions(v.front_image_url) : undefined,
        back_images: v.back_image_url ? deriveRenditions(v.back_image_url) : undefined,
        quantity: v.quantity,
        // BL-163: passthrough so utils/completion.ts's Collection-value calc
        // can read each owned variant's own price.
        price: v.price,
      };
    });

    return {
      base_card_id: base.id,
      set_code: base.set_code,
      base_card_number: base.base_card_number,
      name: base.name,
      subtitle: base.subtitle,
      type: base.type,
      rarity: base.rarity,
      aspects: base.aspects,
      keywords: base.keywords,
      traits: base.traits,
      cost: base.cost,
      power: base.power,
      hp: base.hp,
      arena: base.arena,
      is_token: base.is_token,
      variants,
      inventory,
    };
  });

  return sortBaseCards(result, setOrder);
}
