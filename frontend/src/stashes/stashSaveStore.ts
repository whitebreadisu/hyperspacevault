import { putVariantAllocations, SplitChangedError } from "../api/stashes";
import type { VariantAllocationResult } from "../api/stashes";
import { settleOwned } from "../utils/ownedSettle";

// The card detail's stash saves, outside React: one store per app. Per
// printing it holds `confirmed` (the split the server last reported) and
// `desired` (the latest split the user clicked). Every card view reads
// `desired` (else the server split), so any editor, a remount, a printing
// switched away and back, or a reopened card shows the same truth, and the
// owned stepper's floor includes intent still on its way.
//
// One serial queue carries every stash PUT in the app: only one is ever on
// the wire. A job for a printing first sends that printing's open owned
// batches and waits for its owned requests (utils/ownedSettle.ts), then
// snapshots `desired` and sends it with `expected = confirmed`: if the
// stored split changed meanwhile (a Stashes-page return or restore, an
// import, another device), the server writes nothing and answers 409
// `split_changed` with the stored split. The job then rebases the user's
// clicks onto it (server + (desired - old confirmed), per stash, >= 0, within
// owned; the user's own increments give way first) and tries once more; a
// second conflict rolls back. Clicks wait 400
// ms per printing before their job is queued; Done, closing the card, a
// printing switch, unmount and losing availability queue it at once. A job
// (owned wait, PUT and retry together) that takes longer than
// STASH_SAVE_TIMEOUT_MS fails.
//
// A failed save sets `desired` back to `confirmed` plus the clicks made
// after the job's snapshot, within the printing's owned count, and tells the
// mounted card views (`onFailure`). A different user (setUser) drops every
// entry and open window; a queued job whose user or store generation is no
// longer current is dropped without a request.

export type Split = Record<number, number>;

/** The click-to-save window, the owned stepper's (ADJUST_DEBOUNCE_MS). */
export const STASH_SAVE_DEBOUNCE_MS = 400;
/** A whole save job (owned wait, PUT, retry) fails after this long. */
export const STASH_SAVE_TIMEOUT_MS = 15_000;

interface Entry {
  variantId: number;
  epoch: number;
  uid: string | null;
  confirmed: Split;
  desired: Split;
  timer: ReturnType<typeof setTimeout> | null;
  queued: boolean;
  inFlight: boolean;
}

type Listener = () => void;
type SavedListener = (variantId: number, result: VariantAllocationResult) => void;
/** `kept`: clicks made after the failed save are still wanted. */
type FailureListener = (variantId: number, error: unknown, kept: boolean) => void;

interface State {
  epoch: number;
  uid: string | null;
  uidSource: (() => string | null) | null;
  entries: Map<number, Entry>;
  owned: Map<number, number>;
  queue: Entry[];
  pumping: boolean;
  pumpGen: number;
  timeoutMs: number;
  listeners: Set<Listener>;
  savedListeners: Set<SavedListener>;
  failureListeners: Set<FailureListener>;
}

function freshState(): State {
  return {
    epoch: 0,
    uid: null,
    uidSource: null,
    entries: new Map(),
    owned: new Map(),
    queue: [],
    pumping: false,
    pumpGen: 0,
    timeoutMs: STASH_SAVE_TIMEOUT_MS,
    listeners: new Set(),
    savedListeners: new Set(),
    failureListeners: new Set(),
  };
}

// Dev hot reload hands the same state (queue, worker flag, entries) to the
// new module, so a replaced module never starts a second worker.
const hot = import.meta.hot;
const st: State = (hot?.data?.stashSaveState as State | undefined) ?? freshState();
hot?.dispose?.((data) => {
  data.stashSaveState = st;
});

function sum(m: Split): number {
  let n = 0;
  for (const q of Object.values(m)) n += q;
  return n;
}

export function sameSplit(a: Split, b: Split): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[Number(k)] ?? 0) !== (b[Number(k)] ?? 0)) return false;
  return true;
}

/** A split cut down to `cap` copies, taking from the highest stash id first
 * (the newest stashes, as an import's cuts do). */
export function clampSplit(split: Split, cap: number): Split {
  const out: Split = {};
  for (const [k, q] of Object.entries(split)) if (q > 0) out[Number(k)] = q;
  let over = sum(out) - Math.max(0, cap);
  for (const id of Object.keys(out)
    .map(Number)
    .sort((a, b) => b - a)) {
    if (over <= 0) break;
    const take = Math.min(out[id], over);
    out[id] -= take;
    over -= take;
    if (out[id] === 0) delete out[id];
  }
  return out;
}

function currentUid(): string | null {
  return st.uidSource ? st.uidSource() : st.uid;
}

/** Call each listener on its own: one that throws never turns a save into a
 * failure or stops the queue. */
function each<T extends unknown[]>(set: Set<(...args: T) => void>, ...args: T) {
  for (const l of [...set]) {
    try {
      l(...args);
    } catch (err) {
      console.error("Stash save listener failed:", err);
    }
  }
}

function notify() {
  each(st.listeners);
}

function busy(e: Entry): boolean {
  return e.timer !== null || e.queued || e.inFlight;
}

/** Drop a settled entry: views fall back to the server split. */
function maybeDrop(e: Entry) {
  if (busy(e) || !sameSplit(e.desired, e.confirmed)) return;
  if (st.entries.get(e.variantId) === e) st.entries.delete(e.variantId);
}

function enqueue(e: Entry) {
  if (e.timer !== null) {
    clearTimeout(e.timer);
    e.timer = null;
  }
  if (!e.queued) {
    e.queued = true;
    st.queue.push(e);
  }
  notify();
  void pump();
}

/** The one worker: a single job at a time, in queue order. */
async function pump() {
  if (st.pumping) return;
  st.pumping = true;
  const gen = st.pumpGen;
  try {
    while (st.queue.length) {
      const e = st.queue.shift()!;
      await send(e);
      if (gen !== st.pumpGen) return;
    }
  } finally {
    if (gen === st.pumpGen) st.pumping = false;
  }
}

class StashSaveTimeout extends Error {
  constructor() {
    super("Stash save timed out");
    this.name = "StashSaveTimeout";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout?.();
      reject(new StashSaveTimeout());
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

function toBody(split: Split) {
  return Object.entries(split)
    .map(([id, q]) => ({ stash_id: Number(id), quantity: q }))
    .filter((a) => a.quantity > 0);
}

function splitOf(result: VariantAllocationResult): Split {
  const out: Split = {};
  for (const a of result.allocations) if (a.quantity > 0) out[a.stash_id] = a.quantity;
  return out;
}

/** The user's clicks (desired - base) on top of `onto`, per stash, >= 0,
 * within `cap`. Over `cap`, the user's own increments give way first (newest
 * stash first), so the stored split -- e.g. another device's write that a
 * 409 just reported -- is cut only if it alone exceeds the cap. */
function rebase(desired: Split, base: Split, onto: Split, cap: number): Split {
  const out: Split = {};
  const added: Split = {};
  for (const k of new Set([...Object.keys(desired), ...Object.keys(base), ...Object.keys(onto)])) {
    const id = Number(k);
    const delta = (desired[id] ?? 0) - (base[id] ?? 0);
    const q = Math.max(0, (onto[id] ?? 0) + delta);
    if (q > 0) out[id] = q;
    if (delta > 0 && q > 0) added[id] = Math.min(delta, q);
  }
  let over = sum(out) - Math.max(0, cap);
  for (const id of Object.keys(added)
    .map(Number)
    .sort((a, b) => b - a)) {
    if (over <= 0) break;
    const take = Math.min(added[id], over);
    out[id] -= take;
    over -= take;
    if (out[id] === 0) delete out[id];
  }
  return clampSplit(out, cap);
}

async function send(e: Entry) {
  e.queued = false;
  // A job from another user or an earlier store generation goes nowhere.
  if (e.epoch !== st.epoch || e.uid !== currentUid()) {
    notify();
    return;
  }
  if (sameSplit(e.desired, e.confirmed)) {
    maybeDrop(e);
    notify();
    return;
  }
  e.inFlight = true;
  notify();
  let sent: Split | null = null;
  // One deadline for the whole job: the owned wait, the PUT and its retry.
  const deadline = Date.now() + st.timeoutMs;
  const left = () => Math.max(0, deadline - Date.now());
  try {
    await withTimeout(settleOwned(e.variantId), left());
    for (let attempt = 0; ; attempt++) {
      // Before EACH request, with no await between this check and the
      // fetch: a job (or its 409 retry) never goes out under another user.
      if (e.epoch !== st.epoch || e.uid !== currentUid()) return;
      // The snapshot is taken now: clicks made while owned requests were
      // still out are in it.
      sent = { ...e.desired };
      if (sameSplit(sent, e.confirmed)) return;
      const abort = new AbortController();
      try {
        const result = await withTimeout(
          putVariantAllocations(e.variantId, toBody(sent), {
            expected: toBody(e.confirmed),
            signal: abort.signal,
          }),
          left(),
          () => abort.abort()
        );
        e.confirmed = splitOf(result);
        if (e.epoch === st.epoch) each(st.savedListeners, e.variantId, result);
        return;
      } catch (err) {
        if (!(err instanceof SplitChangedError)) throw err;
        // The stored split changed under us: take it as confirmed. The first
        // time, keep the user's clicks on top of it and try once more; the
        // second time, fail (the rollback below lands on the stored split).
        const server = splitOf(err.current);
        if (e.epoch === st.epoch) each(st.savedListeners, e.variantId, err.current);
        if (attempt >= 1) {
          e.confirmed = server;
          throw err;
        }
        const cap = Math.min(err.current.owned, st.owned.get(e.variantId) ?? Infinity);
        e.desired = rebase(e.desired, e.confirmed, server, cap);
        e.confirmed = server;
        notify();
      }
    }
  } catch (err) {
    console.error("Failed to save stash split:", err);
    // Back to the server's split, keeping the clicks made after this job's
    // snapshot, within what the printing owns now.
    const cap = st.owned.get(e.variantId) ?? Infinity;
    e.desired = sent ? rebase(e.desired, sent, e.confirmed, cap) : clampSplit(e.confirmed, cap);
    const kept = !sameSplit(e.desired, e.confirmed);
    if (e.epoch === st.epoch) each(st.failureListeners, e.variantId, err, kept);
  } finally {
    e.inFlight = false;
    maybeDrop(e);
    notify();
  }
}

export const stashSaveStore = {
  subscribe(listener: Listener): () => void {
    st.listeners.add(listener);
    return () => st.listeners.delete(listener);
  },
  /** The split the user wants for a printing, while it differs from or is
   * not yet confirmed by the server (else undefined: show the server's). */
  desired(variantId: number | null): Split | undefined {
    return variantId == null ? undefined : st.entries.get(variantId)?.desired;
  },
  /** Copies of a printing in stashes as the user wants them (or undefined). */
  desiredTotal(variantId: number): number | undefined {
    const d = st.entries.get(variantId)?.desired;
    return d ? sum(d) : undefined;
  },
  /** A save for the printing is waiting or on the wire. */
  busy(variantId: number | null): boolean {
    const e = variantId == null ? undefined : st.entries.get(variantId);
    return !!e && busy(e);
  },
  /** The printing's owned count as last shown (the rollback's ceiling). */
  setOwned(variantId: number, count: number) {
    st.owned.set(variantId, count);
  },
  /** Where the signed-in user's id is read when a job is queued and sent
   * (App: the Firebase current user). Without one, the last setUser. */
  setUidSource(source: (() => string | null) | null) {
    st.uidSource = source;
  },
  /** The signed-in user (App, on every auth change). A different user drops
   * every entry and open window -- they are the previous user's. */
  setUser(uid: string | null) {
    if (uid === st.uid) return;
    st.uid = uid;
    for (const e of st.entries.values())
      if (e.timer !== null) {
        clearTimeout(e.timer);
        e.timer = null;
      }
    st.entries = new Map();
    st.owned.clear();
    st.epoch += 1;
    notify();
  },
  /** One click: `change` maps the current desired split to the next one
   * (null = no change). `server` seeds a printing with no entry. */
  edit(variantId: number, server: Split, change: (desired: Split) => Split | null): boolean {
    let e = st.entries.get(variantId);
    const base = e ? e.desired : server;
    const next = change(base);
    if (!next) return false;
    if (!e) {
      e = {
        variantId,
        epoch: st.epoch,
        uid: currentUid(),
        confirmed: { ...server },
        desired: next,
        timer: null,
        queued: false,
        inFlight: false,
      };
      st.entries.set(variantId, e);
    } else e.desired = next;
    if (e.timer !== null) clearTimeout(e.timer);
    const entry = e;
    e.timer = setTimeout(() => {
      entry.timer = null;
      enqueue(entry);
    }, STASH_SAVE_DEBOUNCE_MS);
    notify();
    return true;
  },
  /** Queue a printing's open window now (Done, close, switch, unmount). */
  flush(variantId: number | null) {
    if (variantId == null) return;
    const e = st.entries.get(variantId);
    if (e && e.timer !== null) enqueue(e);
  },
  onSaved(listener: SavedListener): () => void {
    st.savedListeners.add(listener);
    return () => st.savedListeners.delete(listener);
  },
  onFailure(listener: FailureListener): () => void {
    st.failureListeners.add(listener);
    return () => st.failureListeners.delete(listener);
  },
};

/** Tests only: drop everything, including a job stuck on a promise that
 * never settles; `timeoutMs` shortens the save timeout. */
export function resetStashSaveStoreForTests(opts: { timeoutMs?: number } = {}) {
  for (const e of st.entries.values()) if (e.timer !== null) clearTimeout(e.timer);
  st.entries = new Map();
  st.owned.clear();
  st.queue = [];
  st.epoch += 1;
  st.uid = null;
  st.uidSource = null;
  st.pumpGen += 1;
  st.pumping = false;
  st.timeoutMs = opts.timeoutMs ?? STASH_SAVE_TIMEOUT_MS;
  notify();
}
