import { useCallback, useEffect, useState } from "react";
import { resolveShare, ShareResolveError } from "../../api/sharedView";
import { loadShareSession, saveShareSession } from "../../utils/shareSession";
import { parseShareRouteToken } from "../../utils/shareRoute";
import { capturePhone } from "../phoneAnalytics";

// BL-252 S6-01 / S6-02: the phone's share session -- desktop App.tsx's
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
// Status copy (S6-02) lives in SharedStatus.tsx, verbatim from
// SharedVaultPage.tsx.

export type ShareStatus = "loading" | "ready" | "invalid" | "rate-limited";

export interface ShareState {
  token: string | null;
  /** The owner-chosen name -- the switch's label; null until known. */
  name: string | null;
  status: ShareStatus;
  /** The shared vault (not the viewer's own) is the vault shown. */
  shown: boolean;
  setShown: (on: boolean) => void;
}

function initial() {
  const routeToken =
    typeof window === "undefined" ? null : parseShareRouteToken(window.location.pathname);
  if (routeToken) return { token: routeToken, name: null, shown: true };
  const s = loadShareSession();
  return { token: s?.token ?? null, name: s?.name ?? null, shown: false };
}

export function useShare(): ShareState {
  const [init] = useState(initial);
  const [token] = useState<string | null>(init.token);
  const [name, setName] = useState<string | null>(init.name);
  const [status, setStatus] = useState<ShareStatus>("loading");
  const [shown, setShownState] = useState(init.shown);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    setStatus("loading");
    resolveShare(token)
      .then((data) => {
        if (cancelled) return;
        setName(data.name);
        saveShareSession({ token, name: data.name });
        setStatus("ready");
        // S6-08: desktop's event (SharedVaultPage), + layout.
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
  }, [token]);

  const setShown = useCallback((on: boolean) => setShownState(on), []);
  return { token, name, status, shown: shown && token != null, setShown };
}
