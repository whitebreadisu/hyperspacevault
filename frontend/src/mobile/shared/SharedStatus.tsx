import type { CSSProperties, ReactNode } from "react";
import { SectionSeparator } from "../../components/SectionSeparator";
import { formatVersionLabel } from "../../utils/version";
import { go } from "../router";
import { BrandLogo } from "../BrandLogo";
import type { ShareStatus } from "./useShare";
import { SHARED_STASH_COPY } from "../../stashes/stashContents";
import type { ShareKind } from "../../utils/shareRoute";
import "../more/more.css";

// Desktop SharedVaultPage's three non-ready states, one plain sentence each,
// inside the normal frame (the brand header -- one About button -- the
// circuit seam, then the sentence) and nothing else: no collection panel
// (MobileApp parks the own vault out of sight, shared.css). Copy verbatim
// from SharedVaultPage.tsx; a stash link's from SharedStashPage.tsx.
// The header reuses More's brand block (more.css .m-more__hdr; the session
// starfield) with the account slot.

const VERSION = formatVersionLabel(__APP_VERSION__);

export const SHARE_STATUS_COPY: Record<Exclude<ShareStatus, "ready">, string> = {
  loading: "Loading shared vault…",
  "rate-limited":
    "This shared vault is getting a lot of traffic right now — please try again in a moment.",
  invalid: "This shared vault is no longer available.",
};

/** A stash link's sentences (App Spec §19.1). */
export const STASH_STATUS_COPY: Record<Exclude<ShareStatus, "ready">, string> = {
  loading: SHARED_STASH_COPY.loading,
  "rate-limited": SHARED_STASH_COPY.rateLimited,
  invalid: SHARED_STASH_COPY.invalid,
};

export function SharedStatus({
  status,
  account,
  kind = "vault",
}: {
  status: Exclude<ShareStatus, "ready">;
  account: ReactNode;
  kind?: ShareKind;
}) {
  const copy = kind === "stash" ? STASH_STATUS_COPY : SHARE_STATUS_COPY;
  return (
    <div className="m-screen m-shared-status" data-share-status={status}>
      <header
        className="m-more__hdr"
        style={
          {
            "--starfield": 'var(--header-starfield, url("/images/starfields/starfield_ASH.jpg"))',
          } as CSSProperties
        }
      >
        <div className="m-more__sky" aria-hidden="true" />
        <div className="m-more__top">
          <button
            type="button"
            className="m-more__brand"
            onClick={() => go("#/about")}
            aria-label="About & Legal"
          >
            <BrandLogo />
            <span className="m-vh__tag">
              Unofficial Fan Project [<span className="m-vh__ver">{VERSION}</span>]
            </span>
          </button>
          {account}
        </div>
      </header>
      <SectionSeparator className="m-more__sep" />
      <div className="m-scroll">
        <p
          className={
            "m-shared-status__text" + (status === "invalid" ? " m-shared-status__text--dead" : "")
          }
          role={status === "loading" ? "status" : "alert"}
        >
          {copy[status]}
        </p>
      </div>
    </div>
  );
}
