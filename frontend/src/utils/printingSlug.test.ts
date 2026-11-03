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
import { cardPageUrl, shareOrigin, toPageCard } from "../public/publicCatalog";
import type { PublicCard, PublicCatalog } from "../public/publicCatalog";
import fixture from "../../scripts/public-pages/fixtures/catalog.json";

// The `v` printing slug (App Spec §5.3): stable across catalogue refreshes,
// unique per base card, always slug-shaped, and absent for the default
// printing.

function p(
  variant_id: number,
  finish: string | null,
  source_set_code: string,
  card_number: string,
  front_image_url: string | null = null,
  variant_type = finish ?? "Weekly Play",
  channel = "Retail"
): SluggedPrinting {
  return {
    variant_id,
    finish,
    variant_type,
    channel,
    source_set_code,
    card_number,
    front_image_url,
  };
}

const LUKE = [
  p(1, "Standard", "SOR", "5"),
  p(2, "Hyperspace", "SOR", "271"),
  p(3, "Standard Foil", "SOR", "5"),
  p(4, null, "SORP", "1", null, "Weekly Play Foil"),
];

const CDN = "https://cdn.starwarsunlimited.com//";
// SEC 101 Queen Amidala as the list endpoint returns it (production,
// 2026-11): fourteen printings, the three Serialized Prestige tiers sharing
// one finish, set and number.
const AMIDALA: SluggedPrinting[] = [
  [
    411,
    "Judge Program",
    null,
    "Judge",
    "J25",
    "16",
    "card_J25070016_EN_Queen_Amidala_8971ab3dec.png",
  ],
  [
    3852,
    "SS Top 8",
    null,
    "Promo / Tournament-tier",
    "P25",
    "27",
    "card_P25410027_EN_Queen_Amidala_OP_Top8_cfab40d4f2.png",
  ],
  [
    3853,
    "SS Top 4",
    null,
    "Promo / Tournament-tier",
    "P25",
    "28",
    "card_P25420028_EN_Queen_Amidala_OP_Top4_c298e933b7.png",
  ],
  [
    3854,
    "SS Finalist",
    null,
    "Promo / Tournament-tier",
    "P25",
    "29",
    "card_P25430029_EN_Queen_Amidala_OP_Finalist_3371960996.png",
  ],
  [
    3857,
    "SS Champion",
    null,
    "Promo / Tournament-tier",
    "P25",
    "30",
    "card_P25440030_EN_Queen_Amidala_OP_Champion_f9fd90bf45.png",
  ],
  [
    4036,
    "Standard",
    "Standard",
    "Retail",
    "SEC",
    "101",
    "card_06010101_EN_Queen_Amidala_2750936c4b.png",
  ],
  [
    4071,
    "Standard Prestige",
    "Standard Prestige",
    "Retail",
    "SEC",
    "1041",
    "card_06061041_EN_Queen_Amidala_Carb_A_761ccfc8a6.png",
  ],
  [
    4118,
    "Foil Prestige",
    "Foil Prestige",
    "Retail",
    "SEC",
    "1084",
    "card_06331084_EN_Queen_Amidala_Carb_B_f8e0045e84.png",
  ],
  [
    4170,
    "Serialized Prestige",
    "Serialized Prestige",
    "Retail",
    "SEC",
    "1127",
    "card_06341127_EN_Queen_Amidala_Carb_C_febf35c9ee.png",
  ],
  [
    4171,
    "Serialized Prestige",
    "Serialized Prestige",
    "Retail",
    "SEC",
    "1127",
    "card_06361127_EN_Queen_Amidala_Carb_C_Rose_Gold_2b8aab49ba.png",
  ],
  [
    4172,
    "Serialized Prestige",
    "Serialized Prestige",
    "Retail",
    "SEC",
    "1127",
    "card_06371127_EN_Queen_Amidala_Carb_C_Gold_90e09826a7.png",
  ],
  [
    4530,
    "Hyperspace",
    "Hyperspace",
    "Retail",
    "SEC",
    "365",
    "card_06020365_EN_Queen_Amidala_50fea15d4d.png",
  ],
  [
    4797,
    "Standard Foil",
    "Standard Foil",
    "Retail",
    "SEC",
    "611",
    "card_06310611_EN_Queen_Amidala_7b4c7ca533.png",
  ],
  [
    5061,
    "Hyperspace Foil",
    "Hyperspace Foil",
    "Retail",
    "SEC",
    "857",
    "card_06320857_EN_Queen_Amidala_cdb93900b8.png",
  ],
].map(([variant_id, variant_type, finish, channel, source_set_code, card_number, file]) => ({
  variant_id: variant_id as number,
  variant_type: variant_type as string,
  finish: finish as string | null,
  channel: channel as string,
  source_set_code: source_set_code as string,
  card_number: card_number as string,
  front_image_url: CDN + (file as string),
}));

const slugOf = (vs: readonly SluggedPrinting[], id: number) => printingSlugs(vs).get(id);
const sorted = (m: Map<number, string>) => [...m.entries()].sort((a, b) => a[0] - b[0]);

describe("printing slug", () => {
  it("is finish, source set and card number, as the card pages already spell it", () => {
    expect([...printingSlugs(LUKE).values()]).toEqual([
      "standard-sor-5",
      "hyperspace-sor-271",
      "standard-foil-sor-5",
      "weekly-play-foil-sorp-1",
    ]);
  });

  it("names the Serialized tiers on a real SEC card: Carbonite plain, Gold and Rose Gold suffixed", () => {
    const s = printingSlugs(AMIDALA);
    expect(s.get(4170)).toBe("serialized-prestige-sec-1127");
    expect(s.get(4171)).toBe("serialized-prestige-sec-1127-rose-gold");
    expect(s.get(4172)).toBe("serialized-prestige-sec-1127-gold");
    expect(s.get(4071)).toBe("standard-prestige-sec-1041");
    expect(s.get(411)).toBe("judge-program-j25-16");
    expect(new Set(s.values()).size).toBe(AMIDALA.length);
    expect(
      linkSlug(
        AMIDALA,
        AMIDALA.find((v) => v.variant_id === 4036)!
      )
    ).toBeNull();
  });

  it("suffixes a tier even when it is the only Serialized printing in the catalogue", () => {
    const gold = AMIDALA.find((v) => v.variant_id === 4172)!;
    const alone = AMIDALA.filter((v) => v.variant_id !== 4170 && v.variant_id !== 4171);
    expect(slugOf(alone, 4172)).toBe("serialized-prestige-sec-1127-gold");
    expect(slugOf([gold], 4172)).toBe("serialized-prestige-sec-1127-gold");
    expect(serializedTier(gold.front_image_url)).toBe("Gold");
  });

  it("does not depend on the order the printings arrive in", () => {
    for (const card of [LUKE, AMIDALA]) {
      expect(sorted(printingSlugs([...card].reverse()))).toEqual(sorted(printingSlugs(card)));
    }
  });

  it("gives clashing printings a token from their own identity, never a position", () => {
    const a = p(21, "Showcase", "TWI", "300", "x/card_b_1.png", "Showcase", "Retail");
    const b = p(22, "Showcase", "TWI", "300", "x/card_c_2.png", "Showcase", "Convention");
    const s = printingSlugs([a, b]);
    expect(s.get(21)).toMatch(/^showcase-twi-300-[a-z0-9]{7}$/);
    expect(s.get(22)).toMatch(/^showcase-twi-300-[a-z0-9]{7}$/);
    expect(s.get(21)).not.toBe(s.get(22));
    // Adding a printing that would sort first moves neither existing slug.
    const earlier = p(1, "Showcase", "TWI", "300", "x/card_a_0.png", "Showcase", "Event");
    const s3 = printingSlugs([earlier, a, b]);
    expect(s3.get(21)).toBe(s.get(21));
    expect(s3.get(22)).toBe(s.get(22));
    expect(new Set(s3.values()).size).toBe(3);
    // The token is the same on every environment: ids do not enter it.
    expect(
      slugOf(
        [
          { ...a, variant_id: 9001 },
          { ...b, variant_id: 9002 },
        ],
        9001
      )
    ).toBe(s.get(21));
  });

  it("never lets a suffixed slug equal another printing's natural slug", () => {
    // Two clashing printings whose suffixed slugs could be mistaken for a
    // third printing's natural one: every natural slug is reserved first.
    const twinA = p(31, "Standard", "SOR", "5", "x/a.png", "Standard", "Retail");
    const twinB = p(32, "Standard", "SOR", "5", "x/b.png", "Standard", "Promo");
    const tokenOf = printingSlugs([twinA, twinB]).get(31)!.split("-").pop()!;
    // A printing whose natural slug is exactly twinA's would-be suffixed slug.
    const squatter = p(33, "Standard", "SOR", `5-${tokenOf}`, null, "Standard", "Retail");
    const s = printingSlugs([twinA, twinB, squatter]);
    expect(s.get(33)).toBe(`standard-sor-5-${tokenOf}`);
    expect(s.get(31)).not.toBe(s.get(33));
    expect(new Set(s.values()).size).toBe(3);
  });

  it("reads alike from the list's CDN URLs and from toPageCard's same-origin copies", () => {
    const card = {
      id: 1,
      set_code: "SEC",
      base_card_number: "101",
      name: "Queen Amidala",
      traits: [],
      keywords: [],
      variants: AMIDALA.map((v) => {
        const stem = v.front_image_url!.slice(v.front_image_url!.lastIndexOf("/") + 1, -4);
        return {
          ...v,
          back_image_url: null,
          front_images: {
            original: `/images/cards/${stem}.png`,
            w640: `/images/cards/${stem}_640.webp`,
            w320: `/images/cards/${stem}_320.webp`,
          },
          back_images: null,
        };
      }),
    } as unknown as PublicCard;
    const page = toPageCard(card);
    expect(page.variants[0].front_image_url).toMatch(
      /^https:\/\/www\.hyperspacevault\.com\/images\/cards\/card_J25070016/
    );
    expect(sorted(printingSlugs(page.variants))).toEqual(sorted(printingSlugs(AMIDALA)));
  });

  it("is always slug-shaped: the fixture catalogue and odd card numbers", () => {
    for (const c of (fixture as unknown as PublicCatalog).cards) {
      const page = toPageCard(c);
      for (const vs of [c.variants, page.variants]) {
        for (const s of printingSlugs(vs).values()) expect(isSlugShaped(s)).toBe(true);
      }
    }
    const odd = ["T01", "12a", "1/2", "★7", " 5 ", "--", "", "ÆØ-3", "A".repeat(20)];
    const vs = odd.map((n, i) => p(100 + i, "Foil Prestige", "TS26", n, null));
    const s = printingSlugs(vs);
    for (const slug of s.values()) expect(isSlugShaped(slug)).toBe(true);
    expect(s.get(100)).toBe("foil-prestige-ts26-t01");
    expect(new Set(s.values()).size).toBe(odd.length);
  });

  it("round-trips: every printing is found by its own slug", () => {
    for (const card of [LUKE, AMIDALA]) {
      for (const v of card) expect(findPrintingBySlug(card, printingSlug(card, v))).toBe(v);
    }
    expect(findPrintingBySlug(LUKE, "hyperspace-twi-1")).toBeNull();
    expect(findPrintingBySlug(LUKE, null)).toBeNull();
    expect(findPrintingBySlug(LUKE, "")).toBeNull();
  });

  it("is omitted for the default printing: the lowest-id Standard, else the lowest id", () => {
    expect(defaultPrinting(LUKE)?.variant_id).toBe(1);
    expect(linkSlug(LUKE, LUKE[0])).toBeNull();
    expect(linkSlug(LUKE, LUKE[1])).toBe("hyperspace-sor-271");
    const twoStandard = [p(9, "Standard", "SOR", "9"), p(4, "Standard", "SORP", "4")];
    expect(defaultPrinting(twoStandard)?.variant_id).toBe(4);
    expect(defaultPrinting([...twoStandard].reverse())?.variant_id).toBe(4);
    const noStandard = [p(32, "Showcase", "SOR", "301"), p(31, "Hyperspace", "SOR", "300")];
    expect(defaultPrinting(noStandard)?.variant_id).toBe(31);
    expect(linkSlug(noStandard, noStandard[1])).toBeNull();
    expect(linkSlug(noStandard, noStandard[0])).toBe("showcase-sor-301");
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

  it("is the public page on the given origin, with v only off the default", () => {
    const prod = "https://www.hyperspacevault.com";
    expect(cardPageUrl(card, LUKE[0], prod)).toBe("https://www.hyperspacevault.com/cards/sor/005/");
    expect(cardPageUrl(card, LUKE[3], prod)).toBe(
      "https://www.hyperspacevault.com/cards/sor/005/?v=weekly-play-foil-sorp-1"
    );
    expect(cardPageUrl(card, null, prod)).toBe("https://www.hyperspacevault.com/cards/sor/005/");
  });

  it("names the canonical origin on production and the page's own origin elsewhere", () => {
    const at = (hostname: string, origin: string) => shareOrigin({ hostname, origin });
    expect(at("www.hyperspacevault.com", "https://www.hyperspacevault.com")).toBe(
      "https://www.hyperspacevault.com"
    );
    expect(at("hyperspacevault.com", "https://hyperspacevault.com")).toBe(
      "https://www.hyperspacevault.com"
    );
    expect(at("swu-dev-jbapps.web.app", "https://swu-dev-jbapps.web.app")).toBe(
      "https://swu-dev-jbapps.web.app"
    );
    expect(at("localhost", "http://localhost:5173")).toBe("http://localhost:5173");
    // Dev's copied link opens dev's page, not prod's.
    expect(
      cardPageUrl(card, LUKE[3], at("swu-dev-jbapps.web.app", "https://swu-dev-jbapps.web.app"))
    ).toBe("https://swu-dev-jbapps.web.app/cards/sor/005/?v=weekly-play-foil-sorp-1");
  });
});
