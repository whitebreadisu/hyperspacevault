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
import { RELEASE_NOTES } from "./content/releaseNotes";
import { hasUnread, latestEntryKey, saveLastSeenKey } from "./utils/releaseNotesSeen";

/** BL-56 §5.5: the app no longer gates on auth -- anonymous visitors get the
 * same shell (Header + unified Cards list) as signed-in users. Auth becomes a
 * modal opened from the header's Sign In control, not a full-screen block.
 * BL-23 follows the identical pattern for the avatar menu's Change Password
 * item: modal-open state lives here, not in Header/UserMenu, and each modal
 * renders as a sibling of Header rather than nested inside it -- kept
 * consistent with how authModalOpen/AuthModal already work below.
 * DeleteAccountModal (BL-87) follows the same App-owns-the-modal-state shape
 * but BL-129 R5 moved its *trigger* out of the avatar menu into the Settings
 * pane's danger zone (SettingsPage's onDeleteAccount prop below) -- the
 * modal itself is still a sibling of Header, unchanged. DeleteAccountModal
 * needs no explicit post-success handling here: Firebase's deleteUser()
 * fires onAuthStateChanged with null, `user` becomes null, and this
 * component re-renders into the anonymous shell on its own -- the modal
 * just calls its own onClose.
 *
 * BL-16: signupInFlight suppresses the auto-close effect below for exactly
 * one auth transition -- AuthModal calls onSignedUp() synchronously, before
 * it even calls createUserWithEmailAndPassword, so the flag is guaranteed
 * set before Firebase's onAuthStateChanged notification can land (ordering
 * a `user`-value effect dependency alone can't guarantee). It resets when
 * the modal actually closes (via its own Continue/close/Escape/backdrop
 * paths, all of which already call onClose), so it never leaks into a later,
 * unrelated auth transition.
 *
 * BL-118: googleLinkedInFlight is the same suppression mechanism for
 * AuthModal's other own-screen-after-auth-resolves case -- the ADR-0016 §1
 * "linked to an existing account" notice shown after a Google sign-in
 * auto-links onto a password account. AuthModal calls onGoogleLinked() right
 * before it flips to that notice screen, the same ordering guarantee
 * onSignedUp relies on. */
function AppContent() {
  const { user, loading, logout, emailVerified } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
  // BL-125: About & Legal modal state, following the exact same
  // App-owns-the-modal-state pattern as authModalOpen/changePasswordModalOpen
  // above -- reachable from both Header's brand-line microcopy (anonymous +
  // signed-in) and UserMenu's "About & Legal" item (signed-in only).
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  // BL-126: Leave Feedback modal state, same App-owns-the-modal-state
  // pattern as aboutModalOpen above -- reachable from the header's Leave
  // Feedback button for both anonymous and signed-in visitors.
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  // BL-184: whether an unseen release-notes entry exists -- computed once at
  // mount from localStorage (utils/releaseNotesSeen.ts's hasUnread), then
  // owned as App state so opening the notes view (openNotes below) can clear
  // it everywhere it's consumed (Header's nav-tab cue + version-label cue)
  // in the same render, rather than each consumer re-reading storage itself.
  const [notesUnread, setNotesUnread] = useState(() => hasUnread(RELEASE_NOTES));
  const [signupInFlight, setSignupInFlight] = useState(false);
  // BL-118: see AppContent's doc comment above.
  const [googleLinkedInFlight, setGoogleLinkedInFlight] = useState(false);
  // BL-25: which pane the shell shows. The app has no router -- panes are
  // App state, kept mounted with the inactive one display:none'd (so
  // CardsPage's filters/scroll survive a settings/deck-check visit).
  // Settings is only reachable from the avatar menu (authenticated); the
  // effect below snaps back to Cards on sign-out so an anonymous shell can
  // never sit on the settings pane.
  //
  // BL-142: Deck Check is a peer top-level nav tab (unlike Settings), so it
  // IS reachable while anonymous -- clicking it shows DeckCheckPage's own
  // sign-in gate (the same onRequestSignIn idiom CardsPage's anonymous
  // controls already use) rather than silently doing nothing. `view` below
  // therefore only forces anonymous visitors back to "cards" out of
  // "settings" specifically -- "deck-check" passes through unchanged.
  //
  // BL-54 S3 (§8.1 P10/P9): "import-export" mirrors the settings forcing
  // rule (no anonymous entry point at all -- CardsPage's Import / Export
  // button routes anonymous clicks to onRequestSignIn instead of this view,
  // same as Add Cards) and ALSO forces out signed-in-but-unverified users
  // (import/export is gated on verified email, unlike Settings -- BL-54
  // arc's "settings/limits stays ungated" decision leaves Settings alone).
  const [activeView, setActiveView] = useState<AppView>("cards");

  // BL-184: opens the "New Arrivals" view from either entry point (Header's
  // nav tab and its version label share this one handler). Marks the latest
  // entry seen immediately -- before the view switch even -- so the cue
  // clears in the same click that opens the view, rather than waiting on the
  // notes screen's own mount. No anonymous guard: unlike settings/
  // import-export, this view has no gated content (§2 "reachable anonymous").
  function openNotes() {
    const latest = latestEntryKey(RELEASE_NOTES);
    if (latest != null) saveLastSeenKey(latest);
    setNotesUnread(false);
    setActiveView("new-arrivals");
  }

  // BL-196: bridges CardsPage's quantities refetch to ImportExportPage's
  // "Refreshing your Vault…" busy-overlay stage -- CardsPage stays mounted
  // the whole time (display:none, not unmounted, see the pane wrappers
  // below), so a ref is enough; a plain useState would re-render AppContent
  // on every CardsPage auth-driven identity change for no reason, since
  // nothing here ever reads the function itself for rendering. See
  // CardsPage's onQuantitiesRefreshReady prop doc comment for the other
  // half of this wiring.
  const quantitiesRefreshRef = useRef<() => Promise<void>>(async () => {});
  const registerQuantitiesRefresh = useCallback((fn: () => Promise<void>) => {
    quantitiesRefreshRef.current = fn;
  }, []);

  // BL-165: pick the header starfield once per app open (no-repeat-of-last;
  // see utils/headerStarfield.ts). Mount-only by design -- the art must not
  // change mid-session on re-renders or auth transitions.
  useEffect(() => {
    applyHeaderStarfield();
  }, []);

  useEffect(() => {
    if (!user) setActiveView("cards");
  }, [user]);

  // Successful login updates `user` via onAuthStateChanged; close the modal
  // here rather than in the modal itself, so it closes regardless of *how*
  // auth resolved (this effect is the single source of truth) -- except
  // mid-signup, where the modal owns its own "check your email" screen and
  // closes only when the user dismisses it.
  useEffect(() => {
    if (user && !signupInFlight && !googleLinkedInFlight) setAuthModalOpen(false);
  }, [user, signupInFlight, googleLinkedInFlight]);

  if (loading) {
    return <p className="loading-text">Loading…</p>;
  }

  // BL-142: only the settings view is forced back to "cards" for an
  // anonymous visitor -- it has no anonymous-reachable entry point at all
  // (avatar-menu-only), so defensively guarding it here matches that. The
  // "deck-check" view passes through unchanged: DeckCheckPage renders its
  // own sign-in gate for anonymous visitors, the same way CardsPage's
  // anonymous controls do.
  //
  // BL-54 S3: "import-export" gets the same anonymous guard as "settings"
  // above, PLUS a second guard forcing it back to "cards" for a signed-in
  // but unverified user -- the one view-forcing rule in this app that reads
  // emailVerified, since import/export (unlike Settings) is gated on it.
  const view: AppView =
    !user && (activeView === "settings" || activeView === "import-export")
      ? "cards"
      : user && !emailVerified && activeView === "import-export"
        ? "cards"
        : activeView;

  return (
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
          />
        </div>
        {/* BL-142: DeckCheckPage is always mounted (like CardsPage above),
            never gated by `user &&` (unlike SettingsPage below) -- an
            anonymous visitor can select the Deck Check tab and see its own
            sign-in prompt, matching the peer-nav framing (a real tab, not
            an authenticated-only page that silently doesn't exist). */}
        <div style={{ display: view === "deck-check" ? "contents" : "none" }}>
          <DeckCheckPage isAuthenticated={!!user} onRequestSignIn={() => setAuthModalOpen(true)} />
        </div>
        {/* BL-184: NewArrivalsPage is always mounted too (like CardsPage/
            DeckCheckPage above), never gated by `user &&` -- reachable
            anonymous, no sign-in gate of its own to render (§2/§4: static
            content, nothing to fetch). */}
        <div style={{ display: view === "new-arrivals" ? "contents" : "none" }}>
          <NewArrivalsPage onOpenAbout={() => setAboutModalOpen(true)} />
        </div>
        {user && (
          <div style={{ display: view === "settings" ? "contents" : "none" }}>
            {/* BL-129 R5: Delete Account's trigger moved from the avatar
                menu (UserMenu) into this pane's own danger zone -- the
                modal itself stays App-owned (deleteAccountModalOpen below),
                only the source of the click moved. */}
            <SettingsPage onDeleteAccount={() => setDeleteAccountModalOpen(true)} />
          </div>
        )}
        {/* BL-54 S3 (§8.1 P9): mounted only once user && emailVerified, like
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
          onClose={() => {
            setSignupInFlight(false);
            setGoogleLinkedInFlight(false);
            setAuthModalOpen(false);
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
      {/* BL-95: mounted unconditionally (renders null unless the URL carries
          a Firebase action link's mode/oobCode params) -- placed after the
          `loading` gate above returns, so auth.currentUser is already
          settled by the time its effect reads it. BL-116: onRequestSignIn
          mirrors CardsPage's onRequestSignIn wiring above -- lets the
          password-reset success/invalid-code screens hand the user back to
          AuthModal without VerifyEmailAction owning any modal-open state of
          its own. */}
      <VerifyEmailAction onRequestSignIn={() => setAuthModalOpen(true)} />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <LimitsGate>
        <AppContent />
      </LimitsGate>
    </AuthProvider>
  );
}

/** BL-25: bridges AuthContext to LimitsProvider (which takes isAuthenticated
 * as a prop rather than reading useAuth itself, keeping it standalone-
 * testable). Sits between the two providers so everything inside AppContent
 * -- the settings pane, Add Cards, the inventory popup -- shares one
 * fetched limits matrix. */
function LimitsGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <LimitsProvider isAuthenticated={!!user}>{children}</LimitsProvider>;
}

export default App;
