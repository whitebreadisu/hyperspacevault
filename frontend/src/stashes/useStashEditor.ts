import { useCallback, useEffect, useRef, useState } from "react";
import { EmailNotVerifiedError } from "../api/inventory";
import { StashApiError } from "../api/stashes";
import type { Stash } from "../api/stashes";
import { useStashes } from "./StashContext";

// The card detail's stash editing state (handoff README "State"),
// shared by desktop 1a (the popup's inventory panel) and phone 1e (the stash
// sheet). Per selected printing:
//   mode    'read' (a1/b1 label or c1 list), 'edit' (b2/c2/d1/d2/e1 rows),
//           'create' (a2 New stash form);
//   draft   stash_id -> quantity, staged until Done; Cancel throws it away;
//   returnTo where Create / Cancel in the form goes back to.
// Vault = owned - sum(draft), never below 0: `+` is offered only while the
// Vault holds a copy, `-` only while the stash does. Done sends one
// PUT /stashes/variants/{id}. Changing the printing (or the card) discards
// the draft, as Cancel does.

export type StashMode = "read" | "edit" | "create";

/** Decrease floor (owner, 2026-11-07): owned can never go below the
 * printing's stashed total; the owned `-` says so (title on desktop, the
 * accessible name on both). The server clamps there too. */
export const STASH_FLOOR_HINT = "All copies are stashed. Remove from a stash first.";

export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 280;

export const STASH_ERRORS = {
  duplicate: "You already have a stash with this name. Choose another name.",
  limit: "You have 50 stashes, the most allowed. Use one you already have.",
  createFailed: "The stash was not created. Try again.",
  exceeds: "These stashes hold more copies than you own. Take some out, then press Done.",
  saveFailed: "Stashes were not saved. Try again.",
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
  /** Stashes holding this printing, creation order (the read-only list). */
  holding: { stash: Stash; qty: number }[];
  /** The staged split while editing. */
  draft: Record<number, number>;
  /** Owned - sum(draft) while editing, owned - sum(saved) otherwise. */
  vault: number;
  /** The Vault row's 0 in red: every copy is in a stash. */
  vaultEmpty: boolean;
  /** The edit rows (the staged split while editing, else the saved one). */
  rows: (printingLabel: string) => StashRow[];
  /** Lowest owned the stepper may reach: the larger of the saved and staged
   * stash totals (the server's floor is the saved one). */
  floor: number;
  busy: boolean;
  /** Under the Name field (create). */
  nameError: string | null;
  /** Over the Done footer (edit). */
  saveError: string | null;
  /** Stash copies / Edit: the form when there are no stashes yet, else the rows. */
  open: () => void;
  edit: () => void;
  inc: (stashId: number) => void;
  dec: (stashId: number) => void;
  newStash: () => void;
  cancelCreate: () => void;
  submitCreate: (name: string, description: string) => Promise<boolean>;
  clearNameError: () => void;
  done: () => Promise<boolean>;
  cancel: () => void;
}

function sum(m: Record<number, number>): number {
  let n = 0;
  for (const q of Object.values(m)) n += q;
  return n;
}

function sameSplit(a: Record<number, number>, b: Record<number, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[Number(k)] ?? 0) !== (b[Number(k)] ?? 0)) return false;
  return true;
}

/**
 * @param variantId the selected printing (null = none)
 * @param owned     the owned count the stepper SHOWS (optimistic)
 * @param beforeCommit settles any open owned-stepper batch for this printing
 *                  before Done writes the split (so the server compares the
 *                  split against the owned count the user sees)
 */
export function useStashEditor(
  variantId: number | null,
  owned: number,
  beforeCommit?: () => Promise<void>
): StashEditor {
  const data = useStashes();
  const [mode, setMode] = useState<StashMode>("read");
  const [returnTo, setReturnTo] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Fold-in 1 (F1): every async continuation (Create, Done) checks it is
  // still the same edit -- a printing change, Cancel or a new open bumps the
  // generation, and a late response then changes nothing on screen.
  const gen = useRef(0);
  useEffect(() => {
    gen.current += 1;
  }, [variantId]);

  // A new printing (rail pick, card change) discards the draft.
  const [shownFor, setShownFor] = useState(variantId);
  if (shownFor !== variantId) {
    setShownFor(variantId);
    setMode("read");
    setReturnTo("read");
    setDraft({});
    setNameError(null);
    setSaveError(null);
  }

  const saved = variantId != null ? data.allocationsFor(variantId) : {};
  const savedTotal = sum(saved);
  const draftTotal = sum(draft);
  const editing = mode !== "read";
  const available = data.enabled && data.ready && variantId != null && owned > 0;
  const pending = data.enabled && data.loading && variantId != null && owned > 0;

  // Losing availability mid-edit (sign-out, owned went to 0) ends the edit.
  useEffect(() => {
    if (!available && mode !== "read") {
      setMode("read");
      setDraft({});
    }
  }, [available, mode]);

  const holding = holdingOf(data.stashes, saved);

  const vault = Math.max(0, owned - (editing ? draftTotal : savedTotal));
  const split = mode === "edit" ? draft : saved;
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
  const floor = Math.max(savedTotal, editing ? draftTotal : 0);

  const edit = useCallback(() => {
    gen.current += 1;
    setDraft({ ...saved });
    setSaveError(null);
    setMode("edit");
    // `saved` is derived per render; the click reads the current one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId, data]);

  const open = useCallback(() => {
    if (data.stashes.length === 0) {
      gen.current += 1;
      setReturnTo("read");
      setNameError(null);
      setMode("create");
    } else edit();
  }, [data.stashes.length, edit]);

  const inc = useCallback(
    (stashId: number) => {
      setDraft((d) => {
        if (owned - sum(d) <= 0) return d;
        return { ...d, [stashId]: (d[stashId] ?? 0) + 1 };
      });
    },
    [owned]
  );

  const dec = useCallback((stashId: number) => {
    setDraft((d) => {
      const q = d[stashId] ?? 0;
      if (q <= 0) return d;
      return { ...d, [stashId]: q - 1 };
    });
  }, []);

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

  const submitCreate = useCallback(
    async (name: string, description: string) => {
      const n = name.trim();
      if (!n || busy) return false;
      setBusy(true);
      setNameError(null);
      const mine = gen.current;
      try {
        const s = await data.create(n, description.trim() || null);
        // The printing changed, or the form was cancelled, meanwhile: the
        // stash exists (it is in the list) but this edit is gone.
        if (mine !== gen.current) return false;
        // Straight to edit mode with the new stash in the rows; nothing moves.
        setDraft((d) => (returnTo === "edit" ? { ...d, [s.id]: 0 } : { ...saved, [s.id]: 0 }));
        setSaveError(null);
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, data, returnTo, variantId]
  );

  const cancel = useCallback(() => {
    gen.current += 1;
    setDraft({});
    setSaveError(null);
    setMode("read");
  }, []);

  const done = useCallback(async () => {
    if (variantId == null || busy) return false;
    if (sameSplit(draft, saved)) {
      cancel();
      return true;
    }
    setBusy(true);
    setSaveError(null);
    const mine = gen.current;
    try {
      await beforeCommit?.();
      // The printing changed (or the edit was cancelled) while the owned
      // batch settled: this split is not the one on screen any more.
      if (mine !== gen.current) return false;
      await data.saveVariant(variantId, draft);
      if (mine !== gen.current) return false;
      setDraft({});
      setMode("read");
      return true;
    } catch (err) {
      if (mine !== gen.current) return false;
      setSaveError(
        err instanceof StashApiError && err.code === "exceeds_owned"
          ? STASH_ERRORS.exceeds
          : err instanceof EmailNotVerifiedError
            ? STASH_ERRORS.verify
            : STASH_ERRORS.saveFailed
      );
      return false;
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId, busy, draft, data, beforeCommit, cancel]);

  return {
    available,
    pending,
    mode: available ? mode : "read",
    returnTo,
    stashes: data.stashes,
    saved,
    holding,
    draft,
    vault,
    vaultEmpty: vault === 0,
    rows,
    floor,
    busy,
    nameError,
    saveError,
    open,
    edit,
    inc,
    dec,
    newStash,
    cancelCreate,
    submitCreate,
    clearNameError: () => setNameError(null),
    done,
    cancel,
  };
}
