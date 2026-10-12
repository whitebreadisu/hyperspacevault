/* global console */
// BL-247 S1-10: one-shot fixture generator (a tool, not a test dependency --
// the generated JSON is committed). Reads the rev4 prototype's real-catalogue
// sample (window.M_CARDS / M_SETS / M_SEED_QTY) and writes JSON shaped to the
// app's own API types (api/baseCards.ts BaseCardCatalog/CatalogVariant,
// api/sets.ts CardSet, api/inventory.ts VariantQuantity,
// api/settingsLimits.ts LimitsResponseBody).
//   node e2e/mobile/gen-fixtures.mjs
import vm from "node:vm";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC =
  "F:/Projects/SWU-Inventory-Manager/.design-sync/screen-stage/mobile/rev4/lib/data-cards.js";
const OUT = join(here, "fixtures");
mkdirSync(OUT, { recursive: true });

const win = {};
vm.runInNewContext(readFileSync(SRC, "utf8"), { window: win });
const { M_CARDS, M_SETS, M_SEED_QTY } = win;

const slimVariant = (v) => ({
  variant_id: v.variant_id,
  variant_type: v.variant_type,
  finish: v.finish,
  channel: v.channel,
  source_set_code: v.source_set_code,
  card_number: v.card_number,
  front_image_url: v.front_image_url,
  back_image_url: v.back_image_url,
  price: v.price ? { ...v.price, as_of: "2026-09-27" } : null,
});

const slimCard = (c) => ({
  id: c.id,
  set_code: c.set_code,
  base_card_number: c.base_card_number,
  name: c.name,
  subtitle: c.subtitle,
  type: c.type,
  rarity: c.rarity,
  cost: c.cost,
  power: c.power,
  hp: c.hp,
  arena: c.arena,
  is_token: false,
  aspects: c.aspects,
  keywords: c.keywords,
  traits: c.traits,
  variants: c.variants.map(slimVariant),
});

const cards = M_CARDS.map(slimCard);
// BL-258 (FR2-05): the prototype set list predates Homeworlds. Hand-added rows so the
// e2e fixtures can observe HMW first (newest-first order); ids continue after the prototype ids.
const EXTRA_SETS = [
  { code: "HMW", name: "Homeworlds", is_base_set: true, release_date: null },
  { code: "HMWP", name: "Homeworlds Weekly Play", is_base_set: false, release_date: null },
];
const sets = [...M_SETS, ...EXTRA_SETS.filter((e) => !M_SETS.some((s) => s.code === e.code))].map(
  (s, i) => ({ id: i + 1, ...s })
);

const limitFor = (c) => (c.type === "Leader" || c.type === "Base" ? 1 : 3);
const repVariant = (c) => c.variants.find((v) => v.variant_type === "Standard") ?? c.variants[0];

// Quantities: the rev4 seed + the same extras rev4 adds (IBH complete; SOR 351
// Vader Hyperspace 1; ASH 316 Chimaera Hyperspace 3), plus one over-limit
// card and one at-limit card.
const qty = { ...M_SEED_QTY };
for (const c of M_CARDS) if (c.set_code === "IBH") qty[repVariant(c).variant_id] = limitFor(c);
qty[8598] = 3;
qty[6795] = 1;
const overCard = M_CARDS.find(
  (c) => c.type === "Unit" && c.set_code === "SHD" && !qty[repVariant(c).variant_id]
);
const atCard = M_CARDS.find((c) => c.type === "Event" && !qty[repVariant(c).variant_id]);
if (overCard) qty[repVariant(overCard).variant_id] = 5; // over the playset limit of 3
if (atCard) qty[repVariant(atCard).variant_id] = 3; // exactly at the limit
const quantities = Object.entries(qty)
  .map(([variant_id, quantity]) => ({ variant_id: Number(variant_id), quantity }))
  .sort((a, b) => a.variant_id - b.variant_id);

// Mirror of utils/limits.ts CANONICAL_BUCKETS (finishes, then channels).
const BUCKETS = [
  "Standard",
  "Standard Foil",
  "Hyperspace",
  "Hyperspace Foil",
  "Standard Prestige",
  "Foil Prestige",
  "Serialized Prestige",
  "Showcase",
  "Weekly Play",
  "Judge",
  "Convention",
  "Promo / Tournament-tier",
  "Movie",
  "Prerelease",
  "Retail",
];
const limits = {
  cap_mode: "hard",
  limits: ["singleton", "standard"].flatMap((type_category) =>
    BUCKETS.map((limit_bucket) => ({
      type_category,
      limit_bucket,
      max_quantity: type_category === "singleton" ? 1 : 3,
      is_default: true,
    }))
  ),
};

const account = { email: "e2e@hsv.test" };

// 600-row clone for the virtualisation test: distinct ids / variant ids / numbers.
const big = [];
for (let i = 0; i < 600; i++) {
  const c = cards[i % cards.length];
  const k = Math.floor(i / cards.length);
  big.push({
    ...c,
    id: c.id + 100000 * k,
    base_card_number: String(1000 + i),
    name: k === 0 ? c.name : `${c.name} ${k}`,
    variants: c.variants.map((v) => ({
      ...v,
      variant_id: v.variant_id + 1000000 * k,
      card_number: String(1000 + i),
    })),
  });
}

const write = (name, data) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 1) + "\n");
write("base-cards.json", cards);
write("sets.json", sets);
write("quantities.json", quantities);
write("limits.json", limits);
write("account.json", account);
write("base-cards-600.json", big);
console.log(
  `cards ${cards.length}, sets ${sets.length}, quantities ${quantities.length}, big ${big.length}`
);
