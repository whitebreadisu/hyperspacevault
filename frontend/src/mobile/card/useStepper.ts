import { useCallback, useEffect, useRef, useState } from "react";
import { adjustCard, EmailNotVerifiedError } from "../../api/inventory";
import type { InventoryVariant } from "../../utils/inventory";

// BL-248 S2-05: the detail's stepper mutation -- desktop
// CardPopupInventory.tsx useInventoryMutation's semantics (BL-219): every
// tap moves the shown quantity at once (optimistic), taps on one printing
// batch into ONE adjustCard(variantId, delta) call 400 ms after the last tap,
// the server's returned quantity is authoritative (a hard cap may clamp it),
// a failure snaps back to the server value with desktop's message, and a
// pending batch flushes immediately when the screen goes away. The shared
// catalogue (useVaultData) takes the confirmed quantity through
// patchQuantity, so the Vault row under the detail shows it on return.

export const ADJUST_DEBOUNCE_MS = 400;
export const VERIFY_EMAIL_MESSAGE =
  "Verify your email to manage inventory -- see the banner above.";
export const GENERIC_ERROR = "Something went wrong.";

interface Book {
  serverQty: number;
  unflushed: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface Stepper {
  /** The quantity to show for a printing (optimistic while a batch is open). */
  qtyOf: (v: InventoryVariant) => number;
  increment: (v: InventoryVariant) => void;
  decrement: (v: InventoryVariant) => void;
  pending: boolean;
  error: string | null;
}

export function useStepper(patchQuantity: (variantId: number, quantity: number) => void): Stepper {
  const [shown, setShown] = useState<Record<number, number>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const book = useRef(new Map<number, Book>());
  const inFlight = useRef(0);
  const patchRef = useRef(patchQuantity);
  useEffect(() => {
    patchRef.current = patchQuantity;
  }, [patchQuantity]);
  const live = useRef(true);

  const show = useCallback((id: number, q: number | null) => {
    if (!live.current) return;
    setShown((prev) => {
      const next = { ...prev };
      if (q == null) delete next[id];
      else next[id] = q;
      return next;
    });
  }, []);

  const flush = useCallback(
    async (id: number) => {
      const e = book.current.get(id);
      if (!e || e.unflushed === 0) return;
      const delta = e.unflushed;
      e.unflushed = 0;
      inFlight.current += 1;
      if (live.current) {
        setPending(true);
        setError(null);
      }
      try {
        const r = await adjustCard(id, delta);
        e.serverQty = r.quantity;
        patchRef.current(id, r.quantity);
        // Nothing tapped since the call left: the shared map now carries it.
        show(id, e.unflushed === 0 ? null : e.serverQty + e.unflushed);
      } catch (err) {
        show(id, e.serverQty + e.unflushed);
        if (live.current)
          setError(err instanceof EmailNotVerifiedError ? VERIFY_EMAIL_MESSAGE : GENERIC_ERROR);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0 && live.current) setPending(false);
      }
    },
    [show]
  );

  const bump = useCallback(
    (v: InventoryVariant, delta: 1 | -1) => {
      const id = v.variant_id;
      let e = book.current.get(id);
      if (!e) {
        e = { serverQty: v.quantity, unflushed: 0, timer: null };
        book.current.set(id, e);
      }
      e.unflushed += delta;
      show(id, e.serverQty + e.unflushed);
      if (e.timer !== null) clearTimeout(e.timer);
      const entry = e;
      e.timer = setTimeout(() => {
        entry.timer = null;
        void flush(id);
      }, ADJUST_DEBOUNCE_MS);
    },
    [show, flush]
  );

  // Leaving the screen flushes every open batch at once (desktop flushNow).
  useEffect(() => {
    live.current = true;
    const b = book.current;
    return () => {
      live.current = false;
      for (const [id, e] of b) {
        if (e.timer !== null) {
          clearTimeout(e.timer);
          e.timer = null;
          void flush(id);
        }
      }
    };
  }, [flush]);

  return {
    qtyOf: (v) => shown[v.variant_id] ?? v.quantity,
    increment: (v) => bump(v, 1),
    decrement: (v) => bump(v, -1),
    pending,
    error,
  };
}
