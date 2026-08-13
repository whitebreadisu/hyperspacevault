import { useEffect, useState } from "react";
import { resolveShare, ShareResolveError } from "../../api/sharedView";
import { CardsPage } from "../cards/CardsPage";
import { LimitsProvider } from "../../context/LimitsContext";

type Status = "loading" | "ready" | "invalid" | "rate-limited";

interface Props {
  /** The token this pane resolves and, once valid, renders the read-only
   * Vault for -- either freshly parsed off a `/shared/{token}` URL, or
   * carried over from a prior resolve via sessionStorage (App.tsx's
   * shareToken state, see utils/shareSession.ts). */
  token: string;
  /** BL-205: reports the share's owner-chosen name back up to App once
   * resolveShare succeeds -- App needs it synchronously to render the
   * header's nav item (§19.1: "the share's name appears as a header item").
   * Takes `token` as its first argument (not closed over) so App can keep
   * this callback's identity stable across renders (an inline arrow that
   * changed identity every render would re-trigger the resolve effect
   * below on every unrelated App re-render -- see the effect's dep array). */
  onResolved: (token: string, name: string) => void;
}

/** BL-205 (§19.1): the viewer-mode Vault pane for a shared link. Resolves
 * the token (GET /api/shared/{token}) on mount/token change, then renders
 * the SAME Vault component tree the owner's own Vault uses (CardsPage),
 * wired read-only to the token-scoped endpoints via its `shareToken` prop --
 * see that prop's own doc comment in CardsPage.tsx for the full seam. This
 * component does NOT duplicate any of that tree; it only decides what to
 * render before the tree is ready (loading / invalid / rate-limited), each
 * a friendly full-page state INSIDE the normal app frame (Header/main
 * wrapper is App's, unchanged) -- never a crash, per the route's own
 * requirement.
 *
 * A separate, nested LimitsProvider (shareToken set) wraps just this pane's
 * CardsPage -- it shadows the app-wide provider (App.tsx's LimitsGate) for
 * this subtree only, serving the share's OWNER-tenant limits instead of the
 * viewer's own. */
export function SharedVaultPage({ token, onResolved }: Props) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    resolveShare(token)
      .then((data) => {
        if (cancelled) return;
        onResolved(token, data.name);
        setStatus("ready");
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
  }, [token, onResolved]);

  if (status === "loading") {
    return <p className="loading-text">Loading shared vault…</p>;
  }

  if (status === "rate-limited") {
    return (
      <div className="screen">
        <p className="loading-text">
          This shared vault is getting a lot of traffic right now — please try again in a moment.
        </p>
      </div>
    );
  }

  if (status === "invalid") {
    // §19.1: invalid and revoked tokens are indistinguishable (404) -- this
    // copy deliberately doesn't try to tell them apart either.
    return (
      <div className="screen">
        <p className="loading-text">This shared vault is no longer available.</p>
      </div>
    );
  }

  return (
    <LimitsProvider isAuthenticated={false} shareToken={token}>
      <CardsPage isAuthenticated={false} shareToken={token} />
    </LimitsProvider>
  );
}
