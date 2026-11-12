import { useCallback, useEffect, useState } from "react";
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
  /** The owner-chosen name -- the switch's label; null until known. */
  name: string | null;
  status: ShareStatus;
  /** The shared vault (not the viewer's own) is the vault shown. */
  shown: boolean;
  setShown: (on: boolean) => void;
}

function initial(): {
  token: string | null;
  kind: ShareKind;
  name: string | null;
  shown: boolean;
} {
  const route = typeof window === "undefined" ? null : parseShareRoute(window.location.pathname);
  if (route) return { token: route.token, kind: route.kind, name: null, shown: true };
  const s = loadShareSession();
  return {
    token: s?.token ?? null,
    kind: s?.kind ?? "vault",
    name: s?.name ?? null,
    shown: false,
  };
}

export function useShare(): ShareState {
  const [init] = useState(initial);
  const [token] = useState<string | null>(init.token);
  const [kind] = useState<ShareKind>(init.kind);
  const [name, setName] = useState<string | null>(init.name);
  const [stash, setStash] = useState<SharedStashView | null>(null);
  const [status, setStatus] = useState<ShareStatus>("loading");
  const [shown, setShownState] = useState(init.shown);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    setStatus("loading");
    const read: Promise<{ name: string; stash: SharedStashView | null }> =
      kind === "stash"
        ? getSharedStash(token).then((v) => ({ name: stashShareLabel(v), stash: v }))
        : resolveShare(token).then((r) => ({ name: r.name, stash: null }));
    read
      .then((data) => {
        if (cancelled) return;
        setName(data.name);
        setStash(data.stash);
        saveShareSession(
          kind === "stash" ? { token, name: data.name, kind } : { token, name: data.name }
        );
        setStatus("ready");
        // Desktop's event (SharedVaultPage), + layout.
        capturePhone("share_link_viewed");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(
          err instanceof ShareResolveError && err.code === "rate_limited"
            ? "rate-limited"
            : "invalid"
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, kind]);

  const setShown = useCallback((on: boolean) => setShownState(on), []);
  return { token, kind, stash, name, status, shown: shown && token != null, setShown };
}
