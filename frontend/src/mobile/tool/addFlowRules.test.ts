import { describe, expect, it } from "vitest";
import type { BaseCardCatalog } from "../../api/baseCards";
import type { CardSet } from "../../api/sets";
import cardsJson from "../../../e2e/mobile/fixtures/base-cards.json";
import qtyJson from "../../../e2e/mobile/fixtures/quantities.json";
import setsJson from "../../../e2e/mobile/fixtures/sets.json";
import { decompose } from "../../utils/addCardsResolver";
import { toInventoryCards } from "../../utils/inventory";
import { capHandlingFor, FINISH_BUCKETS, matrixKey } from "../../utils/limits";
import type { LimitsMatrix } from "../../utils/limits";
import { printingReadout } from "../camera/readIdentity";
import { mergeQuantities } from "../../vault/useVaultData";
import type { BatchRow } from "./batch";
import { padReadout, padView, toCatalog } from "./padModel";
import { NO_PICKS } from "./toolStore";

// The add flow's keep-limit readout (the keypad's, from a typed set and
// number; the camera's, from the printing itself) and the finish vocabulary
// the keypad decomposes a printing with. Pinned over owned counts, batch
// sizes and limits that put each readout field on both sides of its line.

const sets = setsJson as CardSet[];
const qty: Record<number, number> = Object.fromEntries(
  qtyJson.map((q) => [q.variant_id, q.quantity])
);
const order = Object.fromEntries(sets.map((s) => [s.code, s.release_date]));
const cards = toInventoryCards(mergeQuantities(cardsJson as BaseCardCatalog[], qty), order);
const baseCatalog = toCatalog(cards);

const view = padView("SOR", "87", NO_PICKS, baseCatalog, cards);
const variantId = view.kind === "card" ? view.variant!.variant_id : -1;
const withOwned = (owned: number) =>
  baseCatalog.map((e) => (e.id === variantId ? { ...e, quantity: owned } : e));

const row = (n: number): BatchRow => ({
  id: "b-" + n,
  via: "keypad",
  force: false,
  setCode: "SOR",
  cardNumber: "87",
  picks: NO_PICKS,
  variantId,
  baseCardId: null,
});
const cell = (max: number | null) => ({
  [matrixKey("standard", "Standard")]: {
    type_category: "standard" as const,
    limit_bucket: "Standard",
    max_quantity: max,
    is_default: false,
  },
});
const LIMITS: [string, LimitsMatrix | null][] = [
  ["default", null],
  ["limit 2", cell(2)],
  ["no limit", cell(null)],
];

/** owned limit after | flags: A atLimit, O overLimit, F afterOver. */
function fmt(r: ReturnType<typeof printingReadout>): string {
  if (!r) return "null";
  const flags = `${r.atLimit ? "A" : "-"}${r.overLimit ? "O" : "-"}${r.afterOver ? "F" : "-"}`;
  return `${r.owned} ${r.limit ?? "none"} ${r.after} ${flags}`;
}

// Pinned on the unmodified source (2026-10-31), key "owned/inBatch | limits".
const PINNED: Record<string, string> = {
  "0/0 | default": "0 3 1 ---",
  "0/2 | default": "0 3 3 ---",
  "0/3 | default": "0 3 4 --F",
  "2/0 | default": "2 3 3 ---",
  "2/1 | default": "2 3 4 --F",
  "3/0 | default": "3 3 4 A--",
  "4/1 | default": "4 3 6 AO-",
  "0/0 | limit 2": "0 2 1 ---",
  "0/2 | limit 2": "0 2 3 --F",
  "0/3 | limit 2": "0 2 4 --F",
  "2/0 | limit 2": "2 2 3 A--",
  "2/1 | limit 2": "2 2 4 A--",
  "3/0 | limit 2": "3 2 4 AO-",
  "4/1 | limit 2": "4 2 6 AO-",
  "0/0 | no limit": "0 none 1 ---",
  "0/2 | no limit": "0 none 3 ---",
  "0/3 | no limit": "0 none 4 ---",
  "2/0 | no limit": "2 none 3 ---",
  "2/1 | no limit": "2 none 4 ---",
  "3/0 | no limit": "3 none 4 ---",
  "4/1 | no limit": "4 none 6 ---",
};

describe("add-flow keep-limit readout", () => {
  it("the fixture printing resolves from SOR 87", () => {
    expect(variantId).toBeGreaterThan(0);
  });

  for (const [label, limits] of LIMITS)
    for (const [owned, inBatch] of [
      [0, 0],
      [0, 2],
      [0, 3],
      [2, 0],
      [2, 1],
      [3, 0],
      [4, 1],
    ])
      it(`${owned}/${inBatch} | ${label}`, () => {
        const catalog = withOwned(owned);
        const batch = Array.from({ length: inBatch }, (_, i) => row(i));
        for (const capMode of ["hard", "soft"] as const) {
          const cam = printingReadout(variantId, batch, catalog, limits, capMode);
          const pad = padReadout("SOR", "87", NO_PICKS, batch, catalog, limits, capMode);
          expect(pad).toEqual(cam);
          expect(fmt(cam)).toBe(PINNED[`${owned}/${inBatch} | ${label}`]);
        }
      });
});

describe("the keypad's finish vocabulary", () => {
  // Pinned on the unmodified source (2026-10-31): the finish decompose gives.
  const PINNED_FINISH: [string, string][] = [
    ["Standard", "Standard"],
    ["Standard Foil", "Standard Foil"],
    ["Hyperspace", "Hyperspace"],
    ["Hyperspace Foil", "Hyperspace Foil"],
    ["Standard Prestige", "Standard Prestige"],
    ["Foil Prestige", "Foil Prestige"],
    ["Serialized Prestige", "Serialized Prestige"],
    ["Showcase", "Showcase"],
    ["Weekly Play", "Standard"],
    ["Weekly Play Foil", "Standard Foil"],
    ["SS Top 8 Foil", "Standard Foil"],
    ["Prerelease Promo", "Standard"],
    ["Convention Exclusive", "Standard"],
  ];
  it("each frozen finish is its own finish; anything else folds to (foil) Standard", () => {
    expect(PINNED_FINISH.map(([vt]) => [vt, decompose(vt, "Retail").finish])).toEqual(
      PINNED_FINISH
    );
  });
  it("the frozen finishes are the keep-limit finish buckets", () => {
    for (const f of FINISH_BUCKETS) expect(decompose(f, "Retail").finish).toBe(f);
  });
});

describe("the import's cap_handling for a cap mode", () => {
  it("hard mode sends the choice; soft mode always adds above", () => {
    expect(capHandlingFor("hard", "trim")).toBe("trim");
    expect(capHandlingFor("hard", "add_above")).toBe("add_above");
    expect(capHandlingFor("soft", "trim")).toBe("add_above");
    expect(capHandlingFor("soft", "add_above")).toBe("add_above");
  });
});
