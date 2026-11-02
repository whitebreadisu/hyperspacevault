import { SWUButton } from "./SWUButton";
import { UserMenu } from "./UserMenu";
import { formatVersionLabel } from "../utils/version";

// "import-export" is a transient view -- reachable only via CardsPage's
// Import / Export button (verified users), never a permanent nav
// tab like "deck-check". See the `view` prop's doc comment and the nav
// render branch below for how it borrows the settings-view shape (way-back
// Vault button + one active tab) rather than joining the two-tab bar.
//
// "new-arrivals" is the release-notes view -- a real peer nav tab
// like "deck-check" (not the settings/import-export transient shape), except
// its tab is only ever RENDERED while unread content exists or it's the
// active view (see the `hasUnread` prop and the nav render branch below) --
// unlike Vault/Deck Check, which are always present.
//
// "shared" is the viewer-mode Vault for a shared link -- a peer nav tab
// like "new-arrivals", rendered only while a share session exists (see the
// `shareName` prop below), never gated by auth state (App Spec §19.1:
// anonymous viewers get the shared view too).
export type AppView =
  "cards" | "deck-check" | "settings" | "import-export" | "new-arrivals" | "shared";

interface Props {
  userEmail: string | null;
  onLogout: () => void;
  onSignIn: () => void;
  onChangePassword: () => void;
  onOpenSettings: () => void;
  /** Opens the About & Legal modal. The header has two of its openers: the
   * brand link below (anonymous + signed-in alike) and the UserMenu's
   * "About & Legal" item (signed-in only); the release-notes page's chip is
   * the third (App Spec §5.8). App owns the modal state either way, same as
   * onSignIn/onChangePassword above. */
  onOpenAbout: () => void;
  /** Opens the Leave Feedback modal. Visible for both anonymous
   * and signed-in visitors (rendered unconditionally below, unlike the
   * Sign In/UserMenu split it sits next to) -- App owns the modal state,
   * same pattern as onOpenAbout. */
  onOpenFeedback: () => void;
  /** Which App pane is active. On the settings view the nav becomes a
   * Vault *button* (the way back) plus an active Settings tab, so the
   * settings surface reads as a page with the same navigation furniture as
   * the rest of the app -- Settings itself stays reachable only via the
   * avatar menu, not a permanent tab. Defaults to "cards" (the plain
   * cards-view header).
   *
   * On the other views the nav is a bar of peer tabs: Vault and Deck Check
   * always, plus the conditional "[HSV] Updates" and shared-vault tabs. The
   * Vault tab's AppView id is "cards", and in-screen code keeps the
   * "Inventory" name (InventorySummary, api/inventory.ts, etc.); only the
   * nav label says Vault.
   *
   * "import-export" reuses the settings-view shape (way-back Vault button +
   * a single active tab) rather than the tab bar -- it's a transient tab,
   * only ever rendered while this view is active (never a permanent peer
   * of Vault/Deck Check), disappearing the moment the user navigates back
   * to Vault. */
  view?: AppView;
  onNavigateCards?: () => void;
  /** Switches to the Deck Check pane. Visible to anonymous visitors too
   * (Deck Check is a peer nav tab, not avatar-menu-gated like Settings) --
   * DeckCheckPage itself gates the auth-only content behind a sign-in
   * prompt, the same onRequestSignIn idiom CardsPage's anonymous controls
   * use. Optional. */
  onNavigateDeckCheck?: () => void;
  /** Threaded straight through to UserMenu -- see its own doc comment.
   * Optional; when omitted, UserMenu's own default of `true` applies. */
  hasPasswordProvider?: boolean;
  /** Opens the "new-arrivals" release-notes view -- the version label's
   * onClick always, and the "[HSV] Updates" nav item's onClick whenever
   * it's rendered (see `hasUnread` below). Optional, matching
   * onNavigateDeckCheck's shape. */
  onOpenNotes?: () => void;
  /** Drives BOTH the "[HSV] Updates" nav item's presence and the subtle
   * amber cue on it + the brand column's version label
   * (utils/releaseNotesSeen.ts's hasUnread()) -- App computes this once and
   * passes it down, rather than Header reaching into localStorage itself.
   * Defaults to false (no nav item, no cue) -- see showNewArrivalsTab below
   * for the `hasUnread || view === "new-arrivals"` visibility rule that
   * keeps the active tab from vanishing the instant it's opened and the
   * unread flag clears. */
  hasUnread?: boolean;
  /** The active share's owner-chosen name -- "the share's name appears as a
   * header item alongside Vault and Deck Check" (App Spec §19.1). App
   * derives this from sessionStorage (utils/shareSession.ts) rather than
   * Header reaching into storage itself, the same App-owns-the-state
   * pattern as `hasUnread` above. The nav item is rendered whenever this is
   * non-null (mirrors "whenever sessionStorage holds a share" -- App only
   * sets it once a resolve has actually succeeded, see App.tsx). Optional;
   * null renders no item. */
  shareName?: string | null;
  /** Switches to the shared-vault pane. Optional, matching
   * onNavigateDeckCheck's shape. */
  onNavigateShared?: () => void;
}

/** The app header: brand column, the nav tab bar (see the `view` prop's
 * doc comment above for the settings / import-export special case), and
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
  onNavigateDeckCheck,
  hasPasswordProvider,
  onOpenNotes,
  hasUnread = false,
  shareName = null,
  onNavigateShared,
}: Props) {
  // The nav item stays visible while unread OR while it's the
  // active view -- the latter half is what keeps it from vanishing the
  // instant App clears the unread flag on open (see App.tsx's onOpenNotes).
  const showNewArrivalsTab = hasUnread || view === "new-arrivals";
  // Unlike showNewArrivalsTab above, presence alone (no `|| view
  // === "shared"` fallback needed) already covers both "away" and "active"
  // identically -- shareName only clears when the session itself is gone
  // (App never clears it just because the view navigated elsewhere).
  const showSharedTab = shareName != null;

  return (
    <header className="app-header">
      <div className="app-header__brand">
        {/* [HSV] shorthand is part of the brand system -- bracketed prefix
            on the wordmark, mirrored by the nav tab's "[HSV] Updates" and
            the version label's bracketed suffix. The wordmark IS the About
            link -- one button with the disclaimer line inside it, hover
            animating both lines together. */}
        <button type="button" className="app-header__brand-link" onClick={onOpenAbout}>
          [HSV] Hyperspace Vault
          <span className="app-header__brand-tag">Unofficial Fan Project</span>
        </button>
        {/* Version label, the second item in the brand column, below the
         * wordmark button -- same flex-column/gap layout idiom, visible for
         * anonymous visitors too. Permanent re-entry point to the notes view
         * even after the nav item (below) is gone; carries the same unread
         * cue class while hasUnread is true. */}
        <button
          type="button"
          className={`app-header__version${hasUnread ? " app-header__version--cue" : ""}`}
          onClick={onOpenNotes}
        >
          {formatVersionLabel(__APP_VERSION__)}
          {/* The label says what the click does -- "Release Notes" rides
              after the number in smaller text, one
              button, one link target. */}
          <span className="app-header__version-sub">[Release Notes]</span>
        </button>
      </div>

      <nav className="app-header__nav">
        {/* Settings and import-export share one shape (way-back Vault button
            + one active tab; see the `view` prop's doc comment above) --
            only the active tab's label differs. Every other view renders
            the peer-tab bar: "[HSV] Updates" (leftmost, CONDITIONAL -- see
            showNewArrivalsTab above), Vault, Deck Check, then the
            conditional shared-vault tab. */}
        {view === "settings" || view === "import-export" ? (
          <>
            <button type="button" className="nav-tab" onClick={onNavigateCards}>
              Vault
            </button>
            <span className="nav-tab nav-tab--active">
              {view === "settings" ? "Settings" : "Import / Export"}
            </span>
          </>
        ) : (
          <>
            {showNewArrivalsTab && (
              <button
                type="button"
                className={`nav-tab${view === "new-arrivals" ? " nav-tab--active" : ""}${
                  hasUnread ? " nav-tab--cue" : ""
                }`}
                onClick={onOpenNotes}
              >
                [HSV] Updates
              </button>
            )}
            <button
              type="button"
              className={`nav-tab${view === "cards" ? " nav-tab--active" : ""}`}
              onClick={onNavigateCards}
            >
              Vault
            </button>
            <button
              type="button"
              className={`nav-tab${view === "deck-check" ? " nav-tab--active" : ""}`}
              onClick={onNavigateDeckCheck}
            >
              Deck Check
            </button>
            {/* The share's OWNER-CHOSEN name IS the label (App Spec §19.1) --
                no generic "Shared with me" text (see the `shareName` prop's
                own doc comment). */}
            {showSharedTab && (
              <button
                type="button"
                className={`nav-tab${view === "shared" ? " nav-tab--active" : ""}`}
                onClick={onNavigateShared}
              >
                {shareName}
              </button>
            )}
          </>
        )}
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
