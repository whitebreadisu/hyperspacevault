import { useState, useCallback, useEffect, useMemo } from "react";
import { getSets } from "../../api/sets";
import { adjustCard, EmailNotVerifiedError } from "../../api/inventory";
import { runImport, ImportApiError } from "../../api/inventoryImportExport";
import { SWUButton } from "../../components/SWUButton";
import { SectionSeparator } from "../../components/SectionSeparator";
import { AddCardsSetBar } from "./AddCardsSetBar";
import { AddCardsPreconBar } from "./AddCardsPreconBar";
import { AddCardsKeypad } from "./AddCardsKeypad";
import { AddCardsVerification } from "./AddCardsVerification";
import { resolveRow, splitForVerification, toVerificationRow } from "../../utils/addCardsResolver";
import { preconEntries } from "../../data/preconDecks";
import {
  cardsForEntry,
  buildPreconImportFile,
  verificationRowsFromReport,
} from "../../utils/preconImport";
import { useLimits } from "../../context/LimitsContext";
import { capHandlingFor } from "../../utils/limits";
import type { Row, AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import type { PreconEntry } from "../../data/preconDecks";
import type { CapHandling, ImportReport } from "../../api/inventoryImportExport";
import type { CardSet } from "../../api/sets";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { useBusyOverlay } from "../../hooks/useBusyOverlay";
import { BusyOverlay } from "../../components/BusyOverlay";
import { capture } from "../../analytics/analytics";
import "./AddCardsModal.css";

type Phase = "editing" | "verification";

/** Static entry list, computed once at module scope -- preconEntries() reads
 * the checked-in preconDecks.json, which doesn't change at runtime. */
const PRECON_ENTRIES = preconEntries();

interface PreconState {
  selection: PreconEntry | null;
  /** Hard-mode users' trim/add-above choice. Meaningless (never sent) for
   * soft/no-limit users, who always send "add_above" -- see effectivePreconCap
   * below. Defaults to "trim" ("Don't add copies above my keep-limits" is the
   * default option, App Spec §18). */
  capHandling: CapHandling;
  step: "select" | "preview";
  report: ImportReport | null;
  /** The exact File the dry-run report was built from -- reused for the
   * commit call so the two stages see byte-identical input, the same
   * two-call/one-file contract ImportExportPage's configure->preview->commit
   * flow already relies on. */
  file: File | null;
}

function emptyPrecon(): PreconState {
  return { selection: null, capHandling: "trim", step: "select", report: null, file: null };
}

interface ModalState {
  // The set new entries attach to (drives the set bar + keypad entry form).
  // Distinct from any given row's own `setCode` — switching this never
  // touches rows already committed under a different set, so a batch can
  // span multiple sets until commit (App Spec §5.4, cross-set batch).
  activeSetCode: string | null;
  rows: Row[];
  phase: Phase;
  precon: PreconState;
}

let _rowCounter = 0;
function emptyRow(): Row {
  _rowCounter += 1;
  return {
    id: `r${Date.now()}_${_rowCounter}`,
    setCode: "",
    cardNumber: "",
    cardKey: null,
    setKey: null,
    stamp: null,
    finish: null,
  };
}

interface Props {
  catalog: AddCardsCatalogEntry[];
  onClose: () => void;
  /** May return a promise: CardsPage passes an async function (awaiting its
   * own refreshQuantities) so the commit-stage busy overlay's "Refreshing
   * your Vault…" stage holds through it. A void-returning callback also
   * works -- `await onCommitted()` on it just resolves immediately. The two
   * email-not-verified refresh calls below do not await it. */
  onCommitted: () => void | Promise<void>;
}

export function AddCardsModal({ catalog, onClose, onCommitted }: Props) {
  // The tenant's effective keep-limit matrix (null -> code defaults) and
  // cap_mode (hard/soft), threaded into the pure resolver helpers below and
  // into the keypad.
  const { limits, capMode } = useLimits();
  const [sets, setSets] = useState<CardSet[]>([]);
  const [state, setState] = useState<ModalState>({
    activeSetCode: null,
    rows: [emptyRow()],
    phase: "editing",
    precon: emptyPrecon(),
  });
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  // The precon flow's own commit/preview lifecycle -- kept separate from the
  // manual flow's committing/commitError above rather than shared, since the
  // two flows drive genuinely different network calls (adjustCard loop vs.
  // runImport) and can each be mid-flight independently of which surface is
  // currently displayed.
  const [previewingPrecon, setPreviewingPrecon] = useState(false);
  const [preconCommitting, setPreconCommitting] = useState(false);
  const [preconError, setPreconError] = useState<string | null>(null);
  // Close guard -- Cancel/X/Escape/backdrop with a non-empty batch raises a
  // confirm instead of closing outright. `hasBatch` only counts *committed*
  // rows (the keypad's in-progress draft doesn't count -- the confirm's copy
  // talks about "cards you have entered", i.e. the committed batch). A close
  // that follows a successful commit (handleCommit's own onClose() call
  // below) never routes through requestClose, so it skips the confirm
  // unconditionally -- nothing to guard once the batch has been added.
  // A selected precon deck also counts as a batch in progress: hasBatch
  // covers both routes' in-progress state regardless of which one is
  // currently locked/displayed.
  const [confirming, setConfirming] = useState(false);
  const hasBatch = state.rows.some((r) => r.cardNumber) || state.precon.selection !== null;
  // add_cards_abandoned's pending_entries (App Spec §22) -- committed keypad
  // rows plus 1 for a selected-but-uncommitted precon deck. Only ever read
  // from the Discard & Close confirm button below, which is only reachable
  // when hasBatch is true (requestClose), so the event never carries 0 and
  // needs no separate guard.
  const pendingEntries =
    state.rows.filter((r) => r.cardNumber).length + (state.precon.selection !== null ? 1 : 0);
  const requestClose = useCallback(() => {
    if (hasBatch) setConfirming(true);
    else onClose();
  }, [hasBatch, onClose]);

  // The commit-stage busy overlay (App Spec §5.16) -- shared between the
  // manual (handleCommit) and precon (handlePreconCommit) commit paths below,
  // same "overlay state local to the surface" shape ImportExportPage's own
  // instance uses.
  const overlay = useBusyOverlay();

  useEffect(() => {
    getSets().then(setSets).catch(console.error);
  }, []);

  // Escape dismisses the close-guard confirm first (if it's up) before it
  // can raise/trigger requestClose again -- same "nested state collapses
  // first" shape as CardPopup's history panel. Backdrop-click dismiss reuses
  // the same target-equality pattern CardPopup uses -- see useModalDismiss's
  // docstring.
  // A no-op while the busy overlay is up -- it renders with no dismiss
  // affordance of its own (BusyOverlay.tsx's doc comment), but the Escape
  // LISTENER underneath it (this hook) stays attached the whole time
  // regardless, so it has to explicitly ignore Escape itself rather than
  // relying on the overlay to swallow the keypress first.
  const onEscape = useCallback(() => {
    if (overlay.stage) return;
    if (confirming) setConfirming(false);
    else requestClose();
  }, [overlay.stage, confirming, requestClose]);
  const { handleBackdropMouseDown } = useModalDismiss(onEscape, { onBackdropClick: requestClose });

  // Neither of these touches `rows` — the batch is non-destructive across
  // set changes, and can end up spanning multiple sets.
  const setSet = useCallback((code: string) => {
    setState((s) => ({ ...s, activeSetCode: code, phase: "editing" }));
  }, []);

  // "Change set" unlocks the SET BAR's own picker sub-state, but does NOT by
  // itself clear the manual route lock (App Spec §18) -- if rows are still
  // in the batch, `manualLocked` below stays true (the precon bar stays
  // hidden; you're still mid-batch). Route locking is derived entirely
  // from state (manualLocked/preconLocked), not tracked as its own field, so
  // there's nothing else for this handler to touch.
  const changeSet = useCallback(() => {
    setState((s) => ({ ...s, activeSetCode: null, phase: "editing" }));
  }, []);

  const appendRow = useCallback((rowData: Omit<Row, "id">) => {
    setState((s) => {
      const next: Row = { ...emptyRow(), ...rowData };
      const trimmed = [...s.rows];
      while (trimmed.length && !trimmed[trimmed.length - 1].cardNumber) trimmed.pop();
      return { ...s, rows: [...trimmed, next] };
    });
  }, []);

  const deleteRow = useCallback((id: string) => {
    setState((s) => {
      const remaining = s.rows.filter((r) => r.id !== id);
      return { ...s, rows: remaining.length ? remaining : [emptyRow()] };
    });
  }, []);

  const submit = useCallback(() => {
    setState((s) => ({ ...s, phase: "verification" }));
  }, []);

  const backToEditing = useCallback(() => {
    setState((s) => ({ ...s, phase: "editing" }));
  }, []);

  const selectPrecon = useCallback((key: string) => {
    const entry = PRECON_ENTRIES.find((e) => e.key === key) ?? null;
    setState((s) => ({
      ...s,
      precon: { ...s.precon, selection: entry, step: "select" },
    }));
  }, []);

  // Unlike the manual route, precon has no "residual" concept -- clearing the
  // selection IS the precon route's full-clear condition (there's nothing
  // else that could keep it locked), so "Change Deck" immediately returns to
  // the side-by-side chooser (both bars reappear) the moment this runs.
  const changePreconDeck = useCallback(() => {
    setState((s) => ({ ...s, precon: { ...s.precon, selection: null, step: "select" } }));
  }, []);

  const setPreconCapHandling = useCallback((capHandling: CapHandling) => {
    setState((s) => ({ ...s, precon: { ...s.precon, capHandling } }));
  }, []);

  const backToPreconSelect = useCallback(() => {
    setState((s) => ({ ...s, precon: { ...s.precon, step: "select" } }));
  }, []);

  // Hard-mode users' explicit trim/add-above choice; soft/no-limit users
  // always send "add_above" with no choice shown -- their over-limit
  // indicators communicate state after the refresh (App Spec §18).
  const effectivePreconCap = capHandlingFor(capMode, state.precon.capHandling);

  async function handlePreconPreview() {
    if (!state.precon.selection || previewingPrecon) return;
    setPreviewingPrecon(true);
    setPreconError(null);
    try {
      const cards = cardsForEntry(state.precon.selection);
      const file = buildPreconImportFile(cards);
      const report = await runImport(file, "merge_add", effectivePreconCap, "dry_run");
      setState((s) => ({ ...s, precon: { ...s.precon, step: "preview", report, file } }));
    } catch (err) {
      setPreconError(
        err instanceof ImportApiError ? err.message : "Something went wrong previewing that deck."
      );
    } finally {
      setPreviewingPrecon(false);
    }
  }

  async function handlePreconCommit() {
    const file = state.precon.file;
    if (!file || preconCommitting) return;
    setPreconCommitting(true);
    setPreconError(null);
    // The precon dry-run report in state has the exact batch size the verify
    // screen's own "N of M cards will be added" hint shows -- recomputed
    // here via verificationRowsFromReport directly (not the memoized
    // preconVerifyRows below) since this function is declared above that
    // useMemo in source order; React Compiler bails on a memo that an
    // earlier-declared closure references, so reaching for it from here
    // would lose the memoization. `file` and `report` are always set
    // together (handlePreconPreview's one setState call above), so `file`
    // truthy here guarantees `report` is too.
    const count = state.precon.report
      ? verificationRowsFromReport(state.precon.report).willAdd.length
      : 0;
    try {
      await overlay.run(
        { message: `Applying ${count.toLocaleString()} ${count === 1 ? "card" : "cards"}…` },
        {
          task: () => runImport(file, "merge_add", effectivePreconCap, "commit"),
          settleStage: { message: "Refreshing your Vault…" },
          settle: async () => {
            await onCommitted();
          },
        }
      );
    } catch (err) {
      if (err instanceof ImportApiError && err.code === "email_not_verified") {
        // Email-verification gate: stop here and keep the modal open on the
        // same explanatory copy the manual flow's EmailNotVerifiedError
        // branch uses, rather than closing as if the import had succeeded.
        // onCommitted still fires directly (not through the overlay's
        // settle, which only runs when the task itself resolved). Unlike the
        // manual branch there is no partial progress to pick up: the
        // backend's require_verified_email dependency rejects the import
        // before any write, so this refresh re-reads unchanged data.
        setPreconError("Verify your email to manage inventory -- see the banner above.");
        onCommitted();
        setPreconCommitting(false);
        return;
      }
      // Any other ImportApiError: surface it in the modal foot and stay
      // open -- unlike the manual flow's loop (which has no way to roll back
      // partial progress), a precon commit is one all-or-nothing transaction,
      // so nothing has changed server-side and there's nothing to refresh.
      setPreconError(
        err instanceof ImportApiError ? err.message : "Something went wrong committing that import."
      );
      setPreconCommitting(false);
      return;
    }
    setPreconCommitting(false);
    // add_cards_committed for the precon route (App Spec §22) -- cards_added
    // sums ACTUAL applied copies per resolved row (resulting_quantity minus
    // current_quantity, floored at 0 -- a trimmed row applies fewer than the
    // deck's own quantity), distinct_cards is the resolved row count (each
    // report row is already one distinct printing). state.precon.report is
    // still the same report handlePreconPreview set -- untouched through the
    // commit above.
    if (state.precon.report) {
      const resolvedRows = state.precon.report.rows.filter((r) => r.status === "resolved");
      const cardsAdded = resolvedRows.reduce(
        (sum, r) => sum + Math.max(0, (r.resulting_quantity ?? 0) - (r.current_quantity ?? 0)),
        0
      );
      capture("add_cards_committed", {
        method: "precon",
        cards_added: cardsAdded,
        distinct_cards: resolvedRows.length,
      });
    }
    onClose();
  }

  // Each row resolves against its own setCode — no dependency on
  // which set is currently active in the set bar.
  const { canSubmit, hasErrors, willAdd, willSkip } = useMemo(() => {
    const resolutions = state.rows.map((r) => resolveRow(r, catalog));

    const resolvedRows = resolutions.filter((r) => r.status === "resolved");
    const hasErrors = resolutions.some((r) => r.status === "error");
    const hasPending = resolutions.some((r) => r.status === "pending");
    const canSubmit = resolvedRows.length > 0 && !hasErrors && !hasPending;

    const { willAdd, willSkip } = splitForVerification(state.rows, catalog, limits, capMode);

    return { canSubmit, hasErrors, willAdd, willSkip };
  }, [state.rows, catalog, limits, capMode]);

  // Manual willAdd/willSkip flattened into the shared VerificationRow shape
  // AddCardsVerification renders for both flows --
  // see addCardsResolver.ts's toVerificationRow doc comment for why this is
  // a pure flatten, not a reclassification.
  const manualVerifyRows = useMemo(
    () => ({
      willAdd: willAdd.map((item) => toVerificationRow(item)),
      willSkip: willSkip.map((item) => toVerificationRow(item, "Inventory limit already reached.")),
    }),
    [willAdd, willSkip]
  );

  // The precon dry-run report, mapped the same way (utils/preconImport.ts's
  // verificationRowsFromReport) -- empty until a preview has actually run.
  const preconVerifyRows = useMemo(
    () =>
      state.precon.report
        ? verificationRowsFromReport(state.precon.report)
        : { willAdd: [], willSkip: [], unresolved: [] },
    [state.precon.report]
  );
  const preconTotalRows =
    preconVerifyRows.willAdd.length +
    preconVerifyRows.willSkip.length +
    preconVerifyRows.unresolved.length;

  const hintText = useMemo((): string => {
    if (hasErrors) return "Resolve the error above to continue.";
    if (canSubmit) {
      const count = state.rows.filter((r) => r.cardNumber).length;
      return `${count} ${count === 1 ? "card" : "cards"} ready to add.`;
    }
    if (!state.activeSetCode) return "Select a set above to enable entry.";
    return "";
  }, [state.activeSetCode, state.rows, hasErrors, canSubmit]);

  async function handleCommit() {
    if (willAdd.length === 0 || committing) return;
    setCommitting(true);
    setCommitError(null);
    // Batch size is known at commit time (willAdd is the exact set of rows
    // about to be added) -- the same figure the verification footer's "N of
    // M cards will be added" hint uses.
    const count = willAdd.length;
    // add_cards_committed's distinct_cards (App Spec §22) -- each willAdd row
    // is one physical copy (a keypad entry is always a single card), so
    // multiple rows resolving to the same printing collapse to one variant
    // id here, same grouping the network loop below performs independently.
    const distinctCount = new Set(willAdd.map((w) => w.resolved.variantId)).size;
    try {
      await overlay.run(
        { message: `Applying ${count.toLocaleString()} ${count === 1 ? "card" : "cards"}…` },
        {
          task: async () => {
            // Grouped by variant_id: one adjustCard call per DISTINCT
            // variant, so several copies of the same printing (e.g. three
            // rows all resolving to the same variant) send one delta=3 call
            // rather than three delta=1 calls (the debounced-delta adjust
            // endpoint, App Spec §5.3 / §12). The loop does not inspect the
            // response: willAdd's own pre-check (splitForVerification) has
            // already decided what belongs in this batch.
            const deltaByVariant = new Map<number, number>();
            for (const { resolved } of willAdd) {
              deltaByVariant.set(
                resolved.variantId,
                (deltaByVariant.get(resolved.variantId) ?? 0) + 1
              );
            }
            for (const [variantId, delta] of deltaByVariant) {
              await adjustCard(variantId, delta);
            }
          },
          settleStage: { message: "Refreshing your Vault…" },
          settle: async () => {
            await onCommitted();
          },
        }
      );
    } catch (err) {
      if (err instanceof EmailNotVerifiedError) {
        // Stop the batch and keep the modal open on an explanatory
        // message instead of closing as if the whole commit had succeeded.
        // Still call onCommitted() (but not onClose()) -- some rows in the
        // batch may have already committed before the gate rejected the
        // rest, so the parent's data should refresh even though the modal
        // stays open for the user to see the error. Called directly (not
        // through the overlay's settle, which only runs when the task
        // itself resolved without throwing).
        setCommitError("Verify your email to manage inventory -- see the banner above.");
        onCommitted();
        setCommitting(false);
        return;
      }
      console.error("Commit failed:", err);
      setCommitting(false);
      return;
    }
    setCommitting(false);
    capture("add_cards_committed", {
      method: "keypad",
      cards_added: count,
      distinct_cards: distinctCount,
    });
    onClose();
  }

  const totalResolved = willAdd.length + willSkip.length;

  // Route locking (App Spec §18): there is no separate tracked field for
  // "which route is active"; it's derived fresh from the state that exists
  // for other reasons.
  //   - manual is locked the moment there's an active set OR any row already
  //     has a card number -- i.e. "Change Set" alone does NOT clear the
  //     lock if rows are still in the batch (you're still mid-batch). Only
  //     clearing BOTH (no set, no rows) releases it.
  //   - precon is locked the moment a deck is selected -- unlike manual, it
  //     has no residual concept, so clearing the selection ("Change Deck")
  //     IS the full-clear condition; nothing else could keep it locked.
  // The two are mutually exclusive by construction: the UI never offers the
  // OTHER route's bar while one is locked (see the bars' render block
  // below), so there's no path that sets both simultaneously.
  const manualLocked = state.activeSetCode !== null || state.rows.some((r) => r.cardNumber);
  const preconLocked = state.precon.selection !== null;
  const route: "cards" | "precon" | null = manualLocked ? "cards" : preconLocked ? "precon" : null;

  // The header title's "Verify cards to add" copy applies
  // whichever route's verification-equivalent step is showing -- the manual
  // flow's "verification" phase, or the precon flow's "preview" step.
  const showingVerifyTitle =
    (route === "cards" && state.phase === "verification") ||
    (route === "precon" && state.precon.step === "preview");

  return (
    <div
      className="ac-overlay modal-overlay modal-overlay--top"
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="ac-modal" role="dialog" aria-modal="true" aria-labelledby="ac-title">
        <div className="ac-modal__head">
          <div>
            <h2 className="ac-modal__title" id="ac-title">
              {showingVerifyTitle ? "Verify cards to add" : "Add cards"}
            </h2>
          </div>
          <button
            type="button"
            className="ac-modal__close"
            onClick={requestClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Circuit separator straddling the header/set-bar seam, the same
            SectionSeparator App.tsx places at the app header/content seam. */}
        <SectionSeparator />

        {/* Route locking (App Spec §18) -- only the LOCKED route's bar
            renders once a selection has been made; the other route's bar is
            gone entirely (not just visually hidden) until the locked route
            fully clears. Neither bar's own state (`activeSetCode`/
            `rows` vs. `precon`) is ever touched by locking/unlocking the
            other, so nothing either side had in progress is lost across a
            round trip through the chooser. */}
        {route === "cards" && (
          <AddCardsSetBar
            sets={sets}
            catalog={catalog}
            setCode={state.activeSetCode}
            onChoose={setSet}
            onChangeSet={changeSet}
          />
        )}
        {route === "precon" && (
          <AddCardsPreconBar
            entries={PRECON_ENTRIES}
            sets={sets}
            catalog={catalog}
            selectedKey={state.precon.selection?.key ?? null}
            onChoose={selectPrecon}
            onChangeDeck={changePreconDeck}
          />
        )}
        {/* Neither route locked -- the initial/cleared state offers both
            drop-downs SIDE BY SIDE (wraps at narrow widths, .ac-chooser-row
            in AddCardsModal.css), each bar's own unlocked-picker label copy
            making the split unmistakable ("Add individual cards" / "Add a
            premade deck", set directly in each component). */}
        {route === null && (
          <div className="ac-chooser-row">
            <AddCardsSetBar
              sets={sets}
              catalog={catalog}
              setCode={state.activeSetCode}
              onChoose={setSet}
              onChangeSet={changeSet}
            />
            <AddCardsPreconBar
              entries={PRECON_ENTRIES}
              sets={sets}
              catalog={catalog}
              selectedKey={state.precon.selection?.key ?? null}
              onChoose={selectPrecon}
              onChangeDeck={changePreconDeck}
            />
          </div>
        )}

        <div className="ac-modal__body">
          {route === "cards" && state.phase === "editing" && state.activeSetCode && (
            <AddCardsKeypad
              setCode={state.activeSetCode}
              rows={state.rows}
              catalog={catalog}
              sets={sets}
              onAppendRow={appendRow}
              onDeleteRow={deleteRow}
            />
          )}
          {route === "cards" && state.phase === "verification" && (
            <AddCardsVerification
              willAdd={manualVerifyRows.willAdd}
              willSkip={manualVerifyRows.willSkip}
              sets={sets}
            />
          )}

          {/* Rendered ONLY for hard-cap-mode users (App Spec §18). No need
              to guard on `state.precon.selection` here -- route can only BE
              "precon" when preconLocked is true, which already means a
              selection exists. */}
          {route === "precon" && state.precon.step === "select" && capMode === "hard" && (
            <div className="ac-radio" role="radiogroup" aria-label="Keep-limit handling">
              <label className="ac-radio__option">
                <input
                  type="radio"
                  name="ac-precon-cap"
                  value="trim"
                  checked={state.precon.capHandling === "trim"}
                  onChange={() => setPreconCapHandling("trim")}
                />
                <span className="ac-radio__text">
                  <span className="ac-radio__title">
                    Don&apos;t add copies above my keep-limits
                  </span>
                </span>
              </label>
              <label className="ac-radio__option">
                <input
                  type="radio"
                  name="ac-precon-cap"
                  value="add_above"
                  checked={state.precon.capHandling === "add_above"}
                  onChange={() => setPreconCapHandling("add_above")}
                />
                <span className="ac-radio__text">
                  <span className="ac-radio__title">
                    Add the full deck, even above my keep-limits
                  </span>
                </span>
              </label>
            </div>
          )}
          {route === "precon" && state.precon.step === "preview" && state.precon.report && (
            <AddCardsVerification
              willAdd={preconVerifyRows.willAdd}
              willSkip={preconVerifyRows.willSkip}
              unresolvedRows={preconVerifyRows.unresolved}
              sets={sets}
            />
          )}
        </div>

        <div className="ac-modal__foot">
          {route === "cards" && commitError && (
            <span className="ac-modal__foot-error">{commitError}</span>
          )}
          {route === "precon" && preconError && (
            <span className="ac-modal__foot-error">{preconError}</span>
          )}
          {route === "cards" ? (
            state.phase === "editing" ? (
              <>
                {hintText && <span className="ac-modal__foot-hint">{hintText}</span>}
                <span className="ac-modal__foot-spacer" />
                <SWUButton size="sm" onClick={requestClose}>
                  Cancel
                </SWUButton>
                <SWUButton size="sm" active={canSubmit} onClick={canSubmit ? submit : undefined}>
                  Add Cards to Inventory
                </SWUButton>
              </>
            ) : (
              <>
                <span className="ac-modal__foot-hint">
                  {willAdd.length} of {totalResolved} cards will be added.
                </span>
                <span className="ac-modal__foot-spacer" />
                <SWUButton size="sm" onClick={backToEditing}>
                  Edit
                </SWUButton>
                <SWUButton size="sm" onClick={requestClose}>
                  Cancel
                </SWUButton>
                <SWUButton
                  size="sm"
                  active={willAdd.length > 0 && !committing}
                  onClick={willAdd.length > 0 && !committing ? handleCommit : undefined}
                >
                  Add Cards to Inventory
                </SWUButton>
              </>
            )
          ) : route === "precon" ? (
            state.precon.step === "select" ? (
              <>
                {/* Route can only be "precon" with a selection already made
                    (preconLocked), so this is always "Ready to preview." --
                    there is no "nothing selected yet" branch. */}
                <span className="ac-modal__foot-hint">Ready to preview.</span>
                <span className="ac-modal__foot-spacer" />
                <SWUButton size="sm" onClick={requestClose}>
                  Cancel
                </SWUButton>
                <SWUButton
                  size="sm"
                  active={!previewingPrecon}
                  onClick={!previewingPrecon ? handlePreconPreview : undefined}
                >
                  {previewingPrecon ? "Previewing…" : "Preview adding deck"}
                </SWUButton>
              </>
            ) : (
              <>
                <span className="ac-modal__foot-hint">
                  {preconVerifyRows.willAdd.length} of {preconTotalRows} cards will be added.
                </span>
                <span className="ac-modal__foot-spacer" />
                <SWUButton size="sm" onClick={backToPreconSelect}>
                  {/* Hard-cap users go "back" to edit the keep-limit RULE,
                      not the deck's own batch (you don't edit a premade
                      deck's contents) -- "Edit keep-limit rule". Soft/
                      no-limit users have no rule on screen at all, so they
                      get a plain "Back". */}
                  {capMode === "hard" ? "Edit keep-limit rule" : "Back"}
                </SWUButton>
                <SWUButton size="sm" onClick={requestClose}>
                  Cancel
                </SWUButton>
                <SWUButton
                  size="sm"
                  active={!preconCommitting}
                  onClick={!preconCommitting ? handlePreconCommit : undefined}
                >
                  Add Cards to Inventory
                </SWUButton>
              </>
            )
          ) : (
            // Neither route locked -- the side-by-side chooser is
            // showing above; nothing to preview/submit yet.
            <>
              <span className="ac-modal__foot-hint">
                Select a set or a precon deck above to begin.
              </span>
              <span className="ac-modal__foot-spacer" />
              <SWUButton size="sm" onClick={requestClose}>
                Cancel
              </SWUButton>
            </>
          )}
        </div>
      </div>

      {/* Console-styled close-guard confirm. Rendered as a sibling overlay
          layer above the modal (not a nested dialog inside it) so it isn't
          clipped by .ac-modal's own clip-path. */}
      {confirming && (
        <div
          className="ac-confirm-overlay modal-overlay modal-overlay--nested"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="ac-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ac-confirm-title"
          >
            <div className="ac-confirm__title" id="ac-confirm-title">
              Discard this batch?
            </div>
            <p className="ac-confirm__body">
              None of the cards you have entered will be added to inventory if you close now.
            </p>
            <div className="ac-confirm__actions">
              <span className="ac-confirm__danger">
                <SWUButton
                  size="sm"
                  active
                  onClick={() => {
                    capture("add_cards_abandoned", { pending_entries: pendingEntries });
                    setConfirming(false);
                    onClose();
                  }}
                >
                  Discard &amp; Close
                </SWUButton>
              </span>
              <SWUButton size="sm" active onClick={() => setConfirming(false)}>
                Return to Batch
              </SWUButton>
            </div>
          </div>
        </div>
      )}

      {/* Covers a manual or precon commit -- z-index 300 (see
          BusyOverlay.css) clears both this modal (100) and the close-guard
          confirm above (200), which can in principle still be up
          underneath if a stray requestClose slipped through mid-commit. */}
      <BusyOverlay stage={overlay.stage} />
    </div>
  );
}
