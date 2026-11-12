import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { listShares } from "../api/shares";
import type { ShareRecord } from "../api/shares";
import { useStashes } from "../stashes/StashContext";

// The owner-links source (App Spec §19.1, owner screens): the caller's live
// share links from GET /api/shares, read once and shared by the share window's
// "Your links" list, the Stashes rail and phone-list link marks, the rail
// legend / list count and the "Link on" lines. Signed in, own vault only.
//   - Lazy: nothing is fetched until a consumer mounts (`useShareLinks`), so
//     a session that never opens Stashes or a share window never asks.
//   - Joined with the stash list (StashContext): a stash link shows its
//     stash's current name and sorts in stash creation order; once the stash
//     list has loaded, a link whose stash is gone is not listed (a delete
//     drops its mark at once, before the re-read confirms it).
//   - Re-read after a create, rotate or revoke (the window applies the
//     answer first with `put` / `drop`) and after a stash rename or delete
//     (useStashMeta), and every time a share window opens (`reload`). A user
//     change drops everything held, and a write or re-read started under the
//     previous account is ignored when it lands (`session`).
//   - Paused while a shared vault or stash is the view (as StashProvider):
//     nothing read or exposed; what was loaded is kept.
//   - No provider reads as disabled (tests, the public pages).

export type LinkTarget = "vault" | number;

export interface OwnerLink {
  share: ShareRecord;
  target: LinkTarget;
  /** "Vault", or the stash's current name. */
  label: string;
}

export interface ShareLinksData {
  enabled: boolean;
  /** The first read has landed. */
  ready: boolean;
  /** The last read failed and nothing usable is held. */
  failed: boolean;
  /** Live links: the vault link first, then stash links in stash order. */
  links: OwnerLink[];
  vault: ShareRecord | null;
  forStash: (stashId: number) => ShareRecord | null;
  /** Stash links that are live (the rail legend / list count). */
  sharedStashes: number;
  /** Ask for the links (a consumer mounted): the first ask fetches, and an
   * ask after a failed first read tries again. */
  load: () => void;
  /** Read now (a share window opened, or Try again). Never throws. */
  reload: () => Promise<void>;
  /** The account generation now: a write captures it before its request and
   * hands it back with the answer, so an answer that lands after an account
   * change is dropped. */
  session: () => number;
  /** Re-read, when the links were asked for (and, with `session`, only for
   * the same account); never throws. */
  refresh: (session?: number) => Promise<void>;
  /** Apply a created / rotated / renamed record at once (same account only). */
  put: (share: ShareRecord, session?: number) => void;
  /** Drop a revoked link at once (same account only). */
  drop: (shareId: number, session?: number) => void;
}

const noop = () => {};
const DISABLED: ShareLinksData = {
  enabled: false,
  ready: false,
  failed: false,
  links: [],
  vault: null,
  forStash: () => null,
  sharedStashes: 0,
  load: noop,
  reload: async () => {},
  session: () => 0,
  refresh: async () => {},
  put: noop,
  drop: noop,
};

const ShareLinksContext = createContext<ShareLinksData>(DISABLED);

const isStash = (s: ShareRecord) => s.scope === "stash" && s.target_id != null;

export function ShareLinksProvider({
  enabled,
  paused = false,
  uid = null,
  children,
}: {
  enabled: boolean;
  /** A shared vault or stash is the view: read and expose nothing, keep
   * what was loaded (StashProvider's `paused`). */
  paused?: boolean;
  uid?: string | null;
  children: ReactNode;
}) {
  const stashCtx = useStashes();
  const [rows, setRows] = useState<ShareRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wanted, setWanted] = useState(false);
  const wantedRef = useRef(false);
  // Reads are sequenced: an older answer never overwrites a newer one.
  const seq = useRef(0);

  // A user change or sign-out drops what was held and starts a new account
  // generation; answers from the old one are ignored.
  const [seenUser, setSeenUser] = useState<string | null>(enabled ? uid : null);
  const [gen, setGen] = useState(0);
  const user = enabled ? uid : null;
  if (seenUser !== user) {
    setSeenUser(user);
    setGen((g) => g + 1);
    setRows([]);
    setReady(false);
    setFailed(false);
  }
  const genRef = useRef(gen);
  const activeRef = useRef(enabled && !paused);
  const stateRef = useRef({ ready, failed });
  useLayoutEffect(() => {
    genRef.current = gen;
    activeRef.current = enabled && !paused;
    stateRef.current = { ready, failed };
  });

  const read = useCallback(async () => {
    if (!activeRef.current) return;
    const mine = ++seq.current;
    const at = genRef.current;
    try {
      const got = await listShares();
      if (mine !== seq.current || at !== genRef.current) return;
      setRows(got.filter((s) => !s.revoked));
      setFailed(false);
      setReady(true);
    } catch {
      if (mine !== seq.current || at !== genRef.current) return;
      setFailed(true);
    }
  }, []);

  const active = enabled && !paused;
  // A user change mid-read: the answer is dropped by the generation check in
  // `read` (seq only orders reads within one account).
  useEffect(() => {
    if (active && wanted) void read();
  }, [active, wanted, user, read]);

  const load = useCallback(() => {
    if (!wantedRef.current) {
      wantedRef.current = true;
      setWanted(true);
    } else if (stateRef.current.failed && !stateRef.current.ready) void read();
  }, [read]);

  const reload = useCallback(async () => {
    if (!wantedRef.current) {
      // The first ask: the effect above reads.
      wantedRef.current = true;
      setWanted(true);
      return;
    }
    await read();
  }, [read]);

  const session = useCallback(() => genRef.current, []);

  const refresh = useCallback(
    async (s?: number) => {
      if (!wantedRef.current || !(s == null || s === genRef.current)) return;
      await read();
    },
    [read]
  );

  const put = useCallback((share: ShareRecord, s?: number) => {
    if (!(s == null || s === genRef.current)) return;
    seq.current++;
    setRows((prev) =>
      prev.some((x) => x.id === share.id)
        ? prev.map((x) => (x.id === share.id ? { ...x, ...share } : x))
        : [...prev, share]
    );
    setReady(true);
  }, []);

  const drop = useCallback((shareId: number, s?: number) => {
    if (!(s == null || s === genRef.current)) return;
    seq.current++;
    setRows((prev) => prev.filter((x) => x.id !== shareId));
  }, []);

  const { stashes, ready: stashesReady } = stashCtx;
  const value = useMemo<ShareLinksData>(() => {
    if (!active) return DISABLED;
    const vault = rows.find((s) => s.scope === "inventory") ?? null;
    const order = new Map(stashes.map((s, i) => [s.id, i]));
    const stashLinks = rows
      .filter(isStash)
      .filter((s) => !stashesReady || order.has(s.target_id as number))
      .map((s) => {
        const id = s.target_id as number;
        const stash = stashes.find((x) => x.id === id);
        return { share: s, target: id, label: stash?.name ?? s.stash_name ?? "" } as OwnerLink;
      })
      .sort(
        (a, b) =>
          (order.get(a.target as number) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.target as number) ?? Number.MAX_SAFE_INTEGER)
      );
    const links: OwnerLink[] = [
      ...(vault ? [{ share: vault, target: "vault" as const, label: "Vault" }] : []),
      ...stashLinks,
    ];
    const byStash = new Map(stashLinks.map((l) => [l.target as number, l.share]));
    return {
      enabled: true,
      ready,
      failed: failed && !ready,
      links,
      vault,
      forStash: (id: number) => byStash.get(id) ?? null,
      sharedStashes: stashLinks.length,
      load,
      reload,
      session,
      refresh,
      put,
      drop,
    };
  }, [
    active,
    rows,
    stashes,
    stashesReady,
    ready,
    failed,
    load,
    reload,
    session,
    refresh,
    put,
    drop,
  ]);

  return <ShareLinksContext.Provider value={value}>{children}</ShareLinksContext.Provider>;
}

/** The owner's links, asking for them on mount (the first ask fetches). */
export function useShareLinks(): ShareLinksData {
  const ctx = useContext(ShareLinksContext);
  const { load } = ctx;
  useEffect(() => load(), [load]);
  return ctx;
}

/** The links without asking for them (writers that only refresh). */
export function useShareLinksContext(): ShareLinksData {
  return useContext(ShareLinksContext);
}
