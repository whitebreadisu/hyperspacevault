import { describe, it, expect } from "vitest";
import { toInventoryCards } from "./inventory";
import type { BaseCardCatalogWithQuantity, CatalogVariantWithQuantity } from "../api/baseCards";

// DISPOSITION (BL-44 Slice B): this suite REPLACEs the old groupWithInventory
// suite and RETIREs the withoutInventory suite.
//
// - groupWithInventory (flat CardWithQty[] -> InventoryCard[], grouping by
//   base_card_id) -> REPLACE with toInventoryCards (nested BaseCardDetail[]
//   -> InventoryCard[], reshape only -- no grouping pass, since the
//   base-cards list endpoint already groups by base card). Same assertions
//   ported onto the new input shape: standard-sort wiring, token-after-
//   non-token, curated-order fallback, set_code tiebreak, and the
//   variant_id -> quantity inventory map built from nested variants.
// - withoutInventory (decorate a public-catalog grouping with zeroed
//   ownership data for anonymous browsing) -> RETIRE. Its only caller
//   (CardsPage's anonymous branch, calling groupByBaseCard + withoutInventory
//   off getCards()) was removed: GET /api/base-cards is optional-auth and
//   already returns quantity: 0 for every variant when no token is present,
//   so toInventoryCards alone is correct for both auth states -- there is no
//   separate anonymous decoration step left to test.
//
// DISPOSITION (BL-146, fixture edit): toInventoryCards' parameter type
// changed from BaseCardDetail[] (fat detail shape) to
// BaseCardCatalogWithQuantity[] (slim list shape + merged quantity,
// api/baseCards.ts) -- the list endpoint never actually had BaseCardDetail's
// dropped fields even before this split, so this fixture just catches up to
// what was already true. Assertion content is unaffected -- none of these
// tests ever read the fields that moved to detail-only.

function makeVariant(
  overrides: Partial<CatalogVariantWithQuantity> = {}
): CatalogVariantWithQuantity {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "1",
    front_image_url: null,
    back_image_url: null,
    quantity: 0,
    ...overrides,
  };
}

function makeBaseCard(
  overrides: Partial<BaseCardCatalogWithQuantity> = {}
): BaseCardCatalogWithQuantity {
  return {
    id: 1,
    set_code: "SOR",
    base_card_number: "1",
    name: "Card",
    subtitle: null,
    type: "Unit",
    rarity: "C",
    cost: null,
    power: null,
    hp: null,
    arena: null,
    is_token: false,
    aspects: [],
    keywords: [],
    traits: [],
    variants: [makeVariant()],
    ...overrides,
  };
}

describe("toInventoryCards", () => {
  it("applies the standard sort using the provided setOrder", () => {
    const cards = [
      makeBaseCard({ id: 1, set_code: "SHD", base_card_number: "1" }),
      makeBaseCard({ id: 2, set_code: "SOR", base_card_number: "1" }),
    ];
    const result = toInventoryCards(cards, { SOR: "2024-03-08", SHD: "2024-08-02" });
    expect(result.map((c) => c.set_code)).toEqual(["SOR", "SHD"]);
  });

  it("sorts tokens after non-tokens within a set", () => {
    const cards = [
      makeBaseCard({ id: 1, set_code: "SOR", base_card_number: "1", is_token: true }),
      makeBaseCard({ id: 2, set_code: "SOR", base_card_number: "2", is_token: false }),
    ];
    const result = toInventoryCards(cards, { SOR: "2024-03-08" });
    expect(result.map((c) => c.base_card_id)).toEqual([2, 1]);
  });

  // DISPOSITION (PORT, unchanged expectation from groupWithInventory): SOR
  // and SHD are both in CURATED_SET_ORDER (catalog.ts), so with no setOrder
  // given the fallback is the curated index, not an alphabetical tiebreak.
  it("falls back to curated set order when no setOrder is given", () => {
    const cards = [
      makeBaseCard({ id: 1, set_code: "SHD", base_card_number: "1" }),
      makeBaseCard({ id: 2, set_code: "SOR", base_card_number: "1" }),
    ];
    const result = toInventoryCards(cards);
    expect(result.map((c) => c.set_code)).toEqual(["SOR", "SHD"]);
  });

  it("falls back to set_code tiebreak when sets have no release_date and no curated entry", () => {
    const cards = [
      makeBaseCard({ id: 1, set_code: "ZZZ", base_card_number: "1" }),
      makeBaseCard({ id: 2, set_code: "AAA", base_card_number: "1" }),
    ];
    const result = toInventoryCards(cards);
    expect(result.map((c) => c.set_code)).toEqual(["AAA", "ZZZ"]);
  });

  it("builds the variant_id -> quantity inventory map from the nested variants", () => {
    const cards = [
      makeBaseCard({
        id: 1,
        variants: [
          makeVariant({ variant_id: 1, quantity: 2 }),
          makeVariant({ variant_id: 2, variant_type: "Foil", finish: "Foil", quantity: 1 }),
        ],
      }),
    ];
    const result = toInventoryCards(cards);
    expect(result).toHaveLength(1);
    expect(result[0].inventory).toEqual({ 1: 2, 2: 1 });
  });

  it("carries each variant's quantity onto the InventoryVariant it produces", () => {
    const cards = [
      makeBaseCard({
        id: 1,
        variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      }),
    ];
    const result = toInventoryCards(cards);
    expect(result[0].variants[0].quantity).toBe(3);
  });

  // CREATE (BL-163): the completion panel's Collection-value calc
  // (utils/completion.ts) reads each InventoryVariant's `price` -- this
  // pins that toInventoryCards actually passes it through from the
  // CatalogVariantWithQuantity input, same as quantity above.
  it("carries each variant's price onto the InventoryVariant it produces", () => {
    const priced = { market: 5, low: 3, as_of: "2026-07-25" };
    const cards = [
      makeBaseCard({
        id: 1,
        variants: [
          makeVariant({ variant_id: 1, price: priced }),
          makeVariant({ variant_id: 2, price: null }),
        ],
      }),
    ];
    const result = toInventoryCards(cards);
    expect(result[0].variants[0].price).toEqual(priced);
    expect(result[0].variants[1].price).toBeNull();
  });

  // CREATE (BL-163): `price` is additive-optional (a stale pre-BL-163
  // cached list response omits the key entirely) -- toInventoryCards must
  // not fabricate a value when it's simply absent from the input.
  it("passes through an absent price as undefined (stale pre-BL-163 cached response)", () => {
    const cards = [makeBaseCard({ id: 1, variants: [makeVariant({ variant_id: 1 })] })];
    const result = toInventoryCards(cards);
    expect(result[0].variants[0].price).toBeUndefined();
  });

  // DISPOSITION (PORT, from the retired withoutInventory suite): the
  // anonymous zeroed-quantity behavior now lives server-side (GET
  // /api/base-cards returns quantity: 0 on every variant with no bearer
  // token, via get_optional_db) rather than as a client-side decoration
  // step -- this asserts toInventoryCards passes those zeros straight
  // through into both the InventoryVariant and the inventory map.
  it("passes through quantity 0 / an empty-valued inventory map for an anonymous (optional-auth) response", () => {
    const cards = [
      makeBaseCard({ id: 1, variants: [makeVariant({ variant_id: 1, quantity: 0 })] }),
    ];
    const result = toInventoryCards(cards);
    expect(result[0].inventory).toEqual({ 1: 0 });
    expect(result[0].variants[0].quantity).toBe(0);
  });
});
