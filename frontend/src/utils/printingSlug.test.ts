import { describe, expect, it } from "vitest";
import {
  defaultPrinting,
  findPrintingBySlug,
  isSlugShaped,
  linkSlug,
  printingSlug,
  printingSlugs,
  serializedTier,
} from "./printingSlug";
import type { SluggedPrinting } from "./printingSlug";
import { cardPageUrl } from "../public/publicCatalog";

// The `v` printing slug (App Spec §5.3): stable, unique per base card, and
// absent for the default printing.

function p(
  variant_id: number,
  finish: string | null,
  source_set_code: string,
  card_number: string,
  front_image_url: string | null = null,
  variant_type = finish ?? "Weekly Play"
): SluggedPrinting {
  return { variant_id, finish, variant_type, source_set_code, card_number, front_image_url };
}

const LUKE = [
  p(1, "Standard", "SOR", "5"),
  p(2, "Hyperspace", "SOR", "271"),
  p(3, "Standard Foil", "SOR", "5"),
  p(4, null, "SORP", "1", null, "Weekly Play Foil"),
];

const cdn = (file: string) => `https://cdn.starwarsunlimited.com//${file}`;
// The three Serialized Prestige tiers of one SEC card: one finish, one set,
// one number; only the image file name tells them apart.
const SENATOR = [
  p(10, "Standard", "SEC", "101"),
  p(
    13,
    "Serialized Prestige",
    "SEC",
    "1127",
    cdn("card_06371127_EN_Queen_Amidala_Carb_C_Gold_90e09826a7.png")
  ),
  p(
    12,
    "Serialized Prestige",
    "SEC",
    "1127",
    cdn("card_06361127_EN_Queen_Amidala_Carb_C_Rose_Gold_2b8aab49ba.png")
  ),
  p(
    11,
    "Serialized Prestige",
    "SEC",
    "1127",
    cdn("card_06341127_EN_Queen_Amidala_Carb_C_febf35c9ee.png")
  ),
];

describe("printing slug", () => {
  it("is finish, source set and card number, as the card pages already spell it", () => {
    expect([...printingSlugs(LUKE).values()]).toEqual([
      "standard-sor-5",
      "hyperspace-sor-271",
      "standard-foil-sor-5",
      "weekly-play-foil-sorp-1",
    ]);
  });

  it("keeps the Carbonite tier's slug and names the other Serialized tiers", () => {
    const s = printingSlugs(SENATOR);
    expect(s.get(11)).toBe("serialized-prestige-sec-1127");
    expect(s.get(12)).toBe("serialized-prestige-sec-1127-rose-gold");
    expect(s.get(13)).toBe("serialized-prestige-sec-1127-gold");
  });

  it("does not depend on the order the printings arrive in", () => {
    const reversed = printingSlugs([...SENATOR].reverse());
    expect([...reversed.entries()].sort()).toEqual([...printingSlugs(SENATOR).entries()].sort());
  });

  it("reads the tier from a same-origin copy of the image as from the CDN", () => {
    const sameOrigin = SENATOR.map((v) => ({
      ...v,
      front_image_url:
        v.front_image_url?.replace(
          "https://cdn.starwarsunlimited.com//",
          "https://www.hyperspacevault.com/images/cards/"
        ) ?? null,
    }));
    expect([...printingSlugs(sameOrigin).entries()].sort()).toEqual(
      [...printingSlugs(SENATOR).entries()].sort()
    );
    expect(serializedTier("/images/cards/x_Carb_C_Rose_Gold_2b8a.png")).toBe("Rose Gold");
    expect(serializedTier("/images/cards/x.png")).toBeNull();
    expect(serializedTier(null)).toBeNull();
  });

  it("numbers any other clash in image-file-name order, so every slug is unique", () => {
    const twins = [
      p(21, "Showcase", "TWI", "300", "b.png"),
      p(20, "Showcase", "TWI", "300", "a.png"),
      p(22, "Showcase", "TWI", "300", "c.png"),
    ];
    const s = printingSlugs(twins);
    expect(s.get(20)).toBe("showcase-twi-300");
    expect(s.get(21)).toBe("showcase-twi-300-2");
    expect(s.get(22)).toBe("showcase-twi-300-3");
    expect(new Set(s.values()).size).toBe(3);
  });

  it("round-trips: every printing is found by its own slug", () => {
    for (const card of [LUKE, SENATOR]) {
      for (const v of card) expect(findPrintingBySlug(card, printingSlug(card, v))).toBe(v);
    }
    expect(findPrintingBySlug(LUKE, "hyperspace-twi-1")).toBeNull();
    expect(findPrintingBySlug(LUKE, null)).toBeNull();
    expect(findPrintingBySlug(LUKE, "")).toBeNull();
  });

  it("is omitted for the default printing: Standard, else the first", () => {
    expect(defaultPrinting(LUKE)?.variant_id).toBe(1);
    expect(linkSlug(LUKE, LUKE[0])).toBeNull();
    expect(linkSlug(LUKE, LUKE[1])).toBe("hyperspace-sor-271");
    const noStandard = [p(31, "Hyperspace", "SOR", "300"), p(32, "Showcase", "SOR", "301")];
    expect(linkSlug(noStandard, noStandard[0])).toBeNull();
    expect(linkSlug(noStandard, noStandard[1])).toBe("showcase-sor-301");
    expect(defaultPrinting([])).toBeNull();
  });

  it("has a fixed shape; anything else is not a slug", () => {
    expect(isSlugShaped("hyperspace-sor-271")).toBe(true);
    for (const bad of [null, undefined, "", "Hyperspace", "a b", "a&b", "<x>", "a".repeat(81)]) {
      expect(isSlugShaped(bad)).toBe(false);
    }
  });
});

describe("card link", () => {
  const card = { set_code: "SOR", base_card_number: "5", variants: LUKE };

  it("is the public page on the canonical origin, with v only off the default", () => {
    expect(cardPageUrl(card, LUKE[0])).toBe("https://www.hyperspacevault.com/cards/sor/005/");
    expect(cardPageUrl(card, LUKE[3])).toBe(
      "https://www.hyperspacevault.com/cards/sor/005/?v=weekly-play-foil-sorp-1"
    );
    expect(cardPageUrl(card, null)).toBe("https://www.hyperspacevault.com/cards/sor/005/");
  });
});
