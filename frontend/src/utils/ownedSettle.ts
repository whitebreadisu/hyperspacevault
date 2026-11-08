// Owned-count requests per printing, outside React, so a stash save for a
// printing can first make the server's owned count match what the user saw
// (stashes/stashSaveStore.ts). Both owned steppers (desktop
// CardPopupInventory useInventoryMutation, phone useStepper) register:
//   - a flusher: sends that stepper's open (debounced) batch for a printing
//     now, if it has one;
//   - every owned request they put on the wire, per printing -- a set, never
//     overwritten, so two overlapping requests are both awaited.

type Flusher = (variantId: number) => void;

const flushers = new Set<Flusher>();
const inFlight = new Map<number, Set<Promise<unknown>>>();

/** A stepper's "send your open batch for this printing now". */
export function registerOwnedFlusher(flush: Flusher): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

/** An owned request on the wire for a printing (removed once it settles). */
export function trackOwnedRequest<T>(variantId: number, request: Promise<T>): Promise<T> {
  let set = inFlight.get(variantId);
  if (!set) {
    set = new Set();
    inFlight.set(variantId, set);
  }
  const s = set;
  // A test double may hand back a non-promise: track its settled form.
  const p: Promise<unknown> = Promise.resolve(request);
  s.add(p);
  const done = () => {
    s.delete(p);
    if (s.size === 0 && inFlight.get(variantId) === s) inFlight.delete(variantId);
  };
  p.then(done, done);
  return request;
}

/** Send every open owned batch for a printing and wait until no owned
 * request for it is on the wire (failures included: the stash save then
 * meets the server's own count). */
export async function settleOwned(variantId: number): Promise<void> {
  for (const f of [...flushers]) f(variantId);
  for (;;) {
    const set = inFlight.get(variantId);
    if (!set || set.size === 0) return;
    await Promise.allSettled([...set]);
  }
}

/** Tests only. */
export function resetOwnedSettleForTests() {
  flushers.clear();
  inFlight.clear();
}
