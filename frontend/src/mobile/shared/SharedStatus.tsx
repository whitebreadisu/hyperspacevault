import type { CSSProperties, ReactNode } from "react";
import { SectionSeparator } from "../../components/SectionSeparator";
import { formatVersionLabel } from "../../utils/version";
import { go } from "../router";
import type { ShareStatus } from "./useShare";
import "../more/more.css";

// BL-252 S6-02: desktop SharedVaultPage's three non-ready states, one plain
// sentence each, inside the normal frame (rev4 MSharedStatus: the brand
// header -- one About button -- the circuit seam, then the sentence). Copy
// verbatim from SharedVaultPage.tsx. The header reuses More's brand block
// (more.css .m-more__hdr; the session starfield) with the account slot.

const VERSION = formatVersionLabel(__APP_VERSION__);

export const SHARE_STATUS_COPY: Record<Exclude<ShareStatus, "ready">, string> = {
  loading: "Loading shared vault…",
  "rate-limited":
    "This shared vault is getting a lot of traffic right now — please try again in a moment.",
  invalid: "This shared vault is no longer available.",
};

export function SharedStatus({
  status,
  account,
}: {
  status: Exclude<ShareStatus, "ready">;
  account: ReactNode;
}) {
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
            <span className="m-vh__word">[HSV] Hyperspace Vault</span>
            <span className="m-vh__tag">
              Unofficial Fan Project [<span className="m-vh__ver">{VERSION}</span>]
            </span>
          </button>
          {account}
        </div>
      </header>
      <SectionSeparator className="m-more__sep" />
      <div className="m-scroll">
        <p className="m-shared-status__text" role={status === "loading" ? "status" : "alert"}>
          {SHARE_STATUS_COPY[status]}
        </p>
      </div>
    </div>
  );
}
