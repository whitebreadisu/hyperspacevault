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
import { createStash, getStashes, getStashItems, putVariantAllocations } from "../api/stashes";
import type { Stash, StashItem } from "../api/stashes";

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
// Refreshed after a Done commit (saveVariant) and after an import commit
// (refresh, called by both import screens).

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
  /** POST a new empty stash and append it to the list. */
  create: (name: string, description: string | null) => Promise<Stash>;
  /** PUT the printing's full split, then refresh. */
  saveVariant: (variantId: number, allocations: Record<number, number>) => Promise<void>;
}

const EMPTY: Record<number, number> = {};

const DISABLED: StashData = {
  enabled: false,
  ready: false,
  loading: false,
  stashes: [],
  allocationsFor: () => EMPTY,
  stashedTotal: () => 0,
  refresh: async () => {},
  create: async () => {
    throw new Error("Stashes are not available here.");
  },
  saveVariant: async () => {
    throw new Error("Stashes are not available here.");
  },
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
  }, []);

  // Signing in or out: drop everything held.
  useEffect(() => {
    epoch.current += 1;
    loaded.current = false;
    setStashes([]);
    setByVariant(new Map());
    setReady(false);
    setFailed(false);
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
      const result = await putVariantAllocations(variantId, body);
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
      create,
      saveVariant,
    };
  }, [enabled, paused, ready, failed, stashes, byVariant, refresh, create, saveVariant]);

  return <StashContext.Provider value={value}>{children}</StashContext.Provider>;
}

export function useStashes(): StashData {
  return useContext(StashContext);
}
