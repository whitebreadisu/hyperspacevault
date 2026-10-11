import { adjustCard, EmailNotVerifiedError } from "../../api/inventory";
import { ImportApiError, runImport } from "../../api/inventoryImportExport";
import type { CapHandling, ImportReport } from "../../api/inventoryImportExport";
import type { CapMode } from "../../api/settingsLimits";
import type { PreconDeckCard } from "../../data/preconDecks";
import { buildPreconImportFile } from "../../utils/preconImport";
import type { BatchRow, BatchView } from "./batch";
import { toolAddCardsCommitted } from "./toolAnalytics";

// BL-249 S3-15 / S3-16: committing the batch through desktop's two paths
// (AddCardsModal.tsx handleCommit / handlePreconCommit), driven by the
// batch view the Verify cards sheet shows -- only the copies listed under
// "will be added" are written:
//   - keypad copies -> one `adjustCard(variantId, delta)` per printing with
//     the folded delta (BL-219 grouping, handleCommit);
//   - precon copies -> desktop's import file rebuilt from the admitted
//     copies' deck cards (merged by swuapi_uuid, quantity = admitted copies;
//     `buildPreconImportFile`) and sent as
//     `runImport(file, "merge_add", capHandling, "commit")`. capHandling is
//     desktop's `effectivePreconCap`: hard-cap users' radio ("trim" by
//     default, "add_above" when the copies were added with "Add the full
//     deck, even above my keep-limits" = `force`), "add_above" for soft /
//     no-limit users. Copies of different radio choices go in separate
//     files (one runImport each), so each keeps its own cap handling.
// Keypad first, then precon: the batch view admitted copies so that every
// non-forced printing stays within its limit whatever the order, and a
// keypad copy is only admitted next to a forced deck copy if it came first.

export interface PreconImportPlan {
  capHandling: CapHandling;
  cards: PreconDeckCard[];
  copies: number;
}

/** BL-253 S7-18: the entry methods of the keypad path, in report order. */
export const ADJUST_METHODS = ["keypad", "camera", "camera_fast_add"] as const;
export type AdjustMethod = (typeof ADJUST_METHODS)[number];

export interface CommitPlan {
  /** Keypad printings -> folded delta (one adjustCard each). */
  adjust: Map<number, number>;
  keypadCopies: number;
  /** BL-253 S7-18: the keypad-path copies by entry method (keypad, camera,
   * camera_fast_add) -- copies and distinct printings, for one
   * add_cards_committed per method. */
  byMethod: Map<AdjustMethod, { copies: number; variants: Set<number> }>;
  imports: PreconImportPlan[];
  /** Every admitted copy (the "Add N cards to vault" N). */
  total: number;
}

/** S3-15: the commit plan for a batch (pure; vitest `S3-15`). */
export function commitPlan(batch: BatchRow[], view: BatchView, capMode: CapMode): CommitPlan {
  const ok = new Set(view.added.map((v) => v.id));
  const adjust = new Map<number, number>();
  let keypadCopies = 0;
  const byMethod = new Map<AdjustMethod, { copies: number; variants: Set<number> }>();
  const decks = new Map<CapHandling, Map<string, PreconDeckCard>>();
  const deckCopies = new Map<CapHandling, number>();
  for (const r of batch) {
    if (!ok.has(r.id) || r.variantId === null) continue;
    if (r.via === "precon" && r.deck) {
      const cap: CapHandling = capMode === "hard" && !r.force ? "trim" : "add_above";
      const byUuid = decks.get(cap) ?? new Map<string, PreconDeckCard>();
      decks.set(cap, byUuid);
      const dc = r.deck.card;
      const prev = byUuid.get(dc.swuapi_uuid);
      byUuid.set(dc.swuapi_uuid, { ...dc, quantity: (prev?.quantity ?? 0) + 1 });
      deckCopies.set(cap, (deckCopies.get(cap) ?? 0) + 1);
    } else {
      adjust.set(r.variantId, (adjust.get(r.variantId) ?? 0) + 1);
      keypadCopies++;
      const method: AdjustMethod =
        r.via === "camera" || r.via === "camera_fast_add" ? r.via : "keypad";
      const m = byMethod.get(method) ?? { copies: 0, variants: new Set<number>() };
      m.copies++;
      m.variants.add(r.variantId);
      byMethod.set(method, m);
    }
  }
  const imports: PreconImportPlan[] = [];
  for (const cap of ["trim", "add_above"] as CapHandling[]) {
    const m = decks.get(cap);
    if (m && m.size)
      imports.push({ capHandling: cap, cards: [...m.values()], copies: deckCopies.get(cap) ?? 0 });
  }
  return { adjust, keypadCopies, byMethod, imports, total: ok.size };
}

/** desktop AddCardsModal copy (both email-not-verified branches). */
export const EMAIL_NOT_VERIFIED_MSG =
  "Verify your email to manage inventory -- see the banner above.";
/** desktop handlePreconCommit's fallback. */
export const PRECON_FAILED_MSG = "Something went wrong committing that import.";
/** Phone-only (desktop's keypad path logs and shows nothing; S3-15 tiebreaker). */
export const KEYPAD_FAILED_MSG = "Something went wrong adding those cards. Try again.";

export class CommitError extends Error {
  /** Printings already written before the failure (their copies are in the
   * vault now and must leave the batch). */
  readonly committedVariants: Set<number>;
  /** Precon cap groups already imported. */
  readonly committedImports: Set<CapHandling>;
  constructor(message: string, committedVariants: Set<number>, committedImports: Set<CapHandling>) {
    super(message);
    this.committedVariants = committedVariants;
    this.committedImports = committedImports;
  }
}

/** S3-15 + S3-16: run a plan. Sends `add_cards_committed` per path that
 * wrote (desktop shapes: keypad cards_added = copies, distinct_cards =
 * printings; precon cards_added = applied copies from the report,
 * distinct_cards = resolved report rows). Throws CommitError with desktop's
 * inline copy. */
export async function executeCommit(plan: CommitPlan): Promise<void> {
  const doneVariants = new Set<number>();
  const doneImports = new Set<CapHandling>();
  try {
    for (const [variantId, delta] of plan.adjust) {
      await adjustCard(variantId, delta);
      doneVariants.add(variantId);
    }
  } catch (err) {
    const msg = err instanceof EmailNotVerifiedError ? EMAIL_NOT_VERIFIED_MSG : KEYPAD_FAILED_MSG;
    throw new CommitError(msg, doneVariants, doneImports);
  }
  // S3-16 shape per method (BL-253 S7-18: camera / camera_fast_add join
  // keypad; a keypad-only batch sends exactly what it always did).
  for (const method of ADJUST_METHODS) {
    const m = plan.byMethod.get(method);
    if (m && m.copies) toolAddCardsCommitted(method, m.copies, m.variants.size);
  }

  let applied = 0;
  let resolved = 0;
  try {
    for (const imp of plan.imports) {
      const report: ImportReport = await runImport(
        buildPreconImportFile(imp.cards),
        "merge_add",
        imp.capHandling,
        "commit"
      );
      doneImports.add(imp.capHandling);
      const rows = report.rows.filter((r) => r.status === "resolved");
      resolved += rows.length;
      applied += rows.reduce(
        (s, r) => s + Math.max(0, (r.resulting_quantity ?? 0) - (r.current_quantity ?? 0)),
        0
      );
    }
  } catch (err) {
    if (doneImports.size) toolAddCardsCommitted("precon", applied, resolved);
    const msg =
      err instanceof ImportApiError
        ? err.code === "email_not_verified"
          ? EMAIL_NOT_VERIFIED_MSG
          : err.message
        : PRECON_FAILED_MSG;
    throw new CommitError(msg, doneVariants, doneImports);
  }
  if (plan.imports.length) toolAddCardsCommitted("precon", applied, resolved);
}

/** Rows to drop from the batch after a partial failure: the copies of
 * printings / cap groups already written. */
export function committedRowIds(
  batch: BatchRow[],
  view: BatchView,
  capMode: CapMode,
  err: CommitError
): Set<string> {
  const ok = new Set(view.added.map((v) => v.id));
  const out = new Set<string>();
  for (const r of batch) {
    if (!ok.has(r.id) || r.variantId === null) continue;
    if (r.via === "precon") {
      const cap: CapHandling = capMode === "hard" && !r.force ? "trim" : "add_above";
      if (err.committedImports.has(cap)) out.add(r.id);
    } else if (err.committedVariants.has(r.variantId)) out.add(r.id);
  }
  return out;
}
