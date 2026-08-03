import { useCallback, useEffect, useRef, useState } from "react";

/** BL-196: staged status shown by BusyOverlay while a large inventory apply
 * (Import dry_run/commit, Add Cards / precon commit) is in flight. `sub` is
 * optional (e.g. a card count) -- callers that don't need it just omit it. */
export interface BusyStage {
  message: string;
  sub?: string;
}

/** Resolves on the frame AFTER the next paint. Single rAF only guarantees
 * "before the browser's next paint" -- it can still fire before that paint
 * has actually happened. The second rAF waits for a callback scheduled
 * *after* the first one's paint, which is the guarantee callers actually
 * need: the overlay must outlive the paint of whatever re-render it was
 * covering for (the Vault table repainting off freshly-refetched
 * quantities, the Import preview panel rendering its report). */
function doubleRaf(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface RunStagedOptions<T> {
  /** The async work to show the initial stage for (e.g. runImport,
   * incrementCard in a loop). */
  task: () => Promise<T>;
  /** If provided, the overlay switches to this stage once `task` resolves,
   * before `settle` runs -- e.g. "Refreshing your Vault…" while the
   * quantities refetch is in flight. Omit for paths that don't mutate
   * inventory (Import's dry_run preview). */
  settleStage?: BusyStage;
  /** Awaited after `task` resolves (and after `settleStage` is shown) --
   * e.g. the quantities refetch promise. Callers that want a failed refresh
   * to stay silent (matching the app's existing fire-and-forget refresh
   * error handling) should swallow errors inside this function themselves;
   * anything it throws propagates out of `run` after the overlay still
   * comes down (finally still runs). */
  settle?: () => Promise<void>;
}

export interface UseBusyOverlayResult {
  stage: BusyStage | null;
  /** DEV-only "keep it open" affordance (BusyOverlay's corner switcher) --
   * lets the owner watch a real run without the overlay vanishing before
   * they can judge the animation. Turning it back OFF while something is
   * being held open closes it immediately (see toggleHold below) -- there's
   * no other event that would. */
  hold: boolean;
  /** Runs `task` with the overlay showing `initial`, optionally staging
   * through `settleStage`/`settle` once it resolves, then double-rAFs
   * before hiding so the overlay outlives the paint of whatever re-render
   * the caller's own work triggers. Always hides in a `finally` unless HOLD
   * is on -- errors from `task`/`settle` propagate to the caller after the
   * overlay comes down (or stays up, under HOLD). */
  run<T>(initial: BusyStage, options: RunStagedOptions<T>): Promise<T>;
  /** Shows `stage` with no task attached -- the Import screen's DEV-only
   * "Preview overlay" button uses this to open the overlay on demand.
   * Calling it again while a preview is already showing hides it (a manual
   * toggle) rather than stacking a second preview. */
  previewStage(stage: BusyStage): void;
  hide(): void;
  toggleHold(): void;
}

/** BL-196: one hook, three call sites (ImportExportPage's dry_run/commit,
 * AddCardsModal's manual/precon commit) -- overlay state stays local to
 * whichever surface renders it, no global store. Each surface pairs this
 * with its own `<BusyOverlay stage={overlay.stage} hold={overlay.hold}
 * onToggleHold={overlay.toggleHold} />`. */
export function useBusyOverlay(): UseBusyOverlayResult {
  const [stage, setStage] = useState<BusyStage | null>(null);
  const [hold, setHold] = useState(false);
  // `run`'s finally clause reads the CURRENT hold value, not whatever it
  // was when `run` was called -- the owner can flip HOLD mid-flight and
  // have it take effect immediately. A ref (rather than putting `hold` in
  // run's own closure/deps) sidesteps re-creating `run` on every toggle.
  // Synced via an effect, not a direct render-time write -- refs are only
  // safe to write outside of render (React Compiler's own react-hooks/refs
  // rule flags a direct assignment here); `run` itself always executes
  // later, from an event handler, well after this effect has flushed.
  const holdRef = useRef(hold);
  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  // Not wrapped in useCallback: a generic arrow function's type parameter
  // doesn't survive useCallback's own generic inference (it collapses to
  // whatever T the first call site happens to use), which would silently
  // break every other caller of this hook. The closed-over setters/ref are
  // already stable, so skipping memoization here costs nothing real -- call
  // sites invoke `run` directly from event handlers, never from a
  // useEffect/useCallback dependency array.
  async function run<T>(initial: BusyStage, options: RunStagedOptions<T>): Promise<T> {
    setStage(initial);
    try {
      const result = await options.task();
      if (options.settleStage) setStage(options.settleStage);
      if (options.settle) await options.settle();
      await doubleRaf();
      return result;
    } finally {
      if (!holdRef.current) setStage(null);
    }
  }

  const hide = useCallback(() => setStage(null), []);

  const previewStage = useCallback((s: BusyStage) => {
    setStage((current) => (current ? null : s));
  }, []);

  const toggleHold = useCallback(() => {
    setHold((h) => {
      const next = !h;
      if (!next) setStage(null);
      return next;
    });
  }, []);

  return { stage, hold, run, previewStage, hide, toggleHold };
}
