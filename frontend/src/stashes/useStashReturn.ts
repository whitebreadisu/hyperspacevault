import { useCallback, useEffect, useRef, useState } from "react";
import { EmailNotVerifiedError } from "../api/inventory";
import { StashApiError } from "../api/stashes";
import type { StashMove } from "../api/stashes";
import { useStashes } from "./StashContext";
import { returnSentence } from "./stashContents";
import type { StashPrinting } from "./stashContents";

// Taking copies out of a stash (Stashes page, desktop 1b and phone 1d). A
// return is written at once (POST .../return); the feedback line and its
// Undo (POST .../restore with exactly what was returned) stay until the user
// leaves the stash or makes another return, which replaces them. Every write
// refreshes the stash context (StashContext) so the card detail, the nav
// menus and this page agree. No toast, no confirm.

export const RETURN_ERRORS = {
  exceedsStash: "The stash holds fewer copies than that.",
  exceedsStashHint: "The list now shows what it holds.",
  exceedsOwned: "Your Vault no longer holds those copies.",
  exceedsOwnedHint: "They stay in your Vault.",
  failed: "The copies were not moved.",
  failedHint: "Try again.",
  verify: "Verify your email to manage stashes.",
  verifyHint: "See the banner above.",
} as const;

export interface ReturnError {
  what: string;
  hint: string;
}

export interface LastReturn {
  stashId: number;
  items: StashMove[];
  /** The copies returned (the Copies panel's "N back in Vault"). */
  copies: number;
  /** "1 Luke Skywalker · Standard is back in your Vault." */
  text: string;
}

export interface StashReturn {
  last: LastReturn | null;
  error: ReturnError | null;
  busy: boolean;
  /** Return `quantity` copies of each row (the − returns one, the trash
   * all of the printing; several rows go in one request). */
  returnRows: (rows: { row: StashPrinting; quantity: number }[]) => Promise<boolean>;
  undo: () => Promise<boolean>;
}

function toError(err: unknown, exceeds: "stash" | "owned"): ReturnError {
  if (err instanceof EmailNotVerifiedError)
    return { what: RETURN_ERRORS.verify, hint: RETURN_ERRORS.verifyHint };
  if (err instanceof StashApiError && err.code === "exceeds_stash" && exceeds === "stash")
    return { what: RETURN_ERRORS.exceedsStash, hint: RETURN_ERRORS.exceedsStashHint };
  if (err instanceof StashApiError && err.code === "exceeds_owned" && exceeds === "owned")
    return { what: RETURN_ERRORS.exceedsOwned, hint: RETURN_ERRORS.exceedsOwnedHint };
  return { what: RETURN_ERRORS.failed, hint: RETURN_ERRORS.failedHint };
}

export function useStashReturn(stashId: number | null): StashReturn {
  const ctx = useStashes();
  const [last, setLast] = useState<LastReturn | null>(null);
  const [error, setError] = useState<ReturnError | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Leaving the stash (another one, or none) drops the line and its Undo.
  const [seen, setSeen] = useState(stashId);
  if (seen !== stashId) {
    setSeen(stashId);
    setLast(null);
    setError(null);
  }
  const live = useRef(stashId);
  useEffect(() => {
    live.current = stashId;
  }, [stashId]);

  const returnRows = useCallback(
    async (rows: { row: StashPrinting; quantity: number }[]) => {
      const picked = rows.filter((r) => r.quantity > 0);
      if (stashId == null || picked.length === 0 || busyRef.current) return false;
      const items = picked.map((r) => ({
        variant_id: r.row.variant.variant_id,
        quantity: r.quantity,
      }));
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await ctx.returnItems(stashId, items);
        if (live.current !== stashId) return true;
        setLast({
          stashId,
          items,
          copies: items.reduce((n, i) => n + i.quantity, 0),
          text: returnSentence(picked),
        });
        return true;
      } catch (err) {
        if (live.current !== stashId) return false;
        setError(toError(err, "stash"));
        // The server's count wins: re-read so the rows show what it holds.
        if (err instanceof StashApiError) await ctx.retry();
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [ctx, stashId]
  );

  const undo = useCallback(async () => {
    if (!last || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await ctx.restoreItems(last.stashId, last.items);
      setLast(null);
      return true;
    } catch (err) {
      setError(toError(err, "owned"));
      if (err instanceof StashApiError) {
        // Nothing was written; the Undo cannot apply any more.
        setLast(null);
        await ctx.retry();
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [ctx, last]);

  return {
    last,
    error,
    busy,
    returnRows,
    undo,
  };
}
