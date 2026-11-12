import { useEffect, useState } from "react";
import { getSharedStash, ShareResolveError, stashShareLabel } from "../../api/sharedView";
import type { SharedStashView } from "../../api/sharedView";
import { capture } from "../../analytics/analytics";
import { LimitsProvider } from "../../context/LimitsContext";
import { SHARED_STASH_COPY } from "../../stashes/stashContents";
import { StashProvider } from "../../stashes/StashContext";
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
}

/** A stash link's viewer pane (App Spec §19.1): SharedVaultPage's frame and
 * states for a stash token. One read, GET /api/shared/{token}/stash, carries
 * everything -- the label, the head, the counts -- on mount and token change,
 * as the vault viewer reads its quantities; the next read shows a rename or a
 * count change. Revoked, unknown and deleted-stash links are one 404, one
 * sentence. Ready, it renders the same CardsPage with the read (`sharedStash`),
 * under a signed-out LimitsProvider (a stash token has no limits read and the
 * stash's counts have no keep limit) and a disabled StashProvider (no stash
 * data of the viewer's own under a share). */
export function SharedStashPage({ token, onResolved }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<SharedStashView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getSharedStash(token)
      .then((data) => {
        if (cancelled) return;
        setView(data);
        onResolved(token, stashShareLabel(data));
        setStatus("ready");
        capture("share_link_viewed", {});
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
