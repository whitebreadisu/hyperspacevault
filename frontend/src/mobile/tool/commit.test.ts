import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../api/inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/inventory")>()),
  adjustCard: vi.fn(),
}));
vi.mock("../../api/inventoryImportExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/inventoryImportExport")>()),
  runImport: vi.fn(),
}));

import type { BaseCardCatalog } from "../../api/baseCards";
import type { CardSet } from "../../api/sets";
import { capture } from "../../analytics/analytics";
import { adjustCard, EmailNotVerifiedError } from "../../api/inventory";
import { runImport } from "../../api/inventoryImportExport";
import type { ImportReport } from "../../api/inventoryImportExport";
import cardsJson from "../../../e2e/mobile/fixtures/base-cards.json";
import qtyJson from "../../../e2e/mobile/fixtures/quantities.json";
import setsJson from "../../../e2e/mobile/fixtures/sets.json";
import { toInventoryCards } from "../../utils/inventory";
import { cardsForEntry } from "../../utils/preconImport";
import { mergeQuantities } from "../vault/useVaultData";
import { addCopy, addDeck, batchView, getBatch, resetBatchForTest } from "./batch";
import type { NewBatchRow } from "./batch";
import {
  CommitError,
  EMAIL_NOT_VERIFIED_MSG,
  commitPlan,
  committedRowIds,
  executeCommit,
} from "./commit";
import { PRECON_ENTRIES, toCatalog } from "./padModel";
import { NO_PICKS } from "./toolStore";

const sets = setsJson as CardSet[];
const qty: Record<number, number> = Object.fromEntries(
  qtyJson.map((q) => [q.variant_id, q.quantity])
);
const order = Object.fromEntries(sets.map((s) => [s.code, s.release_date]));
const cards = toInventoryCards(mergeQuantities(cardsJson as BaseCardCatalog[], qty), order);
const catalog = toCatalog(cards);
const hard = { catalog, limits: null, capMode: "hard" as const };

// SOR 87 Standard (7221) owned 1 of 3; SOR 35 (6791) owned 3 of 3.
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
const deck = PRECON_ENTRIES.find((e) => e.key === "SOR-VADER")!;

const okReport = (rows: { cur: number; res: number }[]): ImportReport =>
  ({
    stage: "commit",
    mode: "merge_add",
    cap_handling: "trim",
    committed: true,
    totals: {} as ImportReport["totals"],
    rows: rows.map((r, i) => ({
      row_number: i + 1,
      status: "resolved",
      card: {},
      current_quantity: r.cur,
      resulting_quantity: r.res,
    })),
    removed: [],
  }) as ImportReport;

async function fileJson(f: File) {
  return JSON.parse(await f.text()) as {
    format_version: string;
    cards: { swuapi_uuid: string; quantity: number }[];
  };
}

describe("S3-15 commit plan from a mixed batch", () => {
  beforeEach(() => {
    resetBatchForTest();
    vi.mocked(adjustCard).mockReset();
    vi.mocked(runImport).mockReset();
    vi.mocked(capture).mockReset();
  });

  it("keypad copies fold per printing; blocked copies are left out", () => {
    for (let i = 0; i < 3; i++) addCopy(vader); // 2 fit, the 3rd is blocked
    addCopy(guard); // at limit: blocked
    const view = batchView(getBatch(), hard);
    const plan = commitPlan(getBatch(), view, "hard");
    expect([...plan.adjust]).toEqual([[7221, 2]]);
    expect(plan.keypadCopies).toBe(2);
    expect(plan.imports).toEqual([]);
    expect(plan.total).toBe(2);
  });

  it("precon copies rebuild desktop's import file: admitted copies merged by uuid, cap per radio", () => {
    addCopy(vader);
    const n = addDeck(deck, cards, false);
    const view = batchView(getBatch(), hard);
    const plan = commitPlan(getBatch(), view, "hard");
    expect([...plan.adjust]).toEqual([[7221, 1]]);
    expect(plan.imports).toHaveLength(1);
    const imp = plan.imports[0];
    expect(imp.capHandling).toBe("trim");
    const admittedDeck = view.added.length - 1;
    expect(imp.copies).toBe(admittedDeck);
    expect(imp.cards.reduce((s, c) => s + c.quantity, 0)).toBe(admittedDeck);
    expect(new Set(imp.cards.map((c) => c.swuapi_uuid)).size).toBe(imp.cards.length);
    // Every merged card is one of the deck's own rows, never more copies than it lists.
    const src = new Map(cardsForEntry(deck).map((c) => [c.swuapi_uuid, c.quantity]));
    for (const c of imp.cards) expect(c.quantity).toBeLessThanOrEqual(src.get(c.swuapi_uuid)!);
    expect(n).toBe(52);
    expect(plan.total).toBe(view.added.length);
  });

  it("'Add the full deck' copies go with add_above; soft mode always add_above", () => {
    addDeck(deck, cards, true);
    const view = batchView(getBatch(), hard);
    const plan = commitPlan(getBatch(), view, "hard");
    expect(plan.imports.map((i) => i.capHandling)).toEqual(["add_above"]);
    // Forced: every resolved copy is admitted (the fixture catalogue holds
    // only part of the deck; the rest are unresolved and never sent).
    expect(view.notAdded).toHaveLength(0);
    expect(plan.imports[0].copies).toBe(view.added.length);
    resetBatchForTest();
    addDeck(deck, cards, false);
    const sv = batchView(getBatch(), { ...hard, capMode: "soft" });
    expect(commitPlan(getBatch(), sv, "soft").imports.map((i) => i.capHandling)).toEqual([
      "add_above",
    ]);
  });

  it("executes keypad adjusts then runImport(file, merge_add, cap, commit)", async () => {
    vi.mocked(adjustCard).mockResolvedValue({} as never);
    vi.mocked(runImport).mockResolvedValue(okReport([{ cur: 0, res: 2 }]));
    addCopy(vader);
    addCopy(vader);
    addDeck(deck, cards, false);
    const view = batchView(getBatch(), hard);
    const plan = commitPlan(getBatch(), view, "hard");
    await executeCommit(plan);
    expect(vi.mocked(adjustCard).mock.calls).toEqual([[7221, 2]]);
    expect(vi.mocked(runImport)).toHaveBeenCalledTimes(1);
    const [file, mode, cap, stage] = vi.mocked(runImport).mock.calls[0];
    expect([mode, cap, stage]).toEqual(["merge_add", "trim", "commit"]);
    const body = await fileJson(file);
    expect(body.format_version).toBe("swu-inv/1");
    expect(body.cards.reduce((s, c) => s + c.quantity, 0)).toBe(plan.imports[0].copies);
  });

  it("a failure keeps desktop's copy and names what was already written", async () => {
    vi.mocked(adjustCard)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new EmailNotVerifiedError());
    addCopy(vader);
    addCopy({ ...vader, cardNumber: "229", variantId: 6571, baseCardId: 131 });
    const view = batchView(getBatch(), hard);
    const plan = commitPlan(getBatch(), view, "hard");
    const err = await executeCommit(plan).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommitError);
    expect((err as CommitError).message).toBe(EMAIL_NOT_VERIFIED_MSG);
    const drop = committedRowIds(getBatch(), view, "hard", err as CommitError);
    expect([...drop]).toEqual([getBatch()[0].id]);
    expect(vi.mocked(capture)).not.toHaveBeenCalled();
  });
});

describe("S3-16 add_cards_committed per path (desktop shapes + layout phone)", () => {
  beforeEach(() => {
    resetBatchForTest();
    vi.mocked(adjustCard).mockReset();
    vi.mocked(runImport).mockReset();
    vi.mocked(capture).mockReset();
  });

  it("keypad: cards_added = copies, distinct_cards = printings; precon: applied copies from the report", async () => {
    vi.mocked(adjustCard).mockResolvedValue({} as never);
    vi.mocked(runImport).mockResolvedValue(
      okReport([
        { cur: 0, res: 2 },
        { cur: 3, res: 3 },
        { cur: 1, res: 2 },
      ])
    );
    addCopy(vader);
    addCopy(vader);
    addCopy({ ...vader, cardNumber: "229", variantId: 6571, baseCardId: 131 });
    addDeck(deck, cards, false);
    const view = batchView(getBatch(), hard);
    await executeCommit(commitPlan(getBatch(), view, "hard"));
    expect(vi.mocked(capture).mock.calls).toEqual([
      [
        "add_cards_committed",
        { method: "keypad", cards_added: 3, distinct_cards: 2, layout: "phone" },
      ],
      [
        "add_cards_committed",
        { method: "precon", cards_added: 3, distinct_cards: 3, layout: "phone" },
      ],
    ]);
  });

  it("nothing is sent for a path with no copies", async () => {
    vi.mocked(adjustCard).mockResolvedValue({} as never);
    addCopy(vader);
    await executeCommit(commitPlan(getBatch(), batchView(getBatch(), hard), "hard"));
    expect(vi.mocked(capture).mock.calls.map((c) => (c[1] as { method: string }).method)).toEqual([
      "keypad",
    ]);
    expect(vi.mocked(runImport)).not.toHaveBeenCalled();
  });
});
