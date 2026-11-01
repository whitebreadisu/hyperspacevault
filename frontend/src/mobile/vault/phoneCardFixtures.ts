import type { BaseCardCatalogWithQuantity } from "../../api/baseCards";
import { toInventoryCards } from "../../utils/inventory";
import type { InventoryCard } from "../../utils/inventory";

type CatalogVariant = BaseCardCatalogWithQuantity["variants"][number];

export interface VariantSpec {
  id: number;
  finish: string;
  number: string;
  qty?: number;
  market?: number | null;
  set?: string;
  frontImage?: string | null;
  backImage?: string | null;
}

export interface CardSpec {
  id: number;
  name: string;
  subtitle?: string | null;
  type?: string;
  set?: string;
  number?: string;
  rarity?: string;
  aspects?: string[];
  traits?: string[];
  cost?: number | null;
  power?: number | null;
  hp?: number | null;
  variants: VariantSpec[];
}

function catalogVariant(spec: VariantSpec): CatalogVariant {
  const market = spec.market ?? null;
  return {
    variant_id: spec.id,
    variant_type: spec.finish,
    finish: spec.finish,
    channel: "Retail",
    source_set_code: spec.set ?? "SOR",
    card_number: spec.number,
    front_image_url: spec.frontImage ?? null,
    back_image_url: spec.backImage ?? null,
    price: market == null ? null : { market, low: market / 2, as_of: "2026-10-01" },
    quantity: spec.qty ?? 0,
  } as CatalogVariant;
}

export function phoneCard(spec: CardSpec): InventoryCard {
  const catalog = {
    id: spec.id,
    set_code: spec.set ?? "SOR",
    base_card_number: spec.number ?? spec.variants[0].number,
    name: spec.name,
    subtitle: spec.subtitle ?? null,
    type: spec.type ?? "Unit",
    rarity: spec.rarity ?? "Rare",
    cost: spec.cost ?? null,
    power: spec.power ?? null,
    hp: spec.hp ?? null,
    arena: "Ground",
    is_token: false,
    aspects: spec.aspects ?? [],
    keywords: [],
    traits: spec.traits ?? [],
    variants: spec.variants.map(catalogVariant),
  } as BaseCardCatalogWithQuantity;
  return toInventoryCards([catalog])[0];
}

export const STANDARD = "Standard";
export const HYPERSPACE = "Hyperspace";
export const SHOWCASE = "Showcase";

const IMAGE = "https://cdn.example.com/cards/vader.png";
const BACK_IMAGE = "https://cdn.example.com/cards/leader-back.png";

/** A Unit (playset of 3) with Standard and Hyperspace printings; `std` and
 * `hs` are the owned counts of each. */
export function unitCard(std: number, hs: number, over: Partial<CardSpec> = {}): InventoryCard {
  return phoneCard({
    id: 1,
    name: "Darth Vader",
    subtitle: "Commanding the First Wave",
    number: "87",
    variants: [
      { id: 11, finish: STANDARD, number: "87", qty: std, market: 6.8, frontImage: IMAGE },
      { id: 12, finish: HYPERSPACE, number: "339", qty: hs, market: 15, frontImage: IMAGE },
    ],
    ...over,
  });
}

/** A Leader (singleton, playset of 1) with Standard and Showcase printings. */
export function leaderCard(std: number, showcase: number, withBack = true): InventoryCard {
  return phoneCard({
    id: 2,
    name: "Luke Skywalker",
    subtitle: "Hero of Yavin",
    type: "Leader",
    number: "5",
    variants: [
      {
        id: 21,
        finish: STANDARD,
        number: "5",
        qty: std,
        market: 2,
        frontImage: IMAGE,
        backImage: withBack ? BACK_IMAGE : null,
      },
      {
        id: 22,
        finish: SHOWCASE,
        number: "260",
        qty: showcase,
        market: 325,
        frontImage: IMAGE,
        backImage: withBack ? BACK_IMAGE : null,
      },
    ],
  });
}

/** A Base (singleton) with no subtitle; its first trait stands in for one. */
export function baseCard(owned: number): InventoryCard {
  return phoneCard({
    id: 3,
    name: "Echo Base",
    type: "Base",
    traits: ["Rebel"],
    number: "20",
    variants: [{ id: 31, finish: STANDARD, number: "20", qty: owned, market: 0.2 }],
  });
}

/** A card with one unpriced Standard printing and no image. */
export function unpricedCard(owned: number): InventoryCard {
  return phoneCard({
    id: 4,
    name: "Lieutenant Childsen",
    number: "35",
    variants: [{ id: 41, finish: STANDARD, number: "35", qty: owned, market: null }],
  });
}
