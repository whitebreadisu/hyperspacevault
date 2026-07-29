import type { ImportReport, ImportRowReport } from "../api/inventoryImportExport";
import type { PreconDeck, PreconDeckCard, PreconEntry } from "../data/preconDecks";
import type { VerificationRow } from "./addCardsResolver";

/** §4-REV's IBH "always the whole box": the two decks' rows merged into ONE
 * import payload, pre-merging any shared variant (summing quantities)
 * rather than relying solely on the import engine's own duplicate-fold --
 * "the client may pre-merge for a cleaner report but must not double-import"
 * (§4, still true post-revision). Kept unchanged from the S2 boxed-choice
 * code this replaces -- it's exactly what an always-both entry needs, only
 * now with a single caller (cardsForEntry's "ibhBox" branch) instead of
 * three. Order is deck A's rows first, then any of deck B's rows not
 * already covered. */
export function mergeDeckCards(decks: PreconDeck[]): PreconDeckCard[] {
  const byUuid = new Map<string, PreconDeckCard>();
  for (const deck of decks) {
    for (const card of deck.cards) {
      const existing = byUuid.get(card.swuapi_uuid);
      if (existing) {
        byUuid.set(card.swuapi_uuid, { ...existing, quantity: existing.quantity + card.quantity });
      } else {
        byUuid.set(card.swuapi_uuid, { ...card });
      }
    }
  }
  return [...byUuid.values()];
}

/** Resolves a chosen dropdown entry down to the flat row list an import file
 * is built from: a plain deck's own rows, or (IBH) the merged union of both
 * Hoth decks -- always both, never a per-deck choice (§4-REV). */
export function cardsForEntry(entry: PreconEntry): PreconDeckCard[] {
  return entry.kind === "deck" ? entry.deck.cards : mergeDeckCards([entry.deckA, entry.deckB]);
}

/** Builds the `swu-inv/1` canonical-format File the BL-54 import engine
 * expects (Definition_ImportExport_2026-07-22.md §7 / runImport's own doc
 * comment) directly from resolved precon rows -- no server round trip, no
 * per-card increment loop (§2's rejected-alternatives note). Every row here
 * is already uuid-resolved at prep time, so the file carries the full
 * identity quadruple plus name for display/fallback. */
export function buildPreconImportFile(cards: PreconDeckCard[]): File {
  const payload = {
    format_version: "swu-inv/1",
    cards: cards.map((c) => ({
      swuapi_uuid: c.swuapi_uuid,
      set_code: c.set_code,
      card_number: c.card_number,
      variant_type: c.variant_type,
      quantity: c.quantity,
      name: c.name,
    })),
  };
  return new File([JSON.stringify(payload)], "precon-deck-import.json", {
    type: "application/json",
  });
}

// ── §4-REV: one shared Verify Cards component ───────────────────────────
// Same reason-copy map ImportPreviewReport.tsx keeps for the Import/Export
// screen's own problem-rows rendering -- duplicated rather than imported
// from that screen module, matching this codebase's existing convention of
// small per-file reason-text maps (ImportPreviewReport's own doc comment
// notes it isn't shared either).
const REASON_TEXT: Record<string, string> = {
  unknown_uuid_and_triple: "Not found by ID or by set/number/variant.",
  unknown_triple: "No matching card for that set/number/variant.",
  ambiguous_triple: "Matches more than one printing — pick a candidate below.",
  incomplete_identity:
    "Missing enough identity to resolve (needs a uuid, or set + number + variant).",
  malformed_row: "Quantity is missing, negative, or not a whole number.",
};

function unresolvedRow(r: ImportRowReport): VerificationRow {
  return {
    id: String(r.row_number),
    groupKey: r.card.set_code ?? "Unknown",
    cardNumber: r.card.card_number ?? "—",
    name: r.card.name ?? "Unrecognized row",
    subtitle: r.card.subtitle ?? null,
    setText: "",
    isOP: false,
    finishText: r.card.variant_type ?? "",
    inventoryText: "",
    dotColor: "red",
    skipReason: r.reason ? (REASON_TEXT[r.reason] ?? r.reason) : r.status,
  };
}

/** BL-151 S2b (§4-REV): the precon dry-run's ImportReport, mapped into the
 * SAME VerificationRow shape AddCardsVerification's manual-flow adapter
 * (addCardsResolver.ts's toVerificationRow) produces -- one shared
 * component renders both flows' confirmation screens, per the owner's
 * dev-review call to stop shipping a visually-different sibling.
 *
 * Mapping decisions (recorded per the brief):
 *  - unresolved/ambiguous rows -- should never occur; precon data is
 *    uuid-resolved at prep time (§3) -- go in their own `unresolved` bucket,
 *    rendered by AddCardsVerification as a prominent data-integrity section
 *    ahead of the two standard ones, entirely absent for the manual flow.
 *  - a trimmed row (`trim_reason` set) renders through the SAME "will not be
 *    added" section/idiom the manual flow uses for an at-limit skip (§4-REV's
 *    explicit instruction), NOT a third bespoke "Trimmed" section -- the
 *    row's own reason text still names exactly how many copies did/didn't
 *    land, so a partially-added row (`resulting_quantity > current_quantity`)
 *    reads differently from a fully-blocked one even though both share the
 *    section and its Reason column. The inventory dot reflects that same
 *    partial/full distinction (amber/red) using the two colors the manual
 *    flow's own soft-cap idiom already established.
 *  - a resolved row with no trim goes straight to "will be added", dot
 *    green, no note -- the ordinary case for the large majority of rows.
 *  - "Set" and "Finish" columns: precon rows are always the Standard variant
 *    of their printed set (§3), so `setText` is the constant "Base Set" and
 *    `isOP` is always false (no OP/tournament prints in precon product
 *    decks) -- `finishText` comes straight from the row's own variant_type. */
export function verificationRowsFromReport(report: ImportReport): {
  willAdd: VerificationRow[];
  willSkip: VerificationRow[];
  unresolved: VerificationRow[];
} {
  const willAdd: VerificationRow[] = [];
  const willSkip: VerificationRow[] = [];
  const unresolved: VerificationRow[] = [];

  for (const r of report.rows) {
    if (r.status !== "resolved") {
      unresolved.push(unresolvedRow(r));
      continue;
    }

    const current = r.current_quantity ?? 0;
    const resulting = r.resulting_quantity ?? current;
    const base = {
      id: String(r.row_number),
      groupKey: r.card.set_code ?? "Unknown",
      cardNumber: r.card.card_number ?? "",
      name: r.card.name ?? "",
      // Owner dev review 2026-07-26 (round 7): the report's card already
      // carries the subtitle -- surface it, same as the manual flow's rows.
      subtitle: r.card.subtitle ?? null,
      setText: "Base Set",
      isOP: false,
      finishText: r.card.variant_type ?? "",
      inventoryText: `${current} → ${resulting}`,
    };

    if (r.trim_reason) {
      const copies = r.copies_not_added ?? 0;
      const partial = resulting > current;
      const reasonKind = r.trim_reason === "ceiling" ? "999 ceiling" : "keep-limit";
      willSkip.push({
        ...base,
        dotColor: partial ? "amber" : "red",
        skipReason: `${copies} ${copies === 1 ? "copy" : "copies"} not added (${reasonKind})${
          partial ? ` — ${resulting - current} still added` : ""
        }`,
      });
    } else {
      willAdd.push({ ...base, dotColor: "green" });
    }
  }

  return { willAdd, willSkip, unresolved };
}
