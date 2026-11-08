import { useCallback, useRef, useState } from "react";
import { EmailNotVerifiedError } from "../api/inventory";
import { StashApiError } from "../api/stashes";
import type { Stash } from "../api/stashes";
import { useStashes } from "./StashContext";
import { DESCRIPTION_MAX, NAME_MAX } from "./useStashEditor";

// Creating, renaming / redescribing and deleting a stash from the Stashes
// page (desktop 1b B2 / E1-E3, phone 1d A2 and the create / delete sheets).
// A duplicate name is an inline error on the name field ("You already have a
// stash named Trade stash." + "Pick another name."); Save / Create stay
// aria-disabled until the name is changed. Deleting returns the stash's
// copies to the Vault (owned unchanged).

export { DESCRIPTION_MAX, NAME_MAX };

export interface MetaError {
  /** The name field carries it (duplicate name). */
  field: "name" | null;
  what: string;
  hint: string;
  /** The name that was refused (Save stays off until it changes). */
  refused?: string;
}

export const META_ERRORS = {
  duplicate: (name: string) => `You already have a stash named ${name}.`,
  duplicateHint: "Pick another name.",
  limit: "You have 50 stashes, the most allowed.",
  limitHint: "Use one you already have.",
  verify: "Verify your email to manage stashes.",
  verifyHint: "See the banner above.",
  failed: "The stash was not saved.",
  failedHint: "Try again.",
  deleteFailed: "The stash was not deleted.",
} as const;

function toError(err: unknown, name: string, deleting = false): MetaError {
  if (err instanceof StashApiError && err.code === "duplicate_name")
    return {
      field: "name",
      what: META_ERRORS.duplicate(name.trim()),
      hint: META_ERRORS.duplicateHint,
      refused: name.trim().toLowerCase(),
    };
  if (err instanceof StashApiError && err.code === "stash_limit")
    return { field: null, what: META_ERRORS.limit, hint: META_ERRORS.limitHint };
  if (err instanceof EmailNotVerifiedError)
    return { field: null, what: META_ERRORS.verify, hint: META_ERRORS.verifyHint };
  return {
    field: null,
    what: deleting ? META_ERRORS.deleteFailed : META_ERRORS.failed,
    hint: META_ERRORS.failedHint,
  };
}

/** A name another stash of the caller's already has (case-insensitive,
 * trimmed), checked before the request; the server's 409 is the backstop. */
export function nameTaken(stashes: Stash[], name: string, exceptId: number | null): boolean {
  const n = name.trim().toLowerCase();
  return stashes.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === n);
}

export interface StashMeta {
  busy: boolean;
  error: MetaError | null;
  clearError: () => void;
  /** Whether Save / Create may run for this name (non-empty, not the refused one). */
  canSubmit: (name: string) => boolean;
  create: (name: string, description: string) => Promise<Stash | null>;
  save: (id: number, name: string, description: string) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

export function useStashMeta(): StashMeta {
  const ctx = useStashes();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MetaError | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(async <T>(fn: () => Promise<T>, onErr: (e: unknown) => MetaError) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      return { value: await fn() };
    } catch (err) {
      setError(onErr(err));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const duplicate = useCallback(
    (name: string, exceptId: number | null) => {
      if (!nameTaken(ctx.stashes, name, exceptId)) return false;
      setError({
        field: "name",
        what: META_ERRORS.duplicate(name.trim()),
        hint: META_ERRORS.duplicateHint,
        refused: name.trim().toLowerCase(),
      });
      return true;
    },
    [ctx.stashes]
  );

  return {
    busy,
    error,
    clearError: useCallback(() => setError(null), []),
    canSubmit: (name: string) =>
      !busy &&
      name.trim().length > 0 &&
      !(error?.refused != null && error.refused === name.trim().toLowerCase()),
    create: useCallback(
      async (name: string, description: string) => {
        if (duplicate(name, null)) return null;
        const r = await run(
          () => ctx.create(name.trim(), description.trim() || null),
          (e) => toError(e, name)
        );
        return r ? r.value : null;
      },
      [ctx, run, duplicate]
    ),
    save: useCallback(
      async (id: number, name: string, description: string) => {
        if (duplicate(name, id)) return false;
        const r = await run(
          () => ctx.update(id, { name: name.trim(), description: description.trim() || null }),
          (e) => toError(e, name)
        );
        return r != null;
      },
      [ctx, run, duplicate]
    ),
    remove: useCallback(
      async (id: number) => {
        const r = await run(
          () => ctx.remove(id),
          (e) => toError(e, "", true)
        );
        return r != null;
      },
      [ctx, run]
    ),
  };
}
