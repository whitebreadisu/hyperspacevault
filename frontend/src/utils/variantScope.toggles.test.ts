import { describe, expect, it } from "vitest";
import { filterCards } from "../mobile/vault/vaultModel";
import { HYPERSPACE, phoneCard, SHOWCASE, STANDARD } from "../mobile/vault/phoneCardFixtures";
import { applyFilters, DEFAULT_FILTERS } from "./filters";
import type { BaseCard } from "./catalog";
import type { InventoryCard } from "./inventory";
import { matrixKey } from "./limits";
import type { LimitsMatrix } from "./limits";
import { applyCollectionToggles } from "./variantScope";
import type { CollectionToggles } from "./variantScope";

// The Collection toggles: the desktop Cards page and the phone Vault narrow
// the same list for the same toggles, scope and keep-limits. Both call
// applyCollectionToggles, so the equality check below only shows the phone
// pipeline adds nothing of its own; the pinned lists are the independent
// expectations, over a card set that puts every predicate on both sides of
// its line, scoped and unscoped, under the default limits and a tenant matrix.
// Desktop's own state -> toggles mapping is exercised end to end in
// screens/cards/CardsPage.test.tsx (each toggle unscoped and scoped).

const unit = (id: number, std: number, hs: number): InventoryCard =>
  phoneCard({
    id,
    name: `Unit ${id}`,
    number: String(id),
    variants: [
      { id: id * 10 + 1, finish: STANDARD, number: String(id), qty: std },
      { id: id * 10 + 2, finish: HYPERSPACE, number: String(id + 300), qty: hs },
    ],
  });
const leader = (id: number, std: number, sc: number): InventoryCard =>
  phoneCard({
    id,
    name: `Leader ${id}`,
    type: "Leader",
    number: String(id),
    variants: [
      { id: id * 10 + 1, finish: STANDARD, number: String(id), qty: std },
      { id: id * 10 + 2, finish: SHOWCASE, number: String(id + 200), qty: sc },
    ],
  });

const CARDS: InventoryCard[] = [
  unit(1, 0, 0),
  unit(2, 2, 0),
  unit(3, 2, 1),
  unit(4, 0, 3),
  unit(5, 4, 0),
  unit(6, 1, 2),
  leader(7, 0, 0),
  leader(8, 1, 0),
  leader(9, 0, 1),
  leader(10, 2, 1),
];

/** Hyperspace units capped at 1 and Standard leaders at "No limit". */
const MATRIX: LimitsMatrix = {
  [matrixKey("standard", HYPERSPACE)]: {
    type_category: "standard",
    limit_bucket: HYPERSPACE,
    max_quantity: 1,
    is_default: false,
  },
  [matrixKey("singleton", STANDARD)]: {
    type_category: "singleton",
    limit_bucket: STANDARD,
    max_quantity: null,
    is_default: false,
  },
};

const SCOPES: (string | null)[] = [null, STANDARD, HYPERSPACE, SHOWCASE, "Standard Foil"];
const KEYS = ["incomplete", "owned", "unowned", "overcap"] as const;
const COMBOS: CollectionToggles[] = Array.from({ length: 16 }, (_, n) => ({
  incomplete: !!(n & 1),
  owned: !!(n & 2),
  unowned: !!(n & 4),
  overcap: !!(n & 8),
}));

const ids = (cards: InventoryCard[]) => cards.map((c) => c.base_card_id);
const desktop = (t: CollectionToggles, scope: string | null, limits: LimitsMatrix | null) =>
  ids(
    applyFilters(applyCollectionToggles(CARDS, t, scope, limits) as BaseCard[], {
      ...DEFAULT_FILTERS,
      search: "",
    }) as InventoryCard[]
  );
const phone = (t: CollectionToggles, scope: string | null, limits: LimitsMatrix | null) =>
  ids(filterCards(CARDS, { filters: DEFAULT_FILTERS, query: "", scope, toggles: t }, limits));

describe("Collection toggles: the phone pipeline narrows as the shared toggles do", () => {
  for (const limits of [null, MATRIX])
    for (const scope of SCOPES)
      it(`scope ${scope ?? "all"}, ${limits ? "tenant matrix" : "default limits"}`, () => {
        for (const t of COMBOS) {
          const on = KEYS.filter((k) => t[k]).join("+") || "none";
          expect(phone(t, scope, limits), on).toEqual(desktop(t, scope, limits));
        }
      });
});

describe("Collection toggles: pinned single-toggle lists", () => {
  const only = (k: (typeof KEYS)[number]): CollectionToggles => ({
    incomplete: false,
    owned: false,
    unowned: false,
    overcap: false,
    [k]: true,
  });
  // Pinned on the unmodified source (2026-10-31): [incomplete, owned, unowned, overcap].
  const PINNED: Record<string, number[][]> = {
    "all | default": [
      [1, 2, 7],
      [2, 3, 4, 5, 6, 8, 9, 10],
      [1, 7],
      [5, 10],
    ],
    "Standard | default": [
      [1, 2, 3, 4, 6, 7, 9],
      [2, 3, 5, 6, 8, 10],
      [1, 4, 7, 9],
      [5, 10],
    ],
    "Hyperspace | default": [[1, 2, 3, 5, 6, 7, 8, 9, 10], [3, 4, 6], [1, 2, 5, 7, 8, 9, 10], []],
    "Showcase | default": [[1, 2, 3, 4, 5, 6, 7, 8], [9, 10], [1, 2, 3, 4, 5, 6, 7, 8], []],
    "Standard Foil | default": [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [],
    ],
    "all | matrix": [
      [1, 2, 7],
      [2, 3, 4, 5, 6, 8, 9, 10],
      [1, 7],
      [4, 5, 6],
    ],
    "Standard | matrix": [[1, 2, 3, 4, 6, 7, 9], [2, 3, 5, 6, 8, 10], [1, 4, 7, 9], [5]],
    "Hyperspace | matrix": [
      [1, 2, 3, 5, 6, 7, 8, 9, 10],
      [3, 4, 6],
      [1, 2, 5, 7, 8, 9, 10],
      [4, 6],
    ],
  };
  for (const [label, expected] of Object.entries(PINNED)) {
    it(label, () => {
      const [scopeName, lim] = label.split(" | ");
      const scope = scopeName === "all" ? null : scopeName;
      const limits = lim === "matrix" ? MATRIX : null;
      expect(KEYS.map((k) => ids(applyCollectionToggles(CARDS, only(k), scope, limits)))).toEqual(
        expected
      );
      expect(KEYS.map((k) => phone(only(k), scope, limits))).toEqual(expected);
    });
  }
});

describe("Collection toggles: pinned multi-toggle lists", () => {
  // Pinned outputs: every combination of two or more toggles, generated from
  // the Cards page's inline predicate as it stood before the shared one
  // (2026-10-31), on this file's cards. Key: "scope | limits | toggles".
  const PINNED_MULTI: Record<string, number[]> = {
    "all | default | incomplete+owned": [2],
    "all | default | incomplete+unowned": [1, 7],
    "all | default | owned+unowned": [],
    "all | default | incomplete+owned+unowned": [],
    "all | default | incomplete+overcap": [],
    "all | default | owned+overcap": [5, 10],
    "all | default | incomplete+owned+overcap": [],
    "all | default | unowned+overcap": [],
    "all | default | incomplete+unowned+overcap": [],
    "all | default | owned+unowned+overcap": [],
    "all | default | incomplete+owned+unowned+overcap": [],
    "Standard | default | incomplete+owned": [2, 3, 6],
    "Standard | default | incomplete+unowned": [1, 4, 7, 9],
    "Standard | default | owned+unowned": [],
    "Standard | default | incomplete+owned+unowned": [],
    "Standard | default | incomplete+overcap": [],
    "Standard | default | owned+overcap": [5, 10],
    "Standard | default | incomplete+owned+overcap": [],
    "Standard | default | unowned+overcap": [],
    "Standard | default | incomplete+unowned+overcap": [],
    "Standard | default | owned+unowned+overcap": [],
    "Standard | default | incomplete+owned+unowned+overcap": [],
    "Hyperspace | default | incomplete+owned": [3, 6],
    "Hyperspace | default | incomplete+unowned": [1, 2, 5, 7, 8, 9, 10],
    "Hyperspace | default | owned+unowned": [],
    "Hyperspace | default | incomplete+owned+unowned": [],
    "Hyperspace | default | incomplete+overcap": [],
    "Hyperspace | default | owned+overcap": [],
    "Hyperspace | default | incomplete+owned+overcap": [],
    "Hyperspace | default | unowned+overcap": [],
    "Hyperspace | default | incomplete+unowned+overcap": [],
    "Hyperspace | default | owned+unowned+overcap": [],
    "Hyperspace | default | incomplete+owned+unowned+overcap": [],
    "Showcase | default | incomplete+owned": [],
    "Showcase | default | incomplete+unowned": [1, 2, 3, 4, 5, 6, 7, 8],
    "Showcase | default | owned+unowned": [],
    "Showcase | default | incomplete+owned+unowned": [],
    "Showcase | default | incomplete+overcap": [],
    "Showcase | default | owned+overcap": [],
    "Showcase | default | incomplete+owned+overcap": [],
    "Showcase | default | unowned+overcap": [],
    "Showcase | default | incomplete+unowned+overcap": [],
    "Showcase | default | owned+unowned+overcap": [],
    "Showcase | default | incomplete+owned+unowned+overcap": [],
    "Standard Foil | default | incomplete+owned": [],
    "Standard Foil | default | incomplete+unowned": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "Standard Foil | default | owned+unowned": [],
    "Standard Foil | default | incomplete+owned+unowned": [],
    "Standard Foil | default | incomplete+overcap": [],
    "Standard Foil | default | owned+overcap": [],
    "Standard Foil | default | incomplete+owned+overcap": [],
    "Standard Foil | default | unowned+overcap": [],
    "Standard Foil | default | incomplete+unowned+overcap": [],
    "Standard Foil | default | owned+unowned+overcap": [],
    "Standard Foil | default | incomplete+owned+unowned+overcap": [],
    "all | matrix | incomplete+owned": [2],
    "all | matrix | incomplete+unowned": [1, 7],
    "all | matrix | owned+unowned": [],
    "all | matrix | incomplete+owned+unowned": [],
    "all | matrix | incomplete+overcap": [],
    "all | matrix | owned+overcap": [4, 5, 6],
    "all | matrix | incomplete+owned+overcap": [],
    "all | matrix | unowned+overcap": [],
    "all | matrix | incomplete+unowned+overcap": [],
    "all | matrix | owned+unowned+overcap": [],
    "all | matrix | incomplete+owned+unowned+overcap": [],
    "Standard | matrix | incomplete+owned": [2, 3, 6],
    "Standard | matrix | incomplete+unowned": [1, 4, 7, 9],
    "Standard | matrix | owned+unowned": [],
    "Standard | matrix | incomplete+owned+unowned": [],
    "Standard | matrix | incomplete+overcap": [],
    "Standard | matrix | owned+overcap": [5],
    "Standard | matrix | incomplete+owned+overcap": [],
    "Standard | matrix | unowned+overcap": [],
    "Standard | matrix | incomplete+unowned+overcap": [],
    "Standard | matrix | owned+unowned+overcap": [],
    "Standard | matrix | incomplete+owned+unowned+overcap": [],
    "Hyperspace | matrix | incomplete+owned": [3, 6],
    "Hyperspace | matrix | incomplete+unowned": [1, 2, 5, 7, 8, 9, 10],
    "Hyperspace | matrix | owned+unowned": [],
    "Hyperspace | matrix | incomplete+owned+unowned": [],
    "Hyperspace | matrix | incomplete+overcap": [6],
    "Hyperspace | matrix | owned+overcap": [4, 6],
    "Hyperspace | matrix | incomplete+owned+overcap": [6],
    "Hyperspace | matrix | unowned+overcap": [],
    "Hyperspace | matrix | incomplete+unowned+overcap": [],
    "Hyperspace | matrix | owned+unowned+overcap": [],
    "Hyperspace | matrix | incomplete+owned+unowned+overcap": [],
    "Showcase | matrix | incomplete+owned": [],
    "Showcase | matrix | incomplete+unowned": [1, 2, 3, 4, 5, 6, 7, 8],
    "Showcase | matrix | owned+unowned": [],
    "Showcase | matrix | incomplete+owned+unowned": [],
    "Showcase | matrix | incomplete+overcap": [],
    "Showcase | matrix | owned+overcap": [],
    "Showcase | matrix | incomplete+owned+overcap": [],
    "Showcase | matrix | unowned+overcap": [],
    "Showcase | matrix | incomplete+unowned+overcap": [],
    "Showcase | matrix | owned+unowned+overcap": [],
    "Showcase | matrix | incomplete+owned+unowned+overcap": [],
    "Standard Foil | matrix | incomplete+owned": [],
    "Standard Foil | matrix | incomplete+unowned": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "Standard Foil | matrix | owned+unowned": [],
    "Standard Foil | matrix | incomplete+owned+unowned": [],
    "Standard Foil | matrix | incomplete+overcap": [],
    "Standard Foil | matrix | owned+overcap": [],
    "Standard Foil | matrix | incomplete+owned+overcap": [],
    "Standard Foil | matrix | unowned+overcap": [],
    "Standard Foil | matrix | incomplete+unowned+overcap": [],
    "Standard Foil | matrix | owned+unowned+overcap": [],
    "Standard Foil | matrix | incomplete+owned+unowned+overcap": [],
  };
  for (const [key, expected] of Object.entries(PINNED_MULTI))
    it(`pinned output: ${key}`, () => {
      const [scopeName, lim, on] = key.split(" | ");
      const scope = scopeName === "all" ? null : scopeName;
      const limits = lim === "matrix" ? MATRIX : null;
      const keys = on.split("+");
      const t = Object.fromEntries(
        KEYS.map((k) => [k, keys.includes(k)])
      ) as unknown as CollectionToggles;
      expect(ids(applyCollectionToggles(CARDS, t, scope, limits))).toEqual(expected);
      expect(phone(t, scope, limits)).toEqual(expected);
    });

  it("pins every pair, triple and the all-on case for each scope and limits", () => {
    expect(Object.keys(PINNED_MULTI)).toHaveLength(110);
  });
});
