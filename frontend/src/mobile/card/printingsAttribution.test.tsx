import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BaseCardCatalogWithQuantity } from "../../api/baseCards";
import { toInventoryCards } from "../../utils/inventory";
import { READ_ONLY_STEPPER } from "./CardPage";
import { Printings } from "./Printings";

// The attribution line under the phone Variants list (App Spec §25.2,
// §5.10 / §16.4: "Prices via TCGplayer" + the as-of date on every priced
// surface), in the app: signed in, and in a shared vault. CREATE.

const base: BaseCardCatalogWithQuantity = {
  id: 7,
  set_code: "SOR",
  base_card_number: "5",
  name: "Luke Skywalker",
  subtitle: "Faithful Friend",
  type: "Leader",
  rarity: "Special",
  cost: 6,
  power: 4,
  hp: 7,
  arena: null,
  is_token: false,
  aspects: ["Heroism"],
  keywords: [],
  traits: [],
  variants: [
    {
      variant_id: 1,
      variant_type: "Standard",
      finish: "Standard",
      channel: "Retail",
      stamped: false,
      source_set_code: "SOR",
      card_number: "5",
      front_image_url: null,
      back_image_url: null,
      stamp_group: null,
      price: { market: 3.5, low: 3, as_of: "2026-10-30" },
      quantity: 2,
    },
    {
      variant_id: 2,
      variant_type: "Hyperspace",
      finish: "Hyperspace",
      channel: "Retail",
      stamped: false,
      source_set_code: "SORP",
      card_number: "1",
      front_image_url: null,
      back_image_url: null,
      stamp_group: null,
      price: null,
      quantity: 0,
    },
  ],
} as unknown as BaseCardCatalogWithQuantity;

function renderPrintings(opts: { readOnly: boolean }) {
  const [card] = toInventoryCards([base]);
  render(
    <Printings
      card={card}
      setNameByCode={{ SOR: "Spark of Rebellion", SORP: "SOR Weekly Play" }}
      selectedId={1}
      onSelect={() => {}}
      priceKind="market"
      onPriceKind={() => {}}
      isAuthenticated
      stepper={READ_ONLY_STEPPER}
      limits={null}
      capMode="hard"
      onRequestSignIn={() => {}}
      readOnly={opts.readOnly}
    />
  );
}

describe("phone printings attribution line", () => {
  it.each([
    ["signed in", false],
    ["in a shared vault", true],
  ])("%s: dated, with the unpriced count, and the app's Base set label", (_, readOnly) => {
    renderPrintings({ readOnly });
    const line = screen.getByText("Prices via TCGplayer · as of Oct 30, 2026 · 1 unpriced");
    expect(line.className).toContain("m-print__attribution");
    expect(screen.getByText("Base set")).toBeTruthy();
  });
});
