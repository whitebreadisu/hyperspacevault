import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EmailNotVerifiedError } from "../api/inventory";
import { SplitChangedError, StashApiError } from "../api/stashes";
import type { Stash } from "../api/stashes";
import { useStashes } from "./StashContext";
import { stashSaveStore } from "./stashSaveStore";
import type { Split } from "./stashSaveStore";

// The card detail's stash editing state (handoff README "State"),
// shared by desktop 1a (the popup's inventory panel) and phone 1e (the stash
// sheet). Per selected printing:
//   mode    'read' (a1/b1 label or c1 list), 'edit' (b2/c2/d1/d2/e1 rows),
//           'create' (a2 New stash form);
//   draft   stash_id -> quantity as shown: the saved split plus the clicks
//           not yet confirmed by the server;
//   returnTo where Create / Cancel in the form goes back to.
// Vault = owned - sum(draft), never below 0: `+` is offered only while the
// Vault holds a copy, `-` only while the stash does.
//
// Saves apply on click (owner 2026-11-08), as the owned stepper does: each
// -/+ changes the rows at once. The saving itself lives outside React in
// stashSaveStore.ts (one store and one serial PUT queue per app): this hook
// reads the printing's desired split from it, so every card view, visit or
// remount shows the same truth. Done only collapses the section and queues
// an open window at once; a printing change, closing the card or losing
// availability queue it too: nothing is discarded. A failed save is undone
// in the store; a view showing that printing reopens its rows with the
// message, a view that changed it and moved on says so in the card's error
// line (`notice`). There is no Cancel.

export type StashMode = "read" | "edit" | "create";

/** Decrease floor (owner, 2026-11-07): owned can never go below the
 * printing's stashed total; the owned `-` says so (title on desktop, the
 * accessible name on both). The server clamps there too. */
export const STASH_FLOOR_HINT = "All copies are stashed. Remove from a stash first.";

export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 280;

export { STASH_SAVE_DEBOUNCE_MS } from "./stashSaveStore";

export const STASH_ERRORS = {
  duplicate: "You already have a stash with this name. Choose another name.",
  limit: "You have 50 stashes, the most allowed. Use one you already have.",
  createFailed: "The stash was not created. Try again.",
  exceeds: "These stashes hold more copies than you own. The last change was undone.",
  saveFailed: "The last change was not saved. Try again.",
  keptLater: "The last change was not saved; later changes were kept.",
  changed: "These stashes changed elsewhere. The last change was not saved.",
  verify: "Verify your email to manage stashes -- see the banner above.",
} as const;

/** One stash's row in edit mode (desktop rows and the phone sheet alike). */
export interface StashRow {
  stash: Stash;
  qty: number;
  /** `+` moves a copy Vault -> this stash: only while the Vault holds one. */
  canInc: boolean;
  /** `-` moves a copy back to the Vault: only while the stash holds one. */
  canDec: boolean;
  incLabel: string;
  decLabel: string;
}

/** Stashes holding a printing, creation order, with their counts (the
 * read-only list; the phone's neighbour page reads it too). */
export function holdingOf(
  stashes: Stash[],
  allocations: Record<number, number>
): { stash: Stash; qty: number }[] {
  return stashes
    .filter((s) => (allocations[s.id] ?? 0) > 0)
    .map((s) => ({ stash: s, qty: allocations[s.id] }));
}

export interface StashEditor {
  /** The stash UI applies (signed in, own vault, loaded, at least 1 owned). */
  available: boolean;
  /** It will apply once the first stash read lands (owned printing, read in
   * flight): the phone region keeps the entry's room meanwhile. */
  pending: boolean;
  mode: StashMode;
  /** Where the New stash form's Cancel goes. */
  returnTo: "read" | "edit";
  stashes: Stash[];
  /** The committed split for this printing. */
  saved: Record<number, number>;
  /** Stashes holding this printing as shown, creation order (the read-only
   * list; includes clicks still being saved). */
  holding: { stash: Stash; qty: number }[];
  /** The split as shown (saved + unconfirmed clicks). */
  draft: Record<number, number>;
  /** Owned - sum(the split shown). */
  vault: number;
  /** The Vault row's 0 in red: every copy is in a stash. */
  vaultEmpty: boolean;
  /** The edit rows (the split shown). */
  rows: (printingLabel: string) => StashRow[];
  /** Lowest owned the stepper may reach: the larger of the saved and shown
   * stash totals (the server's floor is the saved one). */
  floor: number;
  /** A New stash create is on the wire. */
  busy: boolean;
  /** A split save is waiting or on the wire. */
  saving: boolean;
  /** Under the Name field (create). */
  nameError: string | null;
  /** Over the rows (edit): the last save failed and was rolled back. */
  saveError: string | null;
  /** A save for a printing no longer shown failed and was undone (shown in
   * the card's error line: desktop `notice`, phone Variants error). */
  notice: string | null;
  /** Stash copies / Edit: the form when there are no stashes yet, else the rows. */
  open: () => void;
  edit: () => void;
  inc: (stashId: number) => void;
  dec: (stashId: number) => void;
  newStash: () => void;
  cancelCreate: () => void;
  submitCreate: (name: string, description: string) => Promise<boolean>;
  clearNameError: () => void;
  /** Collapse the rows (Done, the phone sheet's X / scrim / drag): sends an
   * open save window now; never discards. */
  done: () => void;
}

function sum(m: Split): number {
  let n = 0;
  for (const q of Object.values(m)) n += q;
  return n;
}

function saveMessage(err: unknown, kept: boolean): string {
  if (err instanceof StashApiError && err.code === "exceeds_owned") return STASH_ERRORS.exceeds;
  if (err instanceof EmailNotVerifiedError) return STASH_ERRORS.verify;
  if (err instanceof SplitChangedError) return STASH_ERRORS.changed;
  return kept ? STASH_ERRORS.keptLater : STASH_ERRORS.saveFailed;
}

/** A failed save for a printing that is no longer shown (`kept`: clicks made
 * after it are still being saved). */
export function staleSaveMessage(label: string, kept = false): string {
  return kept
    ? `A stash change for ${label} was not saved; later changes were kept.`
    : `Stash changes for ${label} were not saved. They were undone.`;
}

export interface StashEditorOptions {
  /** The printing's name for a message about a save that failed after the
   * card moved on ("Standard SOR 005"). */
  label?: string;
}

/**
 * @param variantId the selected printing (null = none)
 * @param owned     the owned count the stepper SHOWS (optimistic)
 */
export function useStashEditor(
  variantId: number | null,
  owned: number,
  opts: StashEditorOptions = {}
): StashEditor {
  const data = useStashes();
  const [mode, setMode] = useState<StashMode>("read");
  const [returnTo, setReturnTo] = useState<"read" | "edit">("read");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Fold-in 1 (F1): every async Create continuation checks it is still the
  // same edit -- a printing change, Cancel or a new open bumps the
  // generation, and a late response then changes nothing on screen.
  const gen = useRef(0);

  // The split the user wants for this printing (any editor's clicks, from
  // any visit), and whether a save for it is waiting or on the wire.
  const desired = useSyncExternalStore(stashSaveStore.subscribe, () =>
    stashSaveStore.desired(variantId)
  );
  const saving = useSyncExternalStore(stashSaveStore.subscribe, () =>
    stashSaveStore.busy(variantId)
  );

  // The printing shown, its label, and the printings this editor changed
  // (a failure for one of them after the card moved on is said here).
  const shownRef = useRef(variantId);
  const labels = useRef(new Map<number, string>());
  useEffect(() => {
    shownRef.current = variantId;
    if (variantId != null) {
      stashSaveStore.setOwned(variantId, owned);
      if (opts.label) labels.current.set(variantId, opts.label);
    }
  });
  const touched = useRef(new Set<number>());
  useEffect(
    () =>
      stashSaveStore.onFailure((v, err, kept) => {
        if (v === shownRef.current) {
          setSaveError(saveMessage(err, kept));
          setMode((m) => (m === "read" ? "edit" : m));
        } else if (touched.current.has(v)) {
          setNotice(staleSaveMessage(labels.current.get(v) ?? "another printing", kept));
        }
      }),
    []
  );
  useEffect(
    () =>
      stashSaveStore.onSaved((v) => {
        if (v === shownRef.current) setSaveError(null);
      }),
    []
  );

  // A new printing (rail pick, card change) or unmount: queue the open
  // window for the old one now. Nothing is discarded.
  useEffect(() => () => stashSaveStore.flush(variantId), [variantId]);
  useEffect(() => {
    gen.current += 1;
  }, [variantId]);
  const [shownFor, setShownFor] = useState(variantId);
  if (shownFor !== variantId) {
    setShownFor(variantId);
    setMode("read");
    setReturnTo("read");
    setNameError(null);
    setSaveError(null);
  }

  const saved = variantId != null ? data.allocationsFor(variantId) : {};
  const savedTotal = sum(saved);
  const split = desired ?? saved;
  const splitTotal = sum(split);
  const available = data.enabled && data.ready && variantId != null && owned > 0;
  const pending = data.enabled && data.loading && variantId != null && owned > 0;

  // Losing availability mid-edit (sign-out, owned went to 0) ends the edit
  // and queues the open window at once. On a sign-out the auth may already
  // be gone by then: that save fails and the server keeps its split.
  useEffect(() => {
    if (available) return;
    if (mode !== "read") setMode("read");
    stashSaveStore.flush(variantId);
  }, [available, mode, variantId]);

  const holding = holdingOf(data.stashes, split);
  const vault = Math.max(0, owned - splitTotal);
  const rows = (printingLabel: string): StashRow[] =>
    data.stashes.map((s) => {
      const qty = split[s.id] ?? 0;
      return {
        stash: s,
        qty,
        canInc: vault > 0,
        canDec: qty > 0,
        incLabel: `Stash one in ${s.name}, ${printingLabel}`,
        decLabel: `Back to Vault from ${s.name}, ${printingLabel}`,
      };
    });
  // Includes intent still on its way (the store's desired split).
  const floor = Math.max(savedTotal, splitTotal);

  const step = (stashId: number, by: 1 | -1) => {
    if (variantId == null) return;
    setNotice(null);
    const changed = stashSaveStore.edit(variantId, saved, (d) => {
      const q = d[stashId] ?? 0;
      if (by > 0 && owned - sum(d) <= 0) return null;
      if (by < 0 && q <= 0) return null;
      return { ...d, [stashId]: q + by };
    });
    if (changed) touched.current.add(variantId);
  };

  const edit = () => {
    gen.current += 1;
    setMode("edit");
  };

  const open = () => {
    if (data.stashes.length === 0) {
      gen.current += 1;
      setReturnTo("read");
      setNameError(null);
      setMode("create");
    } else edit();
  };

  const newStash = useCallback(() => {
    setReturnTo("edit");
    setNameError(null);
    setMode("create");
  }, []);

  const cancelCreate = useCallback(() => {
    gen.current += 1;
    setNameError(null);
    setMode(returnTo);
  }, [returnTo]);

  const submitCreate = async (name: string, description: string) => {
    const n = name.trim();
    if (!n || busy) return false;
    setBusy(true);
    setNameError(null);
    const mine = gen.current;
    try {
      await data.create(n, description.trim() || null);
      // The printing changed, or the form was cancelled, meanwhile: the
      // stash exists (it is in the list) but this edit is gone.
      if (mine !== gen.current) return false;
      // Straight to edit mode with the new stash in the rows (at 0, so
      // nothing moves and nothing is saved).
      setMode("edit");
      return true;
    } catch (err) {
      if (mine !== gen.current) return false;
      setNameError(
        err instanceof StashApiError && err.code === "duplicate_name"
          ? STASH_ERRORS.duplicate
          : err instanceof StashApiError && err.code === "stash_limit"
            ? STASH_ERRORS.limit
            : err instanceof EmailNotVerifiedError
              ? STASH_ERRORS.verify
              : STASH_ERRORS.createFailed
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const done = () => {
    gen.current += 1;
    setSaveError(null);
    setMode("read");
    stashSaveStore.flush(variantId);
  };

  return {
    available,
    pending,
    mode: available ? mode : "read",
    returnTo,
    stashes: data.stashes,
    saved,
    holding,
    draft: split,
    vault,
    vaultEmpty: vault === 0,
    rows,
    floor,
    busy,
    saving,
    nameError,
    saveError,
    notice,
    open,
    edit,
    inc: (id: number) => step(id, 1),
    dec: (id: number) => step(id, -1),
    newStash,
    cancelCreate,
    submitCreate,
    clearNameError: () => setNameError(null),
    done,
  };
}
