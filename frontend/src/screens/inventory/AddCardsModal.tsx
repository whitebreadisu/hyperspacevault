import { useState, useCallback, useEffect, useMemo } from "react";
import { getSets } from "../../api/sets";
import { incrementCard, EmailNotVerifiedError } from "../../api/inventory";
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
import type { Row, AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import type { PreconEntry } from "../../data/preconDecks";
import type { CapHandling, ImportReport } from "../../api/inventoryImportExport";
import type { CardSet } from "../../api/sets";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { useBusyOverlay } from "../../hooks/useBusyOverlay";
import { BusyOverlay } from "../../components/BusyOverlay";
import "./AddCardsModal.css";

type Phase = "editing" | "verification";

/** Static entry list, computed once at module scope -- preconEntries() reads
 * the checked-in preconDecks.json, which doesn't change at runtime. */
const PRECON_ENTRIES = preconEntries();

interface PreconState {
  selection: PreconEntry | null;
  /** P2: hard-mode users' trim/add-above choice. Meaningless (never sent) for
   * soft/no-limit users, who always send "add_above" -- see effectivePreconCap
   * below. Defaults to "trim" (§4: "Don't add copies above my keep-limits" is
   * the default option). */
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
  // Distinct from any given row's own `setCode` (BL-61) — switching this no
  // longer touches rows already committed under a different set, so a batch
  // can span multiple sets until commit.
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
  /** BL-196: widened from `() => void` -- CardsPage now passes an async
   * function (awaiting its own refreshQuantities) so the commit-stage busy
   * overlay's "Refreshing your Vault…" stage can hold through it. Callers
   * that still return void/undefined (the EmailNotVerifiedError/precon-
   * error partial-progress-refresh calls below, and every test's plain
   * `vi.fn()`) keep working unchanged -- `await onCommitted()` on a
   * void-returning function just resolves immediately. */
  onCommitted: () => void | Promise<void>;
}

export function AddCardsModal({ catalog, onClose, onCommitted }: Props) {
  // BL-25/BL-35: the tenant's effective keep-limit matrix (null -> code
  // defaults) and cap_mode (hard/soft), threaded into the pure resolver
  // helpers below and into the keypad.
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
  // BL-151 S2: the precon flow's own commit/preview lifecycle -- kept
  // separate from the manual flow's committing/commitError above rather than
  // shared, since the two flows drive genuinely different network calls
  // (incrementCard loop vs. runImport) and can each be mid-flight
  // independently of which surface is currently displayed.
  const [previewingPrecon, setPreviewingPrecon] = useState(false);
  const [preconCommitting, setPreconCommitting] = useState(false);
  const [preconError, setPreconError] = useState<string | null>(null);
  // BL-111 F7 (design handoff §7): close guard -- Cancel/X/Escape/backdrop
  // with a non-empty batch raises a confirm instead of closing outright.
  // `hasBatch` only counts *committed* rows (the keypad's in-progress draft
  // doesn't count -- nothing typed but not yet added to the batch would be
  // lost either way, but the confirm's copy talks about "cards you have
  // entered", i.e. the committed batch). A close that follows a successful
  // commit (handleCommit's own onClose() call below) never routes through
  // requestClose, so it skips the confirm unconditionally -- nothing to
  // guard once the batch has already been added.
  // BL-151 (§4-REV carries this forward unchanged, §4-REV2 doesn't touch
  // it): "a selected deck counts as batch in progress for the guard" --
  // hasBatch covers both routes' in-progress state regardless of which one
  // is currently locked/displayed.
  const [confirming, setConfirming] = useState(false);
  const hasBatch = state.rows.some((r) => r.cardNumber) || state.precon.selection !== null;
  const requestClose = useCallback(() => {
    if (hasBatch) setConfirming(true);
    else onClose();
  }, [hasBatch, onClose]);

  // BL-196: the commit-stage busy overlay -- shared between the manual
  // (handleCommit) and precon (handlePreconCommit) commit paths below, same
  // "overlay state local to the surface" shape ImportExportPage's own
  // instance uses.
  const overlay = useBusyOverlay();

  useEffect(() => {
    getSets().then(setSets).catch(console.error);
  }, []);

  // BL-153: Escape dismisses the close-guard confirm first (if it's up)
  // before it can raise/trigger requestClose again -- same "nested state
  // collapses first" shape as CardPopup's history panel. Backdrop-click
  // dismiss reuses the same target-equality pattern CardPopup uses -- see
  // useModalDismiss's docstring.
  // BL-196: a no-op while the busy overlay is up -- it renders with no
  // dismiss affordance of its own (BusyOverlay.tsx's doc comment), but the
  // Escape LISTENER underneath it (this hook) stays attached the whole time
  // regardless, so it has to explicitly ignore Escape itself rather than
  // relying on the overlay to swallow the keypress first.
  const onEscape = useCallback(() => {
    if (overlay.stage) return;
    if (confirming) setConfirming(false);
    else requestClose();
  }, [overlay.stage, confirming, requestClose]);
  const { handleBackdropMouseDown } = useModalDismiss(onEscape, { onBackdropClick: requestClose });

  // BL-61: neither of these touches `rows` — the batch is non-destructive
  // across set changes, and can end up spanning multiple sets.
  const setSet = useCallback((code: string) => {
    setState((s) => ({ ...s, activeSetCode: code, phase: "editing" }));
  }, []);

  // BL-151 S2c (§4-REV2): "Change set" unlocks the SET BAR's own picker
  // sub-state, but does NOT by itself clear the manual route lock -- if rows
  // are still in the batch, `manualLocked` below stays true (the precon bar
  // stays hidden; you're still mid-batch). Route locking is derived entirely
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

  // BL-151 S2c (§4-REV2): unlike the manual route, precon has no "residual"
  // concept -- clearing the selection IS the precon route's full-clear
  // condition (there's nothing else that could keep it locked), so "Change
  // Deck" immediately returns to the side-by-side chooser (both bars
  // reappear) the moment this runs, matching the owner's explicit "that's
  // correct and intended" note.
  const changePreconDeck = useCallback(() => {
    setState((s) => ({ ...s, precon: { ...s.precon, selection: null, step: "select" } }));
  }, []);

  const setPreconCapHandling = useCallback((capHandling: CapHandling) => {
    setState((s) => ({ ...s, precon: { ...s.precon, capHandling } }));
  }, []);

  const backToPreconSelect = useCallback(() => {
    setState((s) => ({ ...s, precon: { ...s.precon, step: "select" } }));
  }, []);

  // P2: hard-mode users' explicit trim/add-above choice; soft/no-limit users
  // always send "add_above" (§4 -- "no UI" for them, their over-limit
  // indicators already communicate state post-refresh).
  const effectivePreconCap: CapHandling =
    capMode === "hard" ? state.precon.capHandling : "add_above";

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
    // BL-196: the precon dry-run report already sitting in state has the
    // exact batch size the verify screen's own "N of M cards will be added"
    // hint shows -- recomputed here via verificationRowsFromReport directly
    // (not the memoized preconVerifyRows below) since this function is
    // declared above that useMemo in source order; reaching for the memo
    // from here defeats React Compiler's ability to preserve it (verified
    // empirically -- referencing a later-declared memo from an
    // earlier-declared closure makes it bail on that memo entirely). `file`
    // and `report` are always set together (handlePreconPreview's one
    // setState call below), so `file` truthy here guarantees `report` is
    // too.
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
        // BL-16-equivalent gate: stop here and keep the modal open on the
        // same explanatory copy the manual flow's EmailNotVerifiedError
        // branch uses, rather than closing as if the import had succeeded.
        // onCommitted still fires directly (not through the overlay's
        // settle, which only runs when the task itself resolved) -- the
        // partial-progress refresh reason is unchanged from before BL-196.
        setPreconError("Verify your email to manage inventory -- see the banner above.");
        onCommitted();
        setPreconCommitting(false);
        return;
      }
      // Any other ImportApiError (§4): surface it in the modal foot and stay
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
    onClose();
  }

  // Each row resolves against its own setCode (BL-61) — no dependency on
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

  // BL-151 S2b (§4-REV): manual willAdd/willSkip flattened into the shared
  // VerificationRow shape AddCardsVerification now renders for both flows --
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
    // BL-196: batch size is already known at commit time (willAdd is the
    // exact set of rows about to be incremented) -- the same figure the
    // verification footer's "N of M cards will be added" hint uses.
    const count = willAdd.length;
    try {
      await overlay.run(
        { message: `Applying ${count.toLocaleString()} ${count === 1 ? "card" : "cards"}…` },
        {
          task: async () => {
            for (const { resolved } of willAdd) {
              await incrementCard(resolved.variantId);
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
        // BL-16: stop the batch and keep the modal open on an explanatory
        // message instead of closing as if the whole commit had succeeded.
        // Still call onCommitted() (but not onClose()) -- some rows in the
        // batch may have already committed before the gate rejected the
        // rest, so the parent's data should refresh even though the modal
        // stays open for the user to see the error. Called directly (not
        // through the overlay's settle, which only runs when the task
        // itself resolved without throwing) -- same reasoning as the precon
        // flow's own email-not-verified branch above.
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
    onClose();
  }

  const totalResolved = willAdd.length + willSkip.length;

  // BL-151 S2c (§4-REV2): route locking replaces S2b's "last-used-wins,
  // both bars always visible" `activeSurface` model outright -- there is no
  // separate tracked field for "which route is active" any more; it's
  // derived fresh from the state that already exists for other reasons.
  //   - manual is locked the moment there's an active set OR any row already
  //     has a card number -- i.e. "Change Set" alone does NOT clear the
  //     lock if rows are still in the batch (owner: "you're still
  //     mid-batch"). Only clearing BOTH (no set, no rows) releases it.
  //   - precon is locked the moment a deck is selected -- unlike manual, it
  //     has no residual concept, so clearing the selection ("Change Deck")
  //     IS the full-clear condition; nothing else could keep it locked.
  // The two are mutually exclusive by construction: the UI never offers the
  // OTHER route's bar while one is locked (see the bars' render block
  // below), so there's no path that sets both simultaneously.
  const manualLocked = state.activeSetCode !== null || state.rows.some((r) => r.cardNumber);
  const preconLocked = state.precon.selection !== null;
  const route: "cards" | "precon" | null = manualLocked ? "cards" : preconLocked ? "precon" : null;

  // BL-151 S2c: the header title's "Verify cards to add" copy applies
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

        {/* BL-111 F7 (design handoff §7): circuit separator straddling the
            header/set-bar seam, same reusable pattern F2 built for the app
            header/content seam. */}
        <SectionSeparator />

        {/* BL-151 S2c (§4-REV2): route locking -- only the LOCKED route's
            bar renders once a selection has been made; the other route's
            bar is gone entirely (not just visually hidden) until the locked
            route fully clears. Neither bar's own state (`activeSetCode`/
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
        {/* §4-REV2 point 1: neither route locked -- the initial/cleared
            state offers both drop-downs SIDE BY SIDE (wraps at narrow
            widths, .ac-chooser-row in AddCardsModal.css), each bar's own
            unlocked-picker label copy making the split unmistakable
            ("Add individual cards" / "Add a premade deck", set directly in
            each component). */}
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

          {/* §4-REV P2: rendered ONLY for hard-cap-mode users. No need to
              guard on `state.precon.selection` here (unlike the S2b
              version) -- route can only BE "precon" when preconLocked is
              true, which already means a selection exists. */}
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
                    no more "nothing selected yet" branch to account for. */}
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
                  {/* §4-REV2 point 3: "Preview Deck" -> "Preview adding deck". */}
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
                  {/* §4-REV2 point 3 (owner): hard-cap users go "back" to
                      edit the keep-limit RULE, not the deck's own batch (you
                      don't edit a premade deck's contents) -- "Edit keep-
                      limit rule". Soft/no-limit users have no rule on screen
                      at all, so labeling one would be actively wrong; this
                      plain-"Back" variant for that case is an orchestrator
                      call (not explicit in the owner's note), recorded here. */}
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
            // §4-REV2: neither route locked -- the side-by-side chooser is
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

      {/* BL-111 F7 (design handoff §7): console-styled close-guard confirm.
          Rendered as a sibling overlay layer above the modal (not a nested
          dialog inside it) so it isn't clipped by .ac-modal's own
          clip-path. */}
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

      {/* BL-196: covers a manual or precon commit -- z-index 300 (see
          BusyOverlay.css) clears both this modal (100) and the close-guard
          confirm above (200), which can in principle still be up
          underneath if a stray requestClose slipped through mid-commit. */}
      <BusyOverlay stage={overlay.stage} hold={overlay.hold} onToggleHold={overlay.toggleHold} />
    </div>
  );
}
