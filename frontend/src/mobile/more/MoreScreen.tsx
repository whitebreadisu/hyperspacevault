import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SectionSeparator } from "../../components/SectionSeparator";
import { formatVersionLabel } from "../../utils/version";
import { MIcon } from "../icons";
import { go } from "../router";
import "./more.css";

// BL-250 S4-01: More at #/more (rev4 MMore.jsx 12-33 + m-layout.css 497-515,
// m-rev1.css 285-288, m-rev4-d.css 147-158). The brand block at the top is an
// About button (rev4 D1: one brand button); the account slot sits beside it
// as on the Vault. Groups: Collection (Import & Export, Sharing, the Deck
// Check sentence -- R4-14.1), Account (signed in: Settings, Change Password
// for password accounts), Hyperspace Vault (About & Legal, [HSV] Updates,
// Leave Feedback), then Log Out -- or Sign in when signed out. Entry names
// are desktop's (UserMenu, Header). Gating is desktop's: Import & Export and
// Sharing stay listed for an anonymous visitor as inert teasers that open
// sign-in (CardsPage's aria-disabled SWUButtons); Import & Export is also
// inert for a signed-in, unverified account and explains itself inline
// (CardsPage .ie-entry-nudge). The Updates row pulses only when More was
// opened before the title (R5-2; `updatesCue`).

const VERSION = formatVersionLabel(__APP_VERSION__);

/** Desktop CardsPage .ie-entry-nudge, minus its "— see the banner above."
 * tail: the phone has no verify-email banner (DECISION NEEDED, S4-01). */
export const IE_UNVERIFIED_NUDGE = "Verify your email to import or export your collection.";

export interface MoreScreenProps {
  signedIn: boolean;
  emailVerified: boolean;
  hasPasswordProvider: boolean;
  updatesCue: boolean;
  account: ReactNode;
  onSignIn: () => void;
  onLogout: () => void;
}

interface RowProps {
  id: string;
  title: string;
  line?: string;
  onClick: () => void;
  off?: boolean;
  cue?: boolean;
  chevron?: boolean;
}

function Row({ id, title, line, onClick, off, cue, chevron = true }: RowProps) {
  return (
    <button
      type="button"
      data-more={id}
      className={"m-morerow" + (off ? " m-morerow--off" : "") + (cue ? " m-morerow--cue" : "")}
      onClick={onClick}
      aria-disabled={off ? true : undefined}
      aria-label={cue ? title + ", unread release notes" : undefined}
    >
      <span className="m-morerow__text">
        <span className={"m-morerow__title" + (cue ? " m-cue" : "")} data-cue={title}>
          {title}
        </span>
        {line ? <span className="m-morerow__line">{line}</span> : null}
      </span>
      {chevron ? <MIcon name="fwd" size={18} /> : null}
    </button>
  );
}

export function MoreScreen({
  signedIn,
  emailVerified,
  hasPasswordProvider,
  updatesCue,
  account,
  onSignIn,
  onLogout,
}: MoreScreenProps) {
  const [nudge, setNudge] = useState(false);
  const ieOpen = signedIn && emailVerified;
  return (
    <div className="m-screen m-more">
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
            onClick={() => go("#/more/about")}
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
      <div className="m-scroll m-more__scroll">
        <section className="m-moregroup" aria-label="Collection">
          <h2 className="m-moregroup__label">Collection</h2>
          <Row
            id="importexport"
            title="Import & Export"
            line="Bring your collection in, or take it with you"
            off={!ieOpen}
            onClick={() => {
              if (ieOpen) go("#/more/importexport");
              else if (!signedIn) onSignIn();
              else setNudge(true);
            }}
          />
          {nudge && signedIn && !emailVerified ? (
            <p className="m-more__nudge">{IE_UNVERIFIED_NUDGE}</p>
          ) : null}
          <Row
            id="sharing"
            title="Sharing"
            line="Share a read-only view of your vault"
            off={!signedIn}
            onClick={() => (signedIn ? go("#/more/sharing") : onSignIn())}
          />
          <p className="m-fine m-more__note m-more__deckcheck">
            Deck Check is on the desktop site.
          </p>
        </section>

        {signedIn ? (
          <section className="m-moregroup" aria-label="Account">
            <h2 className="m-moregroup__label">Account</h2>
            <Row
              id="settings"
              title="Settings"
              line="Keep limits, price display, account"
              onClick={() => go("#/more/settings")}
            />
            {hasPasswordProvider ? (
              <Row id="password" title="Change Password" onClick={() => go("#/more/password")} />
            ) : null}
          </section>
        ) : null}

        <section className="m-moregroup" aria-label="Hyperspace Vault">
          <h2 className="m-moregroup__label">Hyperspace Vault</h2>
          <Row
            id="about"
            title="About & Legal"
            line="Who makes this, and the fine print"
            onClick={() => go("#/more/about")}
          />
          <Row
            id="updates"
            title="[HSV] Updates"
            line="Release notes: what's new in the app"
            cue={updatesCue}
            onClick={() => go("#/more/updates")}
          />
          <Row
            id="feedback"
            title="Leave Feedback"
            line="Bug reports, ideas, anything on your mind"
            onClick={() => go("#/more/feedback")}
          />
        </section>

        <section className="m-moregroup m-moregroup--end" aria-label="Session">
          {signedIn ? (
            <Row id="logout" title="Log Out" chevron={false} onClick={onLogout} />
          ) : (
            <Row id="signin" title="Sign in" chevron={false} onClick={onSignIn} />
          )}
        </section>

        <div className="m-more__foot">
          <span className="m-more__ver">{VERSION}</span> · Unofficial Fan Project
        </div>
      </div>
    </div>
  );
}
