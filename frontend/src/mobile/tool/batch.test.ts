import { beforeEach, describe, expect, it } from "vitest";
import type { BaseCardCatalog } from "../../api/baseCards";
import type { CardSet } from "../../api/sets";
import cardsJson from "../../../e2e/mobile/fixtures/base-cards.json";
import qtyJson from "../../../e2e/mobile/fixtures/quantities.json";
import setsJson from "../../../e2e/mobile/fixtures/sets.json";
import { splitForVerification } from "../../utils/addCardsResolver";
import { toInventoryCards } from "../../utils/inventory";
import { cardsForEntry } from "../../utils/preconImport";
import { mergeQuantities } from "../vault/useVaultData";
import {
  addCopy,
  addDeck,
  batchView,
  discardBatch,
  foldAdded,
  getBatch,
  removeCopy,
  resetBatchForTest,
} from "./batch";
import type { NewBatchRow } from "./batch";
import { PRECON_ENTRIES, entryRow, padReadout, toCatalog } from "./padModel";
import { NO_PICKS } from "./toolStore";

const sets = setsJson as CardSet[];
const qty: Record<number, number> = Object.fromEntries(
  qtyJson.map((q) => [q.variant_id, q.quantity])
);
const order = Object.fromEntries(sets.map((s) => [s.code, s.release_date]));
const cards = toInventoryCards(mergeQuantities(cardsJson as BaseCardCatalog[], qty), order);
const catalog = toCatalog(cards);
const hard = { catalog, limits: null, capMode: "hard" as const };
const soft = { catalog, limits: null, capMode: "soft" as const };

// SOR 87 Standard (variant 7221) is owned 1 with the default limit 3: two
// more copies fit, the third and later do not. SOR 35 (6791) is owned 3: at
// its limit already.
const vader: NewBatchRow = {
  via: "keypad",
  force: false,
  setCode: "SOR",
  cardNumber: "87",
  picks: NO_PICKS,
  variantId: 7221,
  baseCardId: 814,
};
const guard: NewBatchRow = { ...vader, cardNumber: "35", variantId: 6791, baseCardId: 0 };

describe("S3-08 batch model (one row per copy, cap admission, remove one, discard)", () => {
  beforeEach(() => resetBatchForTest());

  it("one row per copy: the same number three times is three rows", () => {
    for (let i = 0; i < 3; i++) addCopy(vader);
    expect(getBatch()).toHaveLength(3);
    expect(new Set(getBatch().map((r) => r.id)).size).toBe(3);
    const v = batchView(getBatch(), hard);
    expect(v.added).toHaveLength(2);
    expect(v.notAdded).toHaveLength(1);
    expect(v.unresolved).toHaveLength(0);
  });

  it("hard cap admission: copies past the effective limit are not added, with desktop's reason", () => {
    for (let i = 0; i < 4; i++) addCopy(vader);
    addCopy(guard);
    const v = batchView(getBatch(), hard);
    expect(v.added.map((r) => r.inventoryText)).toEqual(["1 → 2", "1 → 3"]);
    expect(v.added.every((r) => r.dotColor === "green")).toBe(true);
    // 2 over-cap Vaders + the guard already at its limit.
    expect(v.notAdded).toHaveLength(3);
    expect(v.notAdded.every((r) => r.skipReason === "Inventory limit already reached.")).toBe(true);
    expect(v.notAdded[0].inventoryText).toBe("1 → 1");
    expect(v.added[0]).toMatchObject({ cardNumber: "87", name: "Darth Vader", groupKey: "SOR" });
  });

  it("matches desktop splitForVerification for a keypad batch (hard and soft)", () => {
    for (let i = 0; i < 5; i++) addCopy(vader);
    addCopy(guard);
    for (const [ctx, mode] of [
      [hard, "hard"],
      [soft, "soft"],
    ] as const) {
      const v = batchView(getBatch(), ctx);
      const d = splitForVerification(getBatch().map(entryRow), catalog, null, mode);
      expect(v.added.map((r) => r.id)).toEqual(d.willAdd.map((x) => x.row.id));
      expect(v.notAdded.map((r) => r.id)).toEqual(d.willSkip.map((x) => x.row.id));
    }
    // Soft mode keeps over-limit copies in "added", flagged amber.
    const s = batchView(getBatch(), soft);
    expect(s.notAdded).toHaveLength(0);
    expect(s.added.filter((r) => r.dotColor === "amber")).toHaveLength(4);
    expect(s.added.find((r) => r.dotColor === "amber")?.overLimitNote).toBe(
      "Over your keep-limit — will still be added"
    );
  });

  it("quick-remove drops one copy and re-admits a copy that was over the cap", () => {
    const rows = [0, 1, 2].map(() => addCopy(vader));
    expect(batchView(getBatch(), hard).notAdded).toHaveLength(1);
    removeCopy(rows[0].id);
    expect(getBatch().map((r) => r.id)).toEqual([rows[1].id, rows[2].id]);
    const v = batchView(getBatch(), hard);
    expect(v.added).toHaveLength(2);
    expect(v.notAdded).toHaveLength(0);
    removeCopy("nope");
    expect(getBatch()).toHaveLength(2);
  });

  it("discard clears the batch; the batch persists as a module store", () => {
    addCopy(vader);
    addCopy(vader);
    expect(getBatch()).toHaveLength(2);
    discardBatch();
    expect(getBatch()).toEqual([]);
  });

  it("foldAdded: admitted copies per printing for the commit (not-added excluded)", () => {
    for (let i = 0; i < 4; i++) addCopy(vader);
    addCopy(guard);
    const fold = foldAdded(getBatch(), batchView(getBatch(), hard));
    expect([...fold.entries()]).toEqual([[7221, 2]]);
  });

  it("the readout's After add counts every batch copy of the printing (keypad or precon)", () => {
    addCopy(vader);
    addCopy({ ...vader, via: "precon" });
    const r = padReadout("SOR", "87", NO_PICKS, getBatch(), catalog, null, "hard")!;
    // owned 1 + 2 in the batch + this one.
    expect(r).toMatchObject({ owned: 1, after: 4, limit: 3, afterOver: true });
  });
});

describe("S3-09 precon deck rows", () => {
  beforeEach(() => resetBatchForTest());
  const vaderDeck = PRECON_ENTRIES.find((e) => e.key === "SOR-VADER")!;

  it("addDeck writes every deck copy as one row, force per the radio", () => {
    const total = cardsForEntry(vaderDeck).reduce((s, c) => s + c.quantity, 0);
    expect(addDeck(vaderDeck, cards, false)).toBe(total);
    expect(getBatch()).toHaveLength(total);
    expect(
      getBatch().every((r) => r.via === "precon" && !r.force && r.deck?.key === "SOR-VADER")
    ).toBe(true);
    discardBatch();
    addDeck(vaderDeck, cards, true);
    expect(getBatch().every((r) => r.force)).toBe(true);
  });

  it("copies the catalogue does not hold are reported unresolved, never dropped", () => {
    addDeck(vaderDeck, cards, false);
    const v = batchView(getBatch(), hard);
    expect(v.added.length + v.notAdded.length + v.unresolved.length).toBe(getBatch().length);
    expect(v.unresolved.length).toBeGreaterThan(0);
    expect(v.unresolved[0].skipReason).toBe("No matching card for that set/number/variant.");
    // Resolved deck copies read as desktop's precon rows.
    const first = [...v.added, ...v.notAdded][0];
    expect(first.setText).toBe("Base Set");
  });

  it("force admits past the hard cap; a plain deck add does not", () => {
    // SOR 35 (owned 3 = at the limit) is a Vader-deck card in the fixture? Use
    // a synthetic two-row batch for the rule itself.
    addCopy({ ...guard, via: "precon", force: false });
    addCopy({ ...guard, via: "precon", force: true });
    const v = batchView(getBatch(), hard);
    expect(v.notAdded).toHaveLength(1);
    expect(v.added).toHaveLength(1);
    expect(v.added[0].dotColor).toBe("amber");
  });
});
