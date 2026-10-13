import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// BL-253 stage 7c (7b forks 1 + 2): the catalogue the scanner e2e loads. The
// committed 53-card fixture is a trim, so the scan catalogue derived from it
// (S7-07: main[base] = Standard non-token printings in the home set) came out
// at SOR 9, not the printed 252. This extends it, desktop-shaped, with
//  - filler SOR Standard printings for every number 1..252 the trim lacks, so
//    the SOR main size is the real 252 (and a clip printing 229/252 is valid);
//    their neighbours also make the keys weak (3-of-4), as on the real
//    catalogue;
//  - the ASHP 16 printed-code collision pair (spike catalogue: Grogu P26 16
//    "SS Top 8" vs Emperor's Messenger ASHP 16 "Weekly Play");
//  - BL-262: three shared-number shapes the trim lacks, with the live
//    catalogue's ids and fields (2026-10-13): Resupply's Weekly Play pair,
//    printed "SOR 12/20" (the base-set card at SOR 12 is another card); the
//    Experience token, printed "SOR T1"; and a Galactic Championship printing
//    (P26 172) on the filler at SOR 172 -- one card, two events, as Cinta Kaz
//    SEC 172 has. The trim already holds the others: SOR 74 (a base-set card
//    and the P25 74 Darth Vader Showcase), SOR 2 and the SOR N/2 small series.
// Used only by the scanner specs (`cardsFixture: "base-cards-scan"`).

const here = dirname(fileURLToPath(import.meta.url));

type Slim = { id: number; set_code: string; base_card_number: string; [k: string]: unknown };

const variant = (
  vid: number,
  vt: string,
  src: string,
  num: string,
  /** BL-262: the catalogue's own channel + finish for a printing whose
   * variant type is not a finish (omitted: the 7c shape, unchanged). */
  as?: { channel: string; finish: string | null }
) => ({
  variant_id: vid,
  variant_type: vt,
  finish: as ? as.finish : vt,
  channel: as ? as.channel : vt === "Standard" ? "Retail" : "Promo",
  source_set_code: src,
  card_number: num,
  front_image_url: null,
  back_image_url: null,
  price: null,
});

const card = (
  id: number,
  setCode: string,
  base: string,
  name: string,
  subtitle: string,
  variants: ReturnType<typeof variant>[],
  isToken = false
) => ({
  id,
  set_code: setCode,
  base_card_number: base,
  name,
  subtitle,
  type: "Unit",
  rarity: "Common",
  cost: 2,
  power: 1,
  hp: 4,
  arena: "Ground",
  is_token: isToken,
  aspects: [],
  keywords: [],
  traits: [],
  variants,
});

/** The cards added on top of the committed fixture. */
export function scanExtraCards(have: Slim[]): unknown[] {
  const sorHave = new Set(
    have.filter((c) => c.set_code === "SOR").map((c) => Number(c.base_card_number))
  );
  const out: unknown[] = [];
  for (let n = 1; n <= 252; n++) {
    if (sorHave.has(n)) continue;
    const variants = [variant(970000 + n, "Standard", "SOR", String(n))];
    // BL-262: one card, two events under one set + number (see the header).
    if (n === 172)
      variants.push(
        variant(922119, "GC Event Pack", "P26", "172", {
          channel: "Promo / Tournament-tier",
          finish: null,
        })
      );
    out.push(card(980000 + n, "SOR", String(n), `Scan Filler ${n}`, "", variants));
  }
  // BL-262: Resupply's Weekly Play printings carry the base set's own code and
  // a number another card holds in the base set (SOR 12 = the filler here).
  const wp = { channel: "Weekly Play", finish: null };
  out.push(
    card(1926, "SOR", "126", "Resupply", "", [
      variant(6317, "Weekly Play", "SOR", "12", wp),
      variant(6318, "Weekly Play Foil", "SOR", "12", wp),
    ])
  );
  // BL-262: a token shares its number with a card (SOR T1 / SOR 1).
  out.push(card(2146, "SOR", "1", "Experience", "", [variant(6267, "Standard", "SOR", "1")], true));
  // The ASHP 16 / P26 16 collision pair.
  out.push(
    card(991994, "ASH", "155", "Grogu", "Yes. Yes. Yes.", [
      variant(922105, "SS Top 8", "P26", "16"),
    ])
  );
  out.push(
    card(992031, "ASH", "155", "Emperor's Messenger", "", [
      variant(909292, "Weekly Play", "ASHP", "16"),
    ])
  );
  return out;
}

/** The scanner catalogue: the committed fixture + `scanExtraCards`. */
export function scanCards(): unknown[] {
  const base = JSON.parse(
    readFileSync(join(here, "fixtures", "base-cards.json"), "utf8")
  ) as Slim[];
  return [...base, ...scanExtraCards(base)];
}
