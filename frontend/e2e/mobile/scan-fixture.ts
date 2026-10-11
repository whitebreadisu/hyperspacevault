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
//    "SS Top 8" vs Emperor's Messenger ASHP 16 "Weekly Play").
// Used only by the scanner specs (`cardsFixture: "base-cards-scan"`).

const here = dirname(fileURLToPath(import.meta.url));

type Slim = { id: number; set_code: string; base_card_number: string; [k: string]: unknown };

const variant = (vid: number, vt: string, src: string, num: string) => ({
  variant_id: vid,
  variant_type: vt,
  finish: vt,
  channel: vt === "Standard" ? "Retail" : "Promo",
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
  variants: ReturnType<typeof variant>[]
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
  is_token: false,
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
    out.push(
      card(980000 + n, "SOR", String(n), `Scan Filler ${n}`, "", [
        variant(970000 + n, "Standard", "SOR", String(n)),
      ])
    );
  }
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
