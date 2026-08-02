import { SWUButton } from "./SWUButton";
import { UserMenu } from "./UserMenu";
import { formatVersionLabel } from "../utils/version";

// BL-54 S3 (§8.1): "import-export" is a transient view -- reachable only via
// CardsPage's Import / Export button (verified users), never a permanent nav
// tab like "deck-check". See the `view` prop's doc comment and the nav
// render branch below for how it borrows the settings-view shape (way-back
// Vault button + one active tab) rather than joining the two-tab bar.
//
// BL-184: "new-arrivals" is the release-notes view -- a real peer nav tab
// like "deck-check" (not the settings/import-export transient shape), except
// its tab is only ever RENDERED while unread content exists or it's the
// active view (see the `hasUnread` prop and the nav render branch below) --
// unlike Vault/Deck Check, which are always present.
export type AppView = "cards" | "deck-check" | "settings" | "import-export" | "new-arrivals";

interface Props {
  userEmail: string | null;
  onLogout: () => void;
  onSignIn: () => void;
  onChangePassword: () => void;
  onOpenSettings: () => void;
  /** BL-125: opens the About & Legal modal. Reachable from both the header
   * brand-line microcopy below (anonymous + signed-in alike) and the
   * UserMenu's "About & Legal" item (signed-in only) -- App owns the modal
   * state either way, same as onSignIn/onChangePassword above. */
  onOpenAbout: () => void;
  /** BL-126: opens the Leave Feedback modal. Visible for both anonymous
   * and signed-in visitors (rendered unconditionally below, unlike the
   * Sign In/UserMenu split it sits next to) -- App owns the modal state,
   * same pattern as onOpenAbout. */
  onOpenFeedback: () => void;
  /** BL-25: which App pane is active. On the settings view the nav becomes
   * a Vault *button* (the way back) plus an active Settings tab, so the
   * settings surface reads as a page with the same navigation furniture as
   * the rest of the app -- Settings itself stays reachable only via the
   * avatar menu, not a permanent tab (BL-142 left that shape alone).
   * Defaults keep pre-BL-25 call sites (and Header's dedicated tests)
   * rendering the plain cards-view header unchanged.
   *
   * BL-142: on the cards/deck-check views, the nav is now two real peer
   * tabs -- Vault and Deck Check -- the app's first genuine multi-view
   * navigation (previously a single non-interactive label, BL-129 R3:
   * "Cards" -> "Inventory"). BL-143 (rides the same nav change): the Vault
   * tab's label is the only thing that changed for that rename -- the
   * AppView id stays "cards" and every in-screen "Inventory" reference
   * (InventorySummary, api/inventory.ts, etc.) is untouched.
   *
   * BL-54 S3 (§8.1 P10): "import-export" reuses the settings-view shape
   * (way-back Vault button + a single active tab) rather than the two-tab
   * bar -- it's a transient tab, only ever rendered while this view is
   * active (never a permanent peer of Vault/Deck Check), disappearing the
   * moment the user navigates back to Vault. */
  view?: AppView;
  onNavigateCards?: () => void;
  /** BL-142: switches to the Deck Check pane. Visible to anonymous visitors
   * too (Deck Check is a peer nav tab, not avatar-menu-gated like Settings)
   * -- DeckCheckPage itself gates the auth-only content behind a sign-in
   * prompt, the same onRequestSignIn idiom CardsPage's anonymous controls
   * already use. Optional so existing call sites/tests are unaffected. */
  onNavigateDeckCheck?: () => void;
  /** BL-118 / ADR-0016 §3: threaded straight through to UserMenu -- see its
   * own doc comment. Optional, defaults through to UserMenu's own default of
   * `true`, so this stays a no-op for every pre-existing call site. */
  hasPasswordProvider?: boolean;
  /** BL-184: opens the "New Arrivals" release-notes view -- the version
   * label's onClick always, and the nav item's onClick whenever it's
   * rendered (see `hasUnread` below). Optional, matching
   * onNavigateDeckCheck's shape, so every pre-existing call site/test
   * renders unchanged without wiring it. */
  onOpenNotes?: () => void;
  /** BL-184: drives BOTH the "New Arrivals" nav item's presence and the
   * subtle amber cue on it + the footer version label
   * (utils/releaseNotesSeen.ts's hasUnread()) -- App computes this once and
   * passes it down, rather than Header reaching into localStorage itself.
   * Defaults to false, so a pre-existing call site that doesn't wire it
   * renders exactly as before (no nav item, no cue) -- see the nav render
   * branch below for the `hasUnread || view === "new-arrivals"` visibility
   * rule that keeps the active tab from vanishing the instant it's opened
   * and the unread flag clears. */
  hasUnread?: boolean;
}

/** BL-56 §5.5: the Catalog/Inventory tab toggle collapsed to a single label
 * when the app still had only one view; BL-142 reopens it into a real
 * two-tab bar (Vault / Deck Check) now that Deck Check is a second peer
 * view -- see the `view` prop's doc comment above for the settings-view
 * special case. The top-right account slot shows Sign In when anonymous,
 * replaced by the avatar dropdown menu once authenticated (BL-22 evolved
 * this from the earlier inline email + Log Out; BL-23 threads
 * onChangePassword through the same way onLogout already was, so the
 * avatar-menu item list stays App-driven rather than owning modal state
 * itself; BL-25 threads onOpenSettings identically -- App owns the pane
 * switch the way it owns the modals. BL-87's Delete Account item followed
 * the same pattern until BL-129 R5 relocated its trigger to the Settings
 * pane's danger zone -- onDeleteAccount no longer threads through
 * Header/UserMenu at all; the modal itself stays App-owned, just triggered
 * from SettingsPage now). */
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
}: Props) {
  // BL-184: the nav item stays visible while unread OR while it's the
  // active view -- the latter half is what keeps it from vanishing the
  // instant App clears the unread flag on open (see App.tsx's onOpenNotes).
  const showNewArrivalsTab = hasUnread || view === "new-arrivals";

  return (
    <header className="app-header">
      <div className="app-header__brand">
        HyperspaceVault
        {/* BL-125: permanent, low-key non-affiliation entry point -- visible
         * regardless of auth state, unlike the UserMenu item below which
         * only exists once signed in. */}
        <button type="button" className="app-header__brand-tag" onClick={onOpenAbout}>
          Unofficial Fan Project
        </button>
        {/* BL-184: version label, appended as a third item in the brand
         * column below the disclaimer tag -- same flex-column/gap layout
         * idiom, visible for anonymous visitors too. Permanent re-entry
         * point to the notes view even after the nav item (below) is gone;
         * carries the same unread cue class while hasUnread is true. */}
        <button
          type="button"
          className={`app-header__version${hasUnread ? " app-header__version--cue" : ""}`}
          onClick={onOpenNotes}
        >
          {formatVersionLabel(__APP_VERSION__)}
        </button>
      </div>

      <nav className="app-header__nav">
        {/* BL-143: "Inventory" -> "Vault" (nav label only -- the AppView id
            stays "cards", every in-screen "Inventory" reference is
            untouched). BL-142: the cards/deck-check views now render two
            real peer tabs instead of the old single non-interactive label;
            the settings view keeps its own shape (way-back button + active
            Settings tab), unchanged apart from the rename. BL-54 S3:
            import-export borrows that exact settings-view shape too (see
            the `view` prop's doc comment above) -- only the active tab's
            label differs. BL-184: "New Arrivals" joins this same two-tab
            branch (not the settings-shape branch) as a third, leftmost,
            CONDITIONALLY-rendered peer tab -- see showNewArrivalsTab above. */}
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
                New Arrivals
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
          </>
        )}
      </nav>

      <div className="app-header__account">
        {/* BL-129 R4b (Jeremy's 2026-07-14 dev review): the custom accented
            pill (solid --color-primary fill) shipped in R4 read as a second
            competing CTA next to Sign In -- dropped in favor of the app's
            standard SWUButton, same size="sm" as Sign In below, so there is
            exactly one button treatment in this slot. */}
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
