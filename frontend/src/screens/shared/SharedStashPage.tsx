import { useCallback, useEffect, useRef, useState } from "react";
import { getSharedStash, ShareResolveError, stashShareLabel } from "../../api/sharedView";
import type { SharedStashView } from "../../api/sharedView";
import { capture } from "../../analytics/analytics";
import { LimitsProvider } from "../../context/LimitsContext";
import { SHARED_STASH_COPY } from "../../stashes/stashContents";
import { StashProvider } from "../../stashes/StashContext";
import { useRefreshOnReturn } from "../../utils/useRefreshOnReturn";
import { CardsPage } from "../cards/CardsPage";
import "./sharedStash.css";

type Status = "loading" | "ready" | "invalid" | "rate-limited";

interface Props {
  /** A stash link's token (`/shared/stash/{token}`, or the tab's session). */
  token: string;
  /** Reports the viewer label ("<share name> · <stash name>") up to App for
   * the header pod, as SharedVaultPage reports the vault share's name. Takes
   * `token` first so App keeps its identity stable (see SharedVaultPage). */
  onResolved: (token: string, name: string) => void;
  /** The link is dead (404 on a read, first or later): App drops the pod's
   * share item, so the pod shows My vault only. Stable identity, as
   * onResolved. */
  onGone?: (token: string) => void;
}

/** A stash link's viewer pane (App Spec §19.1): SharedVaultPage's frame and
 * states for a stash token. One read, GET /api/shared/{token}/stash, carries
 * everything -- the label, the head, the counts. It runs on mount and token
 * change, and again when the viewer returns to the tab (visible again or
 * window focus, at most once per 30 s: useRefreshOnReturn), so a rename, a
 * count change or a revocation reaches an open viewer. A later read replaces
 * the shown stash in place (no loading state); a 404 on any read is the dead
 * link; a later 429 or other failure keeps what is shown. Revoked, unknown
 * and deleted-stash links are one 404, one sentence. Ready, it renders the
 * same CardsPage with the read (`sharedStash`), under a signed-out
 * LimitsProvider (a stash token has no limits read and the stash's counts
 * have no keep limit) and a disabled StashProvider (no stash data of the
 * viewer's own under a share). */
export function SharedStashPage({ token, onResolved, onGone }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<SharedStashView | null>(null);
  // The read in flight belongs to this token; a newer read supersedes it.
  const seq = useRef(0);

  const read = useCallback(
    (first: boolean, live: () => boolean = () => true) => {
      const mine = ++seq.current;
      if (first) setStatus("loading");
      getSharedStash(token)
        .then((data) => {
          if (mine !== seq.current || !live()) return;
          setView(data);
          onResolved(token, stashShareLabel(data));
          setStatus("ready");
          if (first) capture("share_link_viewed", {});
        })
        .catch((err) => {
          if (mine !== seq.current || !live()) return;
          const code = err instanceof ShareResolveError ? err.code : "unknown";
          if (!first && code !== "not_found") return;
          if (code === "rate_limited") {
            setStatus("rate-limited");
            return;
          }
          setView(null);
          setStatus("invalid");
          onGone?.(token);
        });
    },
    [token, onResolved, onGone]
  );

  const { markRead } = useRefreshOnReturn(() => read(false), { enabled: status === "ready" });

  useEffect(() => {
    let live = true;
    markRead();
    read(true, () => live);
    return () => {
      live = false;
    };
  }, [read, markRead]);

  if (status === "loading") {
    return <p className="loading-text">{SHARED_STASH_COPY.loading}</p>;
  }
  if (status !== "ready" || !view) {
    return (
      <div className="screen">
        <p
          className={"loading-text" + (status === "invalid" ? " ss-dead" : "")}
          data-share-status={status}
        >
          {status === "rate-limited" ? SHARED_STASH_COPY.rateLimited : SHARED_STASH_COPY.invalid}
        </p>
      </div>
    );
  }

  return (
    <LimitsProvider isAuthenticated={false}>
      <StashProvider enabled={false}>
        <CardsPage isAuthenticated={false} shareToken={token} sharedStash={view} />
      </StashProvider>
    </LimitsProvider>
  );
}
