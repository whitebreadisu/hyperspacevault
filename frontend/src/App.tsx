import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Header } from "./components/Header";
import type { AppView } from "./components/Header";
import { SectionSeparator } from "./components/SectionSeparator";
import { VerifyEmailBanner } from "./components/VerifyEmailBanner";
import { CardsPage } from "./screens/cards/CardsPage";
import { DeckCheckPage } from "./screens/deckcheck/DeckCheckPage";
import { SettingsPage } from "./screens/settings/SettingsPage";
import { ImportExportPage } from "./screens/importexport/ImportExportPage";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LimitsProvider } from "./context/LimitsContext";
import { hasPasswordProvider } from "./utils/googleAuth";
import { applyHeaderStarfield } from "./utils/headerStarfield";
import { AuthModal } from "./screens/auth/AuthModal";
import { ChangePasswordModal } from "./screens/auth/ChangePasswordModal";
import { DeleteAccountModal } from "./screens/auth/DeleteAccountModal";
import { VerifyEmailAction } from "./screens/auth/VerifyEmailAction";
import { AboutModal } from "./screens/about/AboutModal";
import { FeedbackModal } from "./screens/feedback/FeedbackModal";
import { NewArrivalsPage } from "./screens/notes/NewArrivalsPage";
import { SharedVaultPage } from "./screens/shared/SharedVaultPage";
import { RELEASE_NOTES } from "./content/releaseNotes";
import { hasUnread, latestEntryKey, saveLastSeenKey } from "./utils/releaseNotesSeen";
import { loadShareSession, saveShareSession } from "./utils/shareSession";
import { parseShareRouteToken } from "./utils/shareRoute";
import { bootSignupParam, clearSignupParam, parseCardParam } from "./utils/cardParam";
import { markAppSeen } from "./utils/appSeen";
import { capture } from "./analytics/analytics";
import { MobileApp } from "./mobile/MobileApp";
import { useIsPhone } from "./mobile/useIsPhone";
import { StashProvider } from "./stashes/StashContext";

/** The app does not gate on auth: anonymous visitors get the same shell
 * (Header + the Cards list) as signed-in users, and sign-in is a modal
 * opened from the header's Sign In control (ADR-0008 covers the anonymous
 * catalog reads). Every shell-level modal's open state (auth, change
 * password, delete account, About & Legal, Leave Feedback) lives here, not
 * in Header/UserMenu, and each renders as a sibling of Header rather than
 * nested inside it. Screen-level modals (Add Cards, Share) belong to
 * CardsPage.
 * Delete Account's trigger is in the Settings pane's danger zone
 * (SettingsPage's onDeleteAccount prop below); the modal itself is App-owned
 * like the other shell-level modals. DeleteAccountModal needs no explicit post-success handling
 * here: Firebase's deleteUser() fires onAuthStateChanged with null, `user`
 * becomes null, and this component re-renders into the anonymous shell on
 * its own -- the modal just calls its own onClose.
 *
 * signupInFlight suppresses the auto-close effect below for exactly one auth
 * transition -- AuthModal calls onSignedUp() synchronously, before it even
 * calls createUserWithEmailAndPassword, so the flag is guaranteed set before
 * Firebase's onAuthStateChanged notification can land (ordering a
 * `user`-value effect dependency alone can't guarantee). It resets when the
 * modal actually closes (via its own Continue/close/Escape/backdrop paths,
 * all of which call onClose), so it never leaks into a later, unrelated auth
 * transition.
 *
 * googleLinkedInFlight is the same suppression mechanism for AuthModal's
 * other own-screen-after-auth-resolves case -- the ADR-0016 §1 "linked to an
 * existing account" notice shown after a Google sign-in auto-links onto a
 * password account. AuthModal calls onGoogleLinked() right before it flips
 * to that notice screen, the same ordering guarantee onSignedUp relies on. */
function AppContent() {
  const { user, loading, logout, emailVerified } = useAuth();
  // Phone-width viewports render the mobile app instead (App Spec §25).
  const isPhone = useIsPhone();
  // `signup=1` at boot (a public card page's "Create free account"): the
  // sign-in dialog opens in create-account mode, beside any `?card=` popup,
  // and the parameter leaves the address bar. The phone tree reads it in
  // MobileApp.
  const [bootSignup] = useState(() => !isPhone && bootSignupParam());
  const [authModalOpen, setAuthModalOpen] = useState(bootSignup);
  const [authMode, setAuthMode] = useState<"login" | "signup">(bootSignup ? "signup" : "login");
  useEffect(() => {
    if (bootSignup) clearSignupParam();
  }, [bootSignup]);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
  // About & Legal modal -- reachable three ways (App Spec §5.8): Header's
  // tag-line "Unofficial Fan Project" button (anonymous + signed-in),
  // UserMenu's "About & Legal" item (signed-in only) and NewArrivalsPage's
  // "About & Legal" chip.
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  // Leave Feedback modal -- reachable from the header's Leave Feedback button
  // for both anonymous and signed-in visitors.
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  // Whether an unseen release-notes entry exists -- computed once at mount
  // from localStorage (utils/releaseNotesSeen.ts's hasUnread), then owned as
  // App state so opening the notes view (openNotes below) can clear it
  // everywhere it's consumed (Header's nav-tab cue + version-label cue) in
  // the same render, rather than each consumer re-reading storage itself.
  const [notesUnread, setNotesUnread] = useState(() => hasUnread(RELEASE_NOTES));
  // The tab's current share session (App Spec §19.1) -- token + owner-chosen
  // name, or null. Initialized from sessionStorage (utils/shareSession.ts)
  // so a share opened earlier in this tab survives a full-app remount
  // (e.g. a hard refresh while on some other view); the mount effect below
  // (which reads the CURRENT URL, not this initial state) is what handles
  // freshly opening a `/shared/{token}` link, including replacing whatever
  // was already stored ("newest share replaces the previous"). shareName is
  // split out as its own piece of state (rather than reading
  // shareSession?.name inline everywhere) only because Header's `shareName`
  // prop wants a plain string -- shareToken and shareName always change
  // together, see setShareSession below.
  const [shareToken, setShareToken] = useState<string | null>(
    () => loadShareSession()?.token ?? null
  );
  const [shareName, setShareName] = useState<string | null>(() => loadShareSession()?.name ?? null);
  const [signupInFlight, setSignupInFlight] = useState(false);
  // See AppContent's doc comment above.
  const [googleLinkedInFlight, setGoogleLinkedInFlight] = useState(false);
  // Which pane the shell shows. The app has no router -- panes are App
  // state, kept mounted with the inactive one display:none'd (so CardsPage's
  // filters/scroll survive a settings/deck-check visit). Settings is only
  // reachable from the avatar menu (authenticated); the effect below snaps
  // back to Cards on sign-out so an anonymous shell can never sit on the
  // settings pane.
  //
  // Deck Check is a peer top-level nav tab (unlike Settings), so it IS
  // reachable while anonymous -- clicking it shows DeckCheckPage's own
  // sign-in gate (the same onRequestSignIn idiom CardsPage's anonymous
  // controls use) rather than silently doing nothing. `view` below therefore
  // forces anonymous visitors back to "cards" only out of "settings" and
  // "import-export" -- "deck-check" passes through unchanged.
  //
  // "import-export" mirrors the settings forcing rule (no anonymous entry
  // point at all -- CardsPage's Import / Export button routes anonymous
  // clicks to onRequestSignIn instead of this view, same as Add Cards) and
  // ALSO forces out signed-in-but-unverified users: import/export is gated
  // on verified email (App Spec §17.3), while Settings stays ungated.
  const [activeView, setActiveView] = useState<AppView>("cards");

  // Opens the "New Arrivals" view from either entry point (Header's nav tab
  // and its version label share this one handler). Marks the latest entry
  // seen immediately -- before the view switch even -- so the cue clears in
  // the same click that opens the view, rather than waiting on the notes
  // screen's own mount. No anonymous guard: unlike settings/import-export,
  // this view has no gated content.
  function openNotes() {
    const latest = latestEntryKey(RELEASE_NOTES);
    if (latest != null) saveLastSeenKey(latest);
    setNotesUnread(false);
    setActiveView("new-arrivals");
  }

  // Bridges CardsPage's quantities refetch to ImportExportPage's "Refreshing
  // your Vault…" busy-overlay stage -- CardsPage stays mounted the whole
  // time (display:none, not unmounted, see the pane wrappers below), so a
  // ref is enough; a plain useState would re-render AppContent on every
  // CardsPage auth-driven identity change for no reason, since nothing here
  // ever reads the function itself for rendering. See CardsPage's
  // onQuantitiesRefreshReady prop doc comment for the other half of this
  // wiring.
  const quantitiesRefreshRef = useRef<() => Promise<void>>(async () => {});
  const registerQuantitiesRefresh = useCallback((fn: () => Promise<void>) => {
    quantitiesRefreshRef.current = fn;
  }, []);

  // Pick the header starfield once per app open (no-repeat-of-last;
  // see utils/headerStarfield.ts). Mount-only by design -- the art must not
  // change mid-session on re-renders or auth transitions.
  useEffect(() => {
    applyHeaderStarfield();
  }, []);

  useEffect(() => {
    if (!user) setActiveView("cards");
  }, [user]);

  // Opening a share link always (re)establishes it, and the newest share
  // replaces the previous (App Spec §19.1). Mirrors VerifyEmailAction's
  // "reads window.location once at boot" idiom (this app is deliberately
  // router-less) -- UNLIKE that component, this reads a real, bookmarkable
  // path (not a one-time action code), so the URL is intentionally left
  // untouched afterward (no history.replaceState): a refresh on
  // `/shared/{token}` is expected to land back on the shared vault, not
  // silently strip the route. Declared AFTER the anon-guard effect above so
  // its `setActiveView("shared")` is the one that wins when both fire in
  // the same mount flush (the anon-guard's `!user` branch is a no-op for a
  // resolved signed-in user, so there's no conflict on that path either --
  // only an already-anonymous boot exercises the ordering at all, and
  // "shared" is what should win there). Mount-only by design: a share
  // opened via the header tab later in the session goes through
  // handleShareResolved/setActiveView directly, not this route parse.
  useEffect(() => {
    const routeToken = parseShareRouteToken(window.location.pathname);
    if (!routeToken) return;
    setShareToken(routeToken);
    // Unknown until SharedVaultPage's own resolve completes -- clears any
    // stale name a PREVIOUS share session left behind, so the header tab
    // doesn't flash the old name while the new token resolves.
    setShareName(null);
    setActiveView("shared");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `/?card=sor-005` (design note §9 "Optional extra"; a public card page's
  // prev / next arrows link here): read once at boot, the same idiom as the
  // share route above, and handed to the own Vault's CardsPage, which opens
  // that card's popup once the catalogue is in and then drops the parameter
  // (history.replaceState). Only on `/` -- a share link keeps its own route.
  // The phone tree reads it in MobileApp. Absent or malformed = null =
  // today's behaviour.
  const [bootCard] = useState(() =>
    window.location.pathname === "/" ? parseCardParam(window.location.search) : null
  );

  /** Reported by SharedVaultPage once GET /api/shared/{token}
   * succeeds -- persists the session (sessionStorage) and hands the name to
   * Header. Stable identity (empty deps) is required, not just tidy:
   * SharedVaultPage's own resolve effect depends on this callback, and an
   * identity that changed every App render would re-trigger that effect
   * (and re-resolve) on every unrelated App re-render. Takes `token`
   * explicitly rather than closing over `shareToken` state for the same
   * reason -- closing over it would pull `shareToken` into this callback's
   * deps and break the same stability guarantee. */
  const handleShareResolved = useCallback((resolvedToken: string, name: string) => {
    setShareName(name);
    saveShareSession({ token: resolvedToken, name });
  }, []);

  // Successful login updates `user` via onAuthStateChanged; close the modal
  // here rather than in the modal itself, so it closes regardless of *how*
  // auth resolved (this effect is the single source of truth) -- except
  // mid-signup or after a Google auto-link, where the modal owns its own
  // follow-up screen ("check your email" / the linked-account notice) and
  // closes only when the user dismisses it.
  useEffect(() => {
    if (user && !signupInFlight && !googleLinkedInFlight) {
      setAuthModalOpen(false);
      setAuthMode("login");
    }
  }, [user, signupInFlight, googleLinkedInFlight]);

  // The settings view is forced back to "cards" for an anonymous visitor --
  // it has no anonymous-reachable entry point at all (avatar-menu-only), so
  // defensively guarding it here matches that. The "deck-check" view passes
  // through unchanged: DeckCheckPage renders its own sign-in gate for
  // anonymous visitors, the same way CardsPage's anonymous controls do.
  //
  // "import-export" gets the same anonymous guard as "settings", PLUS a
  // second guard forcing it back to "cards" for a signed-in but unverified
  // user -- the one view-forcing rule in this app that reads emailVerified,
  // since import/export (unlike Settings) is gated on it.
  const view: AppView =
    !user && (activeView === "settings" || activeView === "import-export")
      ? "cards"
      : user && !emailVerified && activeView === "import-export"
        ? "cards"
        : activeView;

  // screen_viewed (App Spec §22): tracks the EFFECTIVE pane (post-forcing
  // `view`, not raw activeView -- a forced-back-to-cards visitor viewed
  // cards). Taxonomy names, not AppView ids: the analytics contract survives
  // any AppView rename. `shared` also has its own share_link_viewed event;
  // it still emits screen_viewed here so the screen denominator stays
  // complete. Sits above the loading early-return (rules-of-hooks); the
  // in-effect loading guard keeps the first emit on the first *rendered*
  // pane, not the loading splash.
  useEffect(() => {
    // The phone tree emits its own screen_viewed (mobile/phoneAnalytics.ts);
    // skip it here so a phone boot counts one view.
    if (loading || isPhone) return;
    const screenByView: Record<AppView, string> = {
      cards: "vault",
      "deck-check": "deck_check",
      "new-arrivals": "new_arrivals",
      shared: "shared_view",
      settings: "settings",
      "import-export": "import_export",
    };
    capture("screen_viewed", { screen: screenByView[view] });
  }, [view, loading, isPhone]);

  if (loading) {
    return <p className="loading-text">Loading…</p>;
  }

  // Share links render the phone tree too; MobileApp reads the
  // /shared/{token} path and the tab's session (App Spec §25.6).
  if (isPhone) return <MobileApp />;

  // the caller's own stashes -- signed in only, fetched and exposed
  // on the own vault only; paused (kept, not refetched) while the shared
  // vault pane shows.
  return (
    <StashProvider enabled={!!user} paused={view === "shared"}>
      <div className="app-layout">
        <Header
          userEmail={user?.email ?? null}
          onLogout={logout}
          onSignIn={() => setAuthModalOpen(true)}
          onChangePassword={() => setChangePasswordModalOpen(true)}
          onOpenSettings={() => setActiveView("settings")}
          onOpenAbout={() => setAboutModalOpen(true)}
          onOpenFeedback={() => setFeedbackModalOpen(true)}
          view={view}
          onNavigateCards={() => setActiveView("cards")}
          onNavigateDeckCheck={() => setActiveView("deck-check")}
          hasPasswordProvider={hasPasswordProvider(user)}
          onOpenNotes={openNotes}
          hasUnread={notesUnread}
          shareName={shareName}
          onNavigateShared={() => setActiveView("shared")}
        />
        <VerifyEmailBanner />
        <SectionSeparator />
        <main className="app-main">
          {/* display:contents keeps each pane wrapper out of the flex layout
            while visible (CardsPage's .screen is a direct flex child of
            .app-main by design); display:none hides the inactive pane
            without unmounting it. */}
          <div style={{ display: view === "cards" ? "contents" : "none" }}>
            <CardsPage
              isAuthenticated={!!user}
              onRequestSignIn={() => setAuthModalOpen(true)}
              isEmailVerified={emailVerified}
              onOpenImportExport={() => setActiveView("import-export")}
              onQuantitiesRefreshReady={registerQuantitiesRefresh}
              openCardOnLoad={bootCard}
              popupKeysSuspended={authModalOpen}
            />
          </div>
          {/* DeckCheckPage is always mounted (like CardsPage above), never
            gated by `user &&` (unlike SettingsPage below) -- an anonymous
            visitor can select the Deck Check tab and see its own sign-in
            prompt, matching the peer-nav framing (a real tab, not an
            authenticated-only page that silently doesn't exist). */}
          <div style={{ display: view === "deck-check" ? "contents" : "none" }}>
            <DeckCheckPage
              isAuthenticated={!!user}
              onRequestSignIn={() => setAuthModalOpen(true)}
            />
          </div>
          {/* NewArrivalsPage is always mounted too (like CardsPage/
            DeckCheckPage above), never gated by `user &&` -- reachable
            anonymous, no sign-in gate of its own to render (static content
            from content/releaseNotes.ts, nothing to fetch; App Spec §20). */}
          <div style={{ display: view === "new-arrivals" ? "contents" : "none" }}>
            <NewArrivalsPage onOpenAbout={() => setAboutModalOpen(true)} />
          </div>
          {/* Mounted only once there's a token to show (mirrors the
            `{user && ...}` gating Settings/ImportExport use below for their
            own "nothing to mount yet" case), then display-toggled like
            every other pane above so its OWN filter/scroll state stays
            independent of CardsPage's own-Vault instance (App Spec §19.1)
            once both have been visited in the same tab. Never gated by
            `user &&` -- reachable anonymous, same as CardsPage/
            DeckCheckPage/NewArrivalsPage above (§19.1: no viewer accounts;
            anonymous viewers see the share). */}
          {shareToken && (
            <div style={{ display: view === "shared" ? "contents" : "none" }}>
              <SharedVaultPage token={shareToken} onResolved={handleShareResolved} />
            </div>
          )}
          {user && (
            <div style={{ display: view === "settings" ? "contents" : "none" }}>
              {/* Delete Account's trigger is this pane's danger zone; the
                modal itself is App-owned (deleteAccountModalOpen). */}
              <SettingsPage onDeleteAccount={() => setDeleteAccountModalOpen(true)} />
            </div>
          )}
          {/* App Spec §17.3: mounted only once user && emailVerified, like
            SettingsPage above is mounted only once `user` -- the whole
            surface is gated on verified email (import AND export), so
            there's nothing for this pane to fetch/render until both hold.
            Unlike DeckCheckPage (always mounted, renders its own gate),
            this pane never renders an in-place sign-in/verify prompt of its
            own -- CardsPage's Import / Export button is the only entry
            point, and it never calls onOpenImportExport unless already
            verified (see its own doc comment). */}
          {user && emailVerified && (
            <div style={{ display: view === "import-export" ? "contents" : "none" }}>
              <ImportExportPage
                onBackToVault={() => setActiveView("cards")}
                onImported={() => quantitiesRefreshRef.current()}
              />
            </div>
          )}
        </main>
        {authModalOpen && (
          <AuthModal
            initialMode={authMode}
            onClose={() => {
              setSignupInFlight(false);
              setGoogleLinkedInFlight(false);
              setAuthModalOpen(false);
              setAuthMode("login");
            }}
            onSignedUp={() => setSignupInFlight(true)}
            onGoogleLinked={() => setGoogleLinkedInFlight(true)}
          />
        )}
        {changePasswordModalOpen && (
          <ChangePasswordModal onClose={() => setChangePasswordModalOpen(false)} />
        )}
        {deleteAccountModalOpen && (
          <DeleteAccountModal onClose={() => setDeleteAccountModalOpen(false)} />
        )}
        {aboutModalOpen && <AboutModal onClose={() => setAboutModalOpen(false)} />}
        {feedbackModalOpen && <FeedbackModal onClose={() => setFeedbackModalOpen(false)} />}
        {/* Mounted unconditionally (renders null unless the URL carries a
          Firebase action link's mode/oobCode params) -- placed after the
          `loading` gate above returns, so auth.currentUser is already
          settled by the time its effect reads it. onRequestSignIn mirrors
          CardsPage's onRequestSignIn wiring above -- lets the password-reset
          success/invalid-code screens hand the user back to AuthModal
          without VerifyEmailAction owning any modal-open state of its own. */}
        <VerifyEmailAction onRequestSignIn={() => setAuthModalOpen(true)} />
      </div>
    </StashProvider>
  );
}

function App() {
  // Every boot, either tree: the marker a public card page reads to open
  // its card here instead (utils/appSeen.ts, App Spec §5.3).
  useEffect(() => markAppSeen(), []);
  return (
    <AuthProvider>
      <LimitsGate>
        <AppContent />
      </LimitsGate>
    </AuthProvider>
  );
}

/** Bridges AuthContext to LimitsProvider (which takes isAuthenticated
 * as a prop rather than reading useAuth itself, keeping it standalone-
 * testable). Sits between the two providers so everything inside AppContent
 * -- the settings pane, Add Cards, the inventory popup -- shares one
 * fetched limits matrix. */
function LimitsGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <LimitsProvider isAuthenticated={!!user}>{children}</LimitsProvider>;
}

export default App;
