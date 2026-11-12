import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSharedStash,
  resolveShare,
  ShareResolveError,
  stashShareLabel,
} from "../../api/sharedView";
import type { SharedStashView } from "../../api/sharedView";
import { loadShareSession, saveShareSession } from "../../utils/shareSession";
import { parseShareRoute } from "../../utils/shareRoute";
import type { ShareKind } from "../../utils/shareRoute";
import { capturePhone } from "../phoneAnalytics";
import { useRefreshOnReturn } from "../../utils/useRefreshOnReturn";

// The phone's share session (App Spec §25.6) -- desktop App.tsx's
// shareToken / shareName state + SharedVaultPage's resolve, in one hook.
//   - The tab's session (utils/shareSession.ts, sessionStorage) seeds the
//     token + name, so a share opened earlier in this tab survives a reload
//     on any other route (App.tsx's lazy initialisers).
//   - A `/shared/{token}` pathname at mount (re)establishes the session:
//     newest share replaces the previous, the stale name is cleared until the
//     resolve lands, and the shared vault is the one shown (App.tsx's
//     mount-only route parse + setActiveView("shared")).
//   - The token resolves via api/sharedView.ts (GET /api/shared/{token}, no
//     auth) whenever one is held, as SharedVaultPage does on mount; success
//     persists the session (saveShareSession) and reports share_link_viewed.
//   - A stash link (`/shared/stash/{token}`, or a session of kind "stash")
//     takes the stash read instead (GET /api/shared/{token}/stash, desktop's
//     SharedStashPage): `stash` holds it and `name` is "<share name> ·
//     <stash name>".
// Status copy lives in SharedStatus.tsx, verbatim from
// SharedVaultPage.tsx / SharedStashPage.tsx.

export type ShareStatus = "loading" | "ready" | "invalid" | "rate-limited";

export interface ShareState {
  token: string | null;
  /** Which read the token takes (a vault link or a stash link). */
  kind: ShareKind;
  /** A stash link's read once ready (null for a vault link). */
  stash: SharedStashView | null;
  /** The owner-chosen name -- the switch's label; null until known. A
   * stash link's is "<share name> · <stash name>". */
  name: string | null;
  /** A stash link's share name alone (the signed-out bar chip); null for a
   * vault link or until known. */
  shareName: string | null;
  status: ShareStatus;
  /** The shared vault (not the viewer's own) is the vault shown. */
  shown: boolean;
  setShown: (on: boolean) => void;
}

function initial(): {
  token: string | null;
  kind: ShareKind;
  name: string | null;
  shareName: string | null;
  shown: boolean;
} {
  const route = typeof window === "undefined" ? null : parseShareRoute(window.location.pathname);
  if (route)
    return { token: route.token, kind: route.kind, name: null, shareName: null, shown: true };
  const s = loadShareSession();
  return {
    token: s?.token ?? null,
    kind: s?.kind ?? "vault",
    name: s?.name ?? null,
    shareName: s?.shareName ?? null,
    shown: false,
  };
}

export function useShare(): ShareState {
  const [init] = useState(initial);
  const [token] = useState<string | null>(init.token);
  const [kind] = useState<ShareKind>(init.kind);
  const [name, setName] = useState<string | null>(init.name);
  const [shareName, setShareName] = useState<string | null>(init.shareName);
  const [stash, setStash] = useState<SharedStashView | null>(null);
  const [status, setStatus] = useState<ShareStatus>("loading");
  const [shown, setShownState] = useState(init.shown);
  // The read in flight; a newer read (or unmount) supersedes it.
  const seq = useRef(0);

  // One read of the token: the resolve for a vault link, the stash read for
  // a stash link. A stash link reads again when the viewer returns to the
  // tab (below); a later read replaces the stash in place, and only a 404
  // (revoked, or the stash deleted) changes the state, to the dead link,
  // which drops the name so the bar shows the plain Vault tab.
  const read = useCallback(
    (first: boolean, live: () => boolean = () => true) => {
      if (!token) return;
      const mine = ++seq.current;
      if (first) setStatus("loading");
      const req: Promise<{
        name: string;
        shareName: string | null;
        stash: SharedStashView | null;
      }> =
        kind === "stash"
          ? getSharedStash(token).then((v) => ({
              name: stashShareLabel(v),
              shareName: v.share_name,
              stash: v,
            }))
          : resolveShare(token).then((r) => ({ name: r.name, shareName: null, stash: null }));
      req
        .then((data) => {
          if (mine !== seq.current || !live()) return;
          setName(data.name);
          setShareName(data.shareName);
          setStash(data.stash);
          saveShareSession(
            kind === "stash"
              ? { token, name: data.name, kind, shareName: data.shareName ?? undefined }
              : { token, name: data.name }
          );
          setStatus("ready");
          // Desktop's event (SharedVaultPage), + layout.
          if (first) capturePhone("share_link_viewed");
        })
        .catch((err) => {
          if (mine !== seq.current || !live()) return;
          const code = err instanceof ShareResolveError ? err.code : "unknown";
          if (!first && code !== "not_found") return;
          if (code === "rate_limited") {
            setStatus("rate-limited");
            return;
          }
          setStatus("invalid");
          if (kind === "stash") {
            setStash(null);
            setName(null);
            setShareName(null);
          }
        });
    },
    [token, kind]
  );

  const { markRead } = useRefreshOnReturn(() => read(false), {
    enabled: kind === "stash" && status === "ready",
  });

  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    markRead();
    read(true, () => live);
    return () => {
      live = false;
    };
  }, [token, read, markRead]);

  const setShown = useCallback((on: boolean) => setShownState(on), []);
  return {
    token,
    kind,
    stash,
    name,
    shareName,
    status,
    shown: shown && token != null,
    setShown,
  };
}
