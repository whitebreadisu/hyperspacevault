import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { SWUButton } from "./SWUButton";
import { UserMenu } from "./UserMenu";
import { formatVersionLabel } from "../utils/version";
import logoFull2x from "../assets/brand/hsv-logo-full@2x.webp";
import logoFull3x from "../assets/brand/hsv-logo-full@3x.webp";
import { TitleChooser } from "../mobile/TitleChooser";
import { useStashes } from "../stashes/StashContext";
import { NavPod } from "./NavPod";
import type { PodSub, PodTop } from "./NavPod";

const VERSION = formatVersionLabel(__APP_VERSION__);

// The views the shell shows (App.tsx). "cards" is the Vault's Collection and
// "stashes" the Vault's Stashes page (signed in, own vault only);
// "deck-check" sits under Decks; "new-arrivals" is [HSV] Updates; "shared"
// is the viewer-mode Vault for a shared link (App Spec §19.1). "settings"
// and "import-export" are reached from the avatar menu and the Vault's
// Import / Export button; no pod item is lit on them.
export type AppView =
  "cards" | "stashes" | "deck-check" | "settings" | "import-export" | "new-arrivals" | "shared";

interface Props {
  userEmail: string | null;
  onLogout: () => void;
  onSignIn: () => void;
  onChangePassword: () => void;
  onOpenSettings: () => void;
  /** Opens the About & Legal modal. The header has two of its openers: the
   * brand chooser's About & Legal button (the logo and tag line open the
   * chooser; anonymous + signed-in alike) and the UserMenu's
   * "About & Legal" item (signed-in only); the release-notes page's chip is
   * the third (App Spec §5.8). App owns the modal state either way, same as
   * onSignIn/onChangePassword above. */
  onOpenAbout: () => void;
  /** Opens the Leave Feedback modal. Visible for both anonymous
   * and signed-in visitors (rendered unconditionally below, unlike the
   * Sign In/UserMenu split it sits next to) -- App owns the modal state,
   * same pattern as onOpenAbout. */
  onOpenFeedback: () => void;
  /** Which App pane is active: it decides the pod's lit item and sub item
   * (NavPod.tsx). Defaults to "cards". */
  view?: AppView;
  /** Switches to the Vault's Collection (the Vault item, Collection, My vault). */
  onNavigateCards?: () => void;
  /** Opens the Stashes page, on one stash or (null) the page's default.
   * Signed in on the own vault only: the Stashes entries exist only while
   * the stash context is on (StashContext `enabled`). */
  onNavigateStashes?: (stashId: number | null) => void;
  /** Switches to the Deck Check pane (Decks and its Deck Check sub item).
   * Visible to anonymous visitors too -- DeckCheckPage itself gates the
   * auth-only content behind a sign-in prompt. Optional. */
  onNavigateDeckCheck?: () => void;
  /** Threaded straight through to UserMenu -- see its own doc comment.
   * Optional; when omitted, UserMenu's own default of `true` applies. */
  hasPasswordProvider?: boolean;
  /** Opens the "new-arrivals" release-notes view -- the brand chooser's
   * Updates button and the pod's [HSV] Updates item. Optional. */
  onOpenNotes?: () => void;
  /** Drives the [HSV] Updates item (shown while unread or the view) and its amber cue, plus the cream cue on the
   * brand tag line and the chooser's Updates button
   * (utils/releaseNotesSeen.ts's hasUnread()) -- App computes this once and
   * passes it down. Defaults to false. */
  hasUnread?: boolean;
  /** The active share's owner-chosen name (App Spec §19.1): while non-null
   * the Vault item lists it as a sub item. App derives it from
   * sessionStorage (utils/shareSession.ts) and only sets it once a resolve
   * has succeeded. Optional; null lists no share. */
  shareName?: string | null;
  /** Switches to the shared-vault pane. Optional, matching
   * onNavigateDeckCheck's shape. */
  onNavigateShared?: () => void;
}

/** The app header: brand column, the Command pod (NavPod.tsx), and
 * the top-right account slot. The account slot shows Sign In when
 * anonymous, replaced by the avatar dropdown menu once authenticated.
 * onLogout, onChangePassword, onOpenSettings and onOpenAbout all thread
 * through to UserMenu, so the menu's item list stays App-driven rather than
 * owning modal or pane state itself -- App owns the pane switch the way it
 * owns the modals. Delete Account is triggered from the Settings pane's
 * danger zone (SettingsPage), not from Header or UserMenu. */
export function Header({
  userEmail,
  onLogout,
  onSignIn,
  onChangePassword,
  onOpenSettings,
  onOpenAbout,
  onOpenFeedback,
  view = "cards",
  onNavigateCards,
  onNavigateStashes,
  onNavigateDeckCheck,
  hasPasswordProvider,
  onOpenNotes,
  hasUnread = false,
  shareName = null,
  onNavigateShared,
}: Props) {
  // Stash entries (the Stashes sub item, its menu): signed in, own vault.
  const stash = useStashes();
  const stashesOn = stash.enabled && !!userEmail && onNavigateStashes != null;
  const inShared = view === "shared";
  const top: PodTop =
    view === "cards" || view === "stashes" || view === "shared"
      ? "vault"
      : view === "deck-check"
        ? "decks"
        : view === "new-arrivals"
          ? "updates"
          : null;
  const toCards = () => onNavigateCards?.();
  const vaultSubs: PodSub[] = [];
  if (inShared) {
    // The shared vault shown: My vault · the share's name, amber.
    vaultSubs.push({ key: "own", label: "My vault", on: false, onClick: toCards });
  } else {
    vaultSubs.push({
      key: "collection",
      label: "Collection",
      on: view === "cards",
      onClick: toCards,
    });
    if (stashesOn)
      vaultSubs.push({
        key: "stashes",
        label: "Stashes",
        on: view === "stashes",
        onClick: () => onNavigateStashes?.(null),
        menu: true,
      });
  }
  if (shareName != null)
    vaultSubs.push({
      key: "shared",
      label: shareName,
      on: inShared,
      onClick: () => onNavigateShared?.(),
    });
  const decksSubs: PodSub[] = [
    {
      key: "deck-check",
      label: "Deck Check",
      on: view === "deck-check",
      onClick: () => onNavigateDeckCheck?.(),
    },
  ];
  const [chooser, setChooser] = useState(false);
  const closeChooser = useCallback(() => setChooser(false), []);

  return (
    <header className="app-header">
      <div className="app-header__brand">
        {/* The logo and the one-line tag under it are one button that opens
            the brand chooser (About & Legal / [HSV] Updates), as the phone's
            brand stack does: the header's only About entry for a signed-out
            visitor, and the permanent re-entry to Updates once the nav tab
            is gone. The tag line carries the unread cue. */}
        <button
          type="button"
          className="app-header__brand-link app-header__brand-btn"
          onClick={() => setChooser(true)}
          aria-haspopup="dialog"
          aria-label={`Hyperspace Vault, Unofficial Fan Project ${VERSION} - About & Legal and Updates`}
        >
          <img
            className="app-header__logo"
            src={logoFull2x}
            srcSet={`${logoFull2x} 2x, ${logoFull3x} 3x`}
            alt="Hyperspace Vault"
            width={158}
            height={46}
          />
          <span
            className={`app-header__brand-tag app-header__brand-line${
              hasUnread ? " app-header__brand-line--cue" : ""
            }`}
          >
            Unofficial Fan Project <span className="app-header__version">{VERSION}</span>
          </span>
        </button>
        {/* Portalled to <body>: the brand column's uppercase / text-shadow
            styling must not reach the dialog. */}
        {chooser
          ? createPortal(
              <TitleChooser
                desktop
                unread={hasUnread}
                onClose={closeChooser}
                onAbout={() => {
                  setChooser(false);
                  onOpenAbout();
                }}
                onUpdates={() => {
                  setChooser(false);
                  onOpenNotes?.();
                }}
              />,
              document.body
            )
          : null}
      </div>

      <nav className="app-header__nav" aria-label="Main">
        <NavPod
          top={top}
          vaultSubs={vaultSubs}
          decksSubs={decksSubs}
          onVault={inShared ? () => onNavigateShared?.() : toCards}
          onDecks={() => onNavigateDeckCheck?.()}
          onUpdates={() => onOpenNotes?.()}
          shared={inShared}
          unread={hasUnread}
          showUpdates={hasUnread || view === "new-arrivals"}
          stashes={stashesOn && !inShared ? stash.stashes : null}
          onOpenStash={(id) => onNavigateStashes?.(id)}
          onAllStashes={() => onNavigateStashes?.(null)}
        />
      </nav>

      <div className="app-header__account">
        {/* The app's standard SWUButton, same size="sm" as Sign In below, so
            there is exactly one button treatment in this slot (an accented
            fill would read as a second competing CTA next to Sign In). */}
        <SWUButton size="sm" onClick={onOpenFeedback}>
          Leave Feedback
        </SWUButton>
        {userEmail ? (
          <UserMenu
            userEmail={userEmail}
            onLogout={onLogout}
            onChangePassword={onChangePassword}
            onOpenSettings={onOpenSettings}
            onOpenAbout={onOpenAbout}
            hasPasswordProvider={hasPasswordProvider}
          />
        ) : (
          <SWUButton size="sm" onClick={onSignIn}>
            Sign In
          </SWUButton>
        )}
      </div>
    </header>
  );
}
