import { describe, expect, it } from "vitest";
import { railPrice } from "../mobile/card/cardDetailModel";
import { cardValue } from "./completion";
import type { PriceMode } from "./completion";
import type { InventoryCard, InventoryVariant } from "./inventory";
import { cardCollectionValue, cardValuePrice } from "./variantScope";

// The per-variant price selector: one printing's price for the active kind,
// or nothing. Every surface that reads a printing's price agrees on which
// number it is; the shapes they print it in differ. Pinned over the price
// shapes a catalogue response can carry.

type Price = InventoryVariant["price"] | undefined;
const PRICES: [string, Price][] = [
  ["no price row", null],
  ["stale response", undefined],
  ["market and low", { market: 2.5, low: 1, as_of: "2026-10-01" }],
  ["low only", { market: null, low: 0.4, as_of: "2026-10-01" }],
  ["market only, zero", { market: 0, low: null, as_of: "2026-10-01" }],
];
const variant = (price: Price, quantity = 1): InventoryVariant =>
  ({
    variant_id: 1,
    variant_type: "Hyperspace",
    finish: "Hyperspace",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "300",
    front_image_url: null,
    back_image_url: null,
    price,
    quantity,
  }) as InventoryVariant;
const card = (v: InventoryVariant): InventoryCard =>
  ({
    base_card_id: 1,
    type: "Unit",
    is_token: false,
    variants: [v],
    inventory: { 1: v.quantity },
  }) as unknown as InventoryCard;

// Pinned on the unmodified source (2026-10-31), per kind:
// [selected number, rail text, card value, collection value of 2 copies].
const PINNED: Record<string, Record<PriceMode, [number | null, string, number, number | null]>> = {
  "no price row": { market: [null, "—", 0, null], low: [null, "—", 0, null] },
  "stale response": { market: [null, "—", 0, null], low: [null, "—", 0, null] },
  "market and low": { market: [2.5, "$2.50", 2.5, 5], low: [1, "$1.00", 1, 2] },
  "low only": { market: [null, "—", 0, null], low: [0.4, "$0.40", 0.4, 0.8] },
  "market only, zero": { market: [0, "$0.00", 0, 0], low: [null, "—", 0, null] },
};

describe("per-variant price selector", () => {
  for (const [label, price] of PRICES)
    for (const kind of ["market", "low"] as const)
      it(`${label}, ${kind}`, () => {
        const v = variant(price);
        const got = [
          cardValuePrice([v], "Hyperspace", kind),
          railPrice(v, kind),
          cardValue(card(v), kind).value,
          cardCollectionValue([variant(price, 2)], "Hyperspace", kind),
        ];
        expect(got).toEqual(PINNED[label][kind]);
        // The rail prints exactly the selected number, or the dash.
        const n = got[0] as number | null;
        expect(got[1]).toBe(n == null ? "—" : `$${n.toFixed(2)}`);
        // The completion panel counts an unpriced owned printing once.
        expect(cardValue(card(v), kind).unpriced).toBe(n == null ? 1 : 0);
      });
});
