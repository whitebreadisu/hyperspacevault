import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  createStash,
  deleteStash,
  getStashes,
  getStashItems,
  putVariantAllocations,
  restoreStashItems,
  returnStashItems,
  updateStash,
} from "../api/stashes";
import type { Stash, StashItem, StashMove, StashMoveResult } from "../api/stashes";

// The stash data source: the caller's stash list and the sparse
// (stash, printing) quantities, for the card detail's stash UI, the owned
// stepper's decrease floor and the export note. Own vault only:
//   - `enabled` is true only for a signed-in user looking at their OWN vault.
//     Desktop App passes `!!user && view !== "shared"`; the phone passes
//     `!!user && !inShare`; the shared vault's own scopes mount a disabled
//     provider, so nothing under a share can ever read or fetch stash data.
//   - Disabled = nothing fetched, an empty list, `ready` false; turning off
//     drops what was held (a sign-out never leaves names on screen).
//   - `paused` (the signed-in user is looking at a share): nothing fetched
//     and nothing exposed, but what was loaded is kept, so returning to the
//     own vault needs no refetch (fold-in 1, F6).
//   - No provider at all reads as disabled (tests and the public card page).
// Refreshed after a Done commit (saveVariant), after an import commit
// (refresh, called by both import screens) and after every Stashes-page
// write (returnItems, restoreItems, update, remove), so the card detail, the
// nav menus and the Stashes page agree. A return / restore applies the
// response (the stash's remaining quantities and new total) at once, before
// the re-read. A failed first read sets `failed`; a failed re-read after a
// write sets `stale`; both are cleared by `retry`, which the pages offer.

export interface StashData {
  /** Signed in, own vault. */
  enabled: boolean;
  /** The first fetch has landed (stash UI waits for it). */
  ready: boolean;
  /** The first fetch is still in flight (it has neither landed nor failed):
   * the phone region holds the stash entry's room meanwhile. */
  loading: boolean;
  stashes: Stash[];
  /** stash_id -> quantity for one printing (non-zero only). */
  allocationsFor: (variantId: number) => Record<number, number>;
  /** Copies of one printing held in stashes. */
  stashedTotal: (variantId: number) => number;
  refresh: () => Promise<void>;
  /** The first read failed (nothing loaded): the pages offer `retry`. */
  failed: boolean;
  /** A re-read after a write failed: what shows may be behind the server. */
  stale: boolean;
  /** Re-read; never throws (sets `failed` / `stale` instead). */
  retry: () => Promise<void>;
  /** POST a new empty stash and append it to the list. */
  create: (name: string, description: string | null) => Promise<Stash>;
  /** PUT the printing's full split, then refresh. */
  saveVariant: (variantId: number, allocations: Record<number, number>) => Promise<void>;
  /** One stash's non-zero printings, as `{variant_id, quantity}`. */
  itemsOf: (stashId: number) => StashMove[];
  /** POST .../return (copies back to the Vault), then refresh. */
  returnItems: (stashId: number, items: StashMove[]) => Promise<void>;
  /** POST .../restore (the Undo of a return), then refresh. */
  restoreItems: (stashId: number, items: StashMove[]) => Promise<void>;
  /** PATCH a stash's name / description, then refresh. */
  update: (stashId: number, patch: { name?: string; description?: string | null }) => Promise<void>;
  /** DELETE a stash (its copies return to the Vault), then refresh. */
  remove: (stashId: number) => Promise<void>;
}

const unavailable = async () => {
  throw new Error("Stashes are not available here.");
};

const EMPTY: Record<number, number> = {};

const DISABLED: StashData = {
  enabled: false,
  ready: false,
  loading: false,
  stashes: [],
  allocationsFor: () => EMPTY,
  stashedTotal: () => 0,
  refresh: async () => {},
  failed: false,
  stale: false,
  retry: async () => {},
  create: unavailable,
  saveVariant: unavailable,
  itemsOf: () => [],
  returnItems: unavailable,
  restoreItems: unavailable,
  update: unavailable,
  remove: unavailable,
};

const StashContext = createContext<StashData>(DISABLED);

type ByVariant = Map<number, Record<number, number>>;

function indexItems(items: StashItem[]): ByVariant {
  const m: ByVariant = new Map();
  for (const it of items) {
    if (it.quantity <= 0) continue;
    const row = m.get(it.variant_id) ?? {};
    row[it.stash_id] = it.quantity;
    m.set(it.variant_id, row);
  }
  return m;
}

export function StashProvider({
  enabled,
  paused = false,
  children,
}: {
  enabled: boolean;
  /** Keep what was loaded but fetch and expose nothing (a share is shown). */
  paused?: boolean;
  children: ReactNode;
}) {
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [byVariant, setByVariant] = useState<ByVariant>(() => new Map());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  // Bumped on every enable change, so a fetch that lands after a sign-out
  // is dropped.
  const epoch = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const mine = epoch.current;
    const [list, items] = await Promise.all([getStashes(), getStashItems()]);
    if (mine !== epoch.current) return;
    loaded.current = true;
    setStashes(list);
    setByVariant(indexItems(items));
    setReady(true);
    setFailed(false);
    setStale(false);
  }, []);

  // Signing in or out: drop everything held.
  useEffect(() => {
    epoch.current += 1;
    loaded.current = false;
    setStashes([]);
    setByVariant(new Map());
    setReady(false);
    setFailed(false);
    setStale(false);
  }, [enabled]);

  // The first read, once the own vault is in view (not while paused).
  useEffect(() => {
    if (!enabled || paused || loaded.current) return;
    const mine = epoch.current;
    load().catch((err) => {
      // The card detail simply shows no stash UI until a later refresh.
      console.error("Failed to load stashes:", err);
      if (mine === epoch.current) setFailed(true);
    });
  }, [enabled, paused, load]);

  const liveRef = useRef(enabled && !paused);
  useEffect(() => {
    liveRef.current = enabled && !paused;
  }, [enabled, paused]);

  const refresh = useCallback(async () => {
    if (!liveRef.current) return;
    await load();
  }, [load]);

  const create = useCallback(async (name: string, description: string | null) => {
    const s = await createStash(name, description);
    setStashes((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    return s;
  }, []);

  const saveVariant = useCallback(
    async (variantId: number, allocations: Record<number, number>) => {
      const body = Object.entries(allocations)
        .map(([id, q]) => ({ stash_id: Number(id), quantity: q }))
        .filter((a) => a.quantity > 0);
      const mine = epoch.current;
      const result = await putVariantAllocations(variantId, body);
      // A sign-out (or in) while the PUT was out: its answer is not this
      // session's to show.
      if (mine !== epoch.current) return;
      // The response is the stored split: show it at once, then re-read the
      // list (each stash's `copies`) and the items.
      setByVariant((prev) => {
        const next = new Map(prev);
        const row: Record<number, number> = {};
        for (const a of result.allocations) if (a.quantity > 0) row[a.stash_id] = a.quantity;
        if (Object.keys(row).length) next.set(variantId, row);
        else next.delete(variantId);
        return next;
      });
      await load().catch((err) => console.error(err));
    },
    [load]
  );

  // After a write the server's state wins: re-read the list and the items.
  // The write itself already landed, so a failed re-read never fails the
  // write: it marks the data `stale` and the pages offer a retry.
  const reload = useCallback(async () => {
    const mine = epoch.current;
    try {
      await load();
    } catch (err) {
      console.error("Failed to refresh stashes:", err);
      if (mine !== epoch.current) return;
      if (loaded.current) setStale(true);
      else setFailed(true);
    }
  }, [load]);

  // A return / restore answer: the stash's remaining quantity for each
  // printing sent (0 = the row is gone) and its new total.
  const applyMove = useCallback((res: StashMoveResult) => {
    setByVariant((prev) => {
      const next = new Map(prev);
      for (const it of res.items) {
        const row = { ...(next.get(it.variant_id) ?? {}) };
        if (it.quantity > 0) row[res.stash_id] = it.quantity;
        else delete row[res.stash_id];
        if (Object.keys(row).length) next.set(it.variant_id, row);
        else next.delete(it.variant_id);
      }
      return next;
    });
    setStashes((prev) =>
      prev.map((s) => (s.id === res.stash_id ? { ...s, copies: res.copies } : s))
    );
  }, []);

  const returnItems = useCallback(
    async (stashId: number, items: StashMove[]) => {
      const mine = epoch.current;
      const res = await returnStashItems(stashId, items);
      // Signed out (or in) while it was out: nothing to apply or re-read.
      if (mine !== epoch.current) return;
      applyMove(res);
      await reload();
    },
    [applyMove, reload]
  );
  const restoreItems = useCallback(
    async (stashId: number, items: StashMove[]) => {
      const mine = epoch.current;
      const res = await restoreStashItems(stashId, items);
      if (mine !== epoch.current) return;
      applyMove(res);
      await reload();
    },
    [applyMove, reload]
  );
  const update = useCallback(
    async (stashId: number, patch: { name?: string; description?: string | null }) => {
      const s = await updateStash(stashId, patch);
      setStashes((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...s } : x)));
      await reload();
    },
    [reload]
  );
  const remove = useCallback(
    async (stashId: number) => {
      const mine = epoch.current;
      await deleteStash(stashId);
      if (mine !== epoch.current) return;
      setStashes((prev) => prev.filter((x) => x.id !== stashId));
      // Its copies are back in the Vault: drop it from every printing's
      // split now, so stashedTotal is right even if the re-read fails.
      setByVariant((prev) => {
        const next = new Map(prev);
        for (const [vid, row] of prev) {
          if (!(stashId in row)) continue;
          const rest = { ...row };
          delete rest[stashId];
          if (Object.keys(rest).length) next.set(vid, rest);
          else next.delete(vid);
        }
        return next;
      });
      await reload();
    },
    [reload]
  );

  const byStash = useMemo(() => {
    const m = new Map<number, StashMove[]>();
    for (const [variant_id, row] of byVariant)
      for (const [id, quantity] of Object.entries(row)) {
        const list = m.get(Number(id)) ?? [];
        list.push({ variant_id, quantity });
        m.set(Number(id), list);
      }
    return m;
  }, [byVariant]);

  const value = useMemo<StashData>(() => {
    if (!enabled || paused) return DISABLED;
    return {
      enabled: true,
      ready,
      loading: !ready && !failed,
      stashes,
      allocationsFor: (id) => byVariant.get(id) ?? EMPTY,
      stashedTotal: (id) => {
        const row = byVariant.get(id);
        if (!row) return 0;
        let n = 0;
        for (const q of Object.values(row)) n += q;
        return n;
      },
      refresh,
      failed,
      stale,
      retry: reload,
      create,
      saveVariant,
      itemsOf: (id) => byStash.get(id) ?? [],
      returnItems,
      restoreItems,
      update,
      remove,
    };
  }, [
    enabled,
    paused,
    ready,
    failed,
    stashes,
    byVariant,
    byStash,
    refresh,
    stale,
    reload,
    create,
    saveVariant,
    returnItems,
    restoreItems,
    update,
    remove,
  ]);

  return <StashContext.Provider value={value}>{children}</StashContext.Provider>;
}

export function useStashes(): StashData {
  return useContext(StashContext);
}
