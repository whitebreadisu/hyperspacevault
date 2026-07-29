import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}));

vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: mockUseAuth,
}));

// BL-25: App hosts LimitsProvider (via LimitsGate), which fetches the
// keep-limit matrix whenever a user is signed in. Mocked at the api module
// so the real provider logic runs without touching authedFetch/firebase --
// the matrix itself is irrelevant to App's pane-orchestration tests.
vi.mock("./api/settingsLimits", () => ({
  getLimits: vi.fn().mockResolvedValue([]),
  putLimits: vi.fn().mockResolvedValue([]),
}));

// BL-25: SettingsPage has its own dedicated test file (grid, save flows,
// error banners) -- stubbed here so App.test stays focused on the shell's
// pane switching. BL-129 R5: the stub now accepts (and exposes a trigger
// for) onDeleteAccount, since that callback threads from App straight to
// SettingsPage now -- the avatar menu no longer carries it at all. See the
// "App settings pane danger zone (BL-129 R5)" describe block below for the
// wiring coverage this enables.
vi.mock("./screens/settings/SettingsPage", () => ({
  SettingsPage: ({ onDeleteAccount }: { onDeleteAccount: () => void }) => (
    <div>
      <p>settings-page-stub</p>
      <button onClick={onDeleteAccount}>trigger-delete-account</button>
    </div>
  ),
}));

vi.mock("./screens/auth/AuthModal", () => ({
  AuthModal: ({
    onClose,
    onSignedUp,
    onGoogleLinked,
  }: {
    onClose: () => void;
    onSignedUp?: () => void;
    onGoogleLinked?: () => void;
  }) => (
    <div role="dialog" aria-label="Sign In">
      <button onClick={onClose}>close-modal</button>
      <button onClick={() => onSignedUp?.()}>trigger-signed-up</button>
      {/* BL-118: mirrors the trigger-signed-up stub above, for asserting
          App's googleLinkedInFlight suppression the same way BL-16's
          signupInFlight suppression is asserted below. */}
      <button onClick={() => onGoogleLinked?.()}>trigger-google-linked</button>
    </div>
  ),
}));

// BL-16: VerifyEmailBanner has its own dedicated test file for its internal
// resend/recheck behavior -- here it's stubbed out so App.test.tsx stays
// focused on App's own modal-orchestration logic.
vi.mock("./components/VerifyEmailBanner", () => ({
  VerifyEmailBanner: () => <div>verify-email-banner-stub</div>,
}));

// BL-95: same reasoning -- VerifyEmailAction has its own dedicated test file
// for the action-link handling itself (it also pulls in real firebase.ts /
// firebase/auth via applyActionCode, which App.test.tsx's other mocks
// otherwise avoid entirely).
vi.mock("./screens/auth/VerifyEmailAction", () => ({
  VerifyEmailAction: () => <div>verify-email-action-stub</div>,
}));

vi.mock("./screens/auth/ChangePasswordModal", () => ({
  ChangePasswordModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Change Password">
      <button onClick={onClose}>close-change-password-modal</button>
    </div>
  ),
}));

vi.mock("./screens/auth/DeleteAccountModal", () => ({
  DeleteAccountModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Delete Account">
      <button onClick={onClose}>close-delete-account-modal</button>
    </div>
  ),
}));

// BL-125: AboutModal has its own dedicated test file (title/sections/
// dismissal) -- stubbed here so App.test.tsx stays focused on the App-level
// open/close wiring, mirroring how AuthModal/ChangePasswordModal/
// DeleteAccountModal are stubbed above.
vi.mock("./screens/about/AboutModal", () => ({
  AboutModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="About This Project">
      <button onClick={onClose}>close-about-modal</button>
    </div>
  ),
}));

// BL-126: same reasoning as AboutModal above -- FeedbackModal has its own
// dedicated test file (enablement matrix, prefill, success/error states),
// stubbed here so App.test.tsx stays focused on the App-level open/close
// wiring rather than re-exercising the form's internals.
vi.mock("./screens/feedback/FeedbackModal", () => ({
  FeedbackModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Leave Feedback">
      <button onClick={onClose}>close-feedback-modal</button>
    </div>
  ),
}));

// BL-54 S3: the stub grows onOpenImportExport (App's activeView switch,
// mirroring how onOpenSettings threads through Header) -- exposed here as a
// plain trigger button so this file's wiring tests can fire it without
// re-exercising CardsPage's own auth-state gating (that lives in
// CardsPage.test.tsx's own "Import / Export button" describe block).
vi.mock("./screens/cards/CardsPage", () => ({
  CardsPage: ({
    isAuthenticated,
    onOpenImportExport,
  }: {
    isAuthenticated: boolean;
    onOpenImportExport?: () => void;
  }) => (
    <div>
      <p>cards-page:{isAuthenticated ? "auth" : "anon"}</p>
      <button onClick={() => onOpenImportExport?.()}>trigger-open-import-export</button>
    </div>
  ),
}));

// BL-54 S3: ImportExportPage has its own dedicated test file (stepper flow,
// report rendering, downloads) -- stubbed here so App.test.tsx stays
// focused on the pane's App-level mount/switch wiring, mirroring how
// SettingsPage is stubbed above.
vi.mock("./screens/importexport/ImportExportPage", () => ({
  ImportExportPage: ({ onBackToVault }: { onBackToVault: () => void }) => (
    <div>
      <p>import-export-page-stub</p>
      <button onClick={onBackToVault}>trigger-back-to-vault</button>
    </div>
  ),
}));

// BL-142: DeckCheckPage has its own dedicated test file (entry/result
// wiring, sign-in gate) -- stubbed here so App.test.tsx stays focused on
// the shell's pane-orchestration, mirroring the CardsPage stub above.
vi.mock("./screens/deckcheck/DeckCheckPage", () => ({
  DeckCheckPage: ({ isAuthenticated }: { isAuthenticated: boolean }) => (
    <p>deck-check-page:{isAuthenticated ? "auth" : "anon"}</p>
  ),
}));

// DISPOSITION (BL-56 Slice 2): this suite REPLACEs "App auth gate" (which
// asserted a full-screen AuthScreen shown whenever `!user`) -- BL-56 §5.5
// removes that gate entirely, so the old assertion no longer has a
// component to point at. The replacement suite asserts the un-gated shell
// (Cards list + Sign In button for anonymous) plus the new auth-modal
// open/close wiring.
describe("App shell (BL-56 §5.5)", () => {
  it("shows a loading state while auth resolves", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, logout: vi.fn() });
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the Cards shell for anonymous users, with no auth gate", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);
    expect(screen.getByText("cards-page:anon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // DISPOSITION (BL-22, PORT): previously asserted the email + Log Out
  // rendered inline in the header. BL-22 moves both behind an avatar menu
  // (see Header.test.tsx for the menu's own dedicated coverage), so this
  // test now opens the menu before checking for them -- the "signed-in
  // users can see their email and log out from the header" behavior
  // survives unchanged, only its shape moved.
  // DISPOSITION (BL-129 R3, PORT; BL-142/BL-143, REPLACE label + shape):
  // the nav tab used to read "Cards", then "Inventory" (BL-129 R3); BL-143
  // renames it again to "Vault", and BL-142 turns it from a single
  // non-interactive label into a real peer tab alongside Deck Check (see
  // "App deck-check pane (BL-142)" below for that tab's own coverage). The
  // "no separate Catalog/Cards labels" behavior this test protects is
  // unchanged.
  it("shows the unified Vault view (peer nav tab) + avatar menu (email/logout) when signed in", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);
    expect(screen.getByText("cards-page:auth")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /log out/i })).toBeInTheDocument();
    expect(screen.getByText("Vault")).toBeInTheDocument();
    expect(screen.queryByText("Catalog")).not.toBeInTheDocument();
    expect(screen.queryByText("Cards")).not.toBeInTheDocument();
    expect(screen.queryByText("Inventory")).not.toBeInTheDocument();
  });

  // DISPOSITION (BL-95, CREATE): net-new coverage confirming App mounts the
  // action-link handler unconditionally (it self-gates on the URL's action
  // params internally -- see VerifyEmailAction.test.tsx for that behavior).
  it("mounts VerifyEmailAction unconditionally", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);
    expect(screen.getByText("verify-email-action-stub")).toBeInTheDocument();
  });

  it("opens the auth modal from the header Sign In button", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the auth modal via its own onClose", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("auto-closes the modal once the user becomes authenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    rerender(<App />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // DISPOSITION (BL-23, CREATE): new coverage for the Change Password modal's
  // App-level open/close wiring -- mirrors the Sign In / AuthModal tests
  // above (same state-in-App, modal-as-sibling-of-Header pattern).
  it("opens the change password modal from the avatar menu", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /change password/i }));

    expect(screen.getByRole("dialog", { name: /change password/i })).toBeInTheDocument();
  });

  it("closes the change password modal via its own onClose", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /change password/i }));
    expect(screen.getByRole("dialog", { name: /change password/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText("close-change-password-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // RETIRE (BL-129 R5 -- designed away): Delete Account's trigger is no
  // longer reachable from the avatar menu at all -- these two tests drove
  // it via `menuitem "delete account"`, which UserMenu no longer renders.
  // The App-level open/close wiring survives (DeleteAccountModal is still
  // App-owned, still a sibling of Header) -- re-expressed below in "App
  // settings pane danger zone (BL-129 R5)" against the new trigger source
  // (SettingsPage's danger zone, reached via the Settings pane rather than
  // the avatar menu).

  // DISPOSITION (BL-16, CREATE): net-new coverage for the signupInFlight
  // suppression -- App's auto-close-on-auth effect must not yank the modal
  // away mid-signup, so the "check your email" screen (owned by AuthModal,
  // stubbed here) stays visible until the user dismisses it themselves.
  it("suppresses the auto-close-on-auth effect once AuthModal reports a signup in flight", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("trigger-signed-up"));

    // Auth resolves (the new user is signed in) -- without the suppression
    // this would auto-close the modal, same as the login path does.
    mockUseAuth.mockReturnValue({ user: { email: "new@b.com" }, loading: false, logout: vi.fn() });
    rerender(<App />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // The modal (AuthModal's own "check your email" screen) still closes
    // via its own onClose once the user dismisses it.
    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resets the suppression once the modal closes, so a later auth transition auto-closes normally", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    fireEvent.click(screen.getByText("trigger-signed-up"));
    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // A fresh sign-in flow (no onSignedUp this time) auto-closes as usual.
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    rerender(<App />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // DISPOSITION (BL-118, CREATE): net-new coverage for googleLinkedInFlight --
  // the same auto-close suppression signupInFlight already covers above,
  // now also protecting AuthModal's ADR-0016 §1 "linked to an existing
  // account" notice screen from being yanked away the instant `user`
  // updates.
  it("suppresses the auto-close-on-auth effect once AuthModal reports a Google account link", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("trigger-google-linked"));

    mockUseAuth.mockReturnValue({ user: { email: "g@b.com" }, loading: false, logout: vi.fn() });
    rerender(<App />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resets the Google-link suppression once the modal closes, so a later auth transition auto-closes normally", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    fireEvent.click(screen.getByText("trigger-google-linked"));
    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    rerender(<App />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // DISPOSITION (BL-118, CREATE): net-new coverage confirming App derives
  // Header's hasPasswordProvider prop from the real user object's
  // providerData rather than hardcoding it -- a Google-only account (no
  // `password` entry) hides the avatar menu's Change Password item.
  it("hides Change Password in the avatar menu for a Google-only account (no password provider)", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "g@b.com", providerData: [{ providerId: "google.com" }] },
      loading: false,
      logout: vi.fn(),
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.queryByRole("menuitem", { name: /change password/i })).not.toBeInTheDocument();
  });

  it("shows Change Password in the avatar menu for an account with a password provider", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com", providerData: [{ providerId: "password" }] },
      loading: false,
      logout: vi.fn(),
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /change password/i })).toBeInTheDocument();
  });
});

// DISPOSITION (BL-25, CREATE): the settings pane's App-level orchestration --
// a second always-mounted-while-authenticated pane toggled by display, opened
// from the avatar menu, closed via the header's Inventory tab (BL-129 R3:
// relabeled "Cards" -> "Inventory"), unreachable for anonymous users, and
// snapped back to Cards on sign-out.
describe("App settings pane (BL-25)", () => {
  function openSettings() {
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /settings/i }));
  }

  it("never renders the settings pane for anonymous users (no entry point either)", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    expect(screen.queryByText("settings-page-stub")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
  });

  it("mounts the settings pane hidden for signed-in users until Settings is selected", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    // Both panes are mounted; only Cards is visible pre-navigation.
    expect(screen.getByText("settings-page-stub")).not.toBeVisible();
    expect(screen.getByText("cards-page:auth")).toBeVisible();
  });

  it("shows the settings pane (hiding Cards, keeping it mounted) when Settings is selected", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    openSettings();

    expect(screen.getByText("settings-page-stub")).toBeVisible();
    // CardsPage stays mounted (state preserved), just display-hidden.
    expect(screen.getByText("cards-page:auth")).not.toBeVisible();
  });

  // DISPOSITION (BL-143, REPLACE label only): the way-back button used to
  // read "Inventory" -- BL-143 renames it to "Vault"; the navigation
  // behavior itself (way-back returns to the Cards pane) is unchanged.
  it("returns to the Cards pane via the header's Vault tab", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    openSettings();
    expect(screen.getByText("settings-page-stub")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(screen.getByText("cards-page:auth")).toBeVisible();
    expect(screen.getByText("settings-page-stub")).not.toBeVisible();
  });

  // DISPOSITION (BL-129 R5, PORT of BL-87's App-level wiring coverage): the
  // Delete Account modal's open/close wiring survives BL-129 unchanged
  // (still App-owned state, still a sibling of Header) -- only the trigger
  // moved from the avatar menu (retired above) to this pane's stubbed danger
  // zone. Placed in this describe block since reaching the trigger now goes
  // through the settings pane.
  describe("danger zone (BL-129 R5)", () => {
    it("opens the delete account modal from the settings pane's danger-zone trigger", () => {
      mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
      render(<App />);

      openSettings();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("trigger-delete-account"));
      expect(screen.getByRole("dialog", { name: /delete account/i })).toBeInTheDocument();
    });

    it("closes the delete account modal via its own onClose", () => {
      mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
      render(<App />);

      openSettings();
      fireEvent.click(screen.getByText("trigger-delete-account"));
      expect(screen.getByRole("dialog", { name: /delete account/i })).toBeInTheDocument();

      fireEvent.click(screen.getByText("close-delete-account-modal"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("snaps back to the Cards pane when the user signs out while on settings", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    const { rerender } = render(<App />);

    openSettings();
    expect(screen.getByText("settings-page-stub")).toBeVisible();

    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    rerender(<App />);

    expect(screen.queryByText("settings-page-stub")).not.toBeInTheDocument();
    expect(screen.getByText("cards-page:anon")).toBeVisible();
  });
});

// DISPOSITION (BL-142, CREATE): the deck-check pane's App-level
// orchestration -- unlike Settings (App settings pane, above), this pane is
// ALWAYS mounted (even for anonymous visitors, like CardsPage) and its nav
// tab is always reachable, since Deck Check is a peer top-level view, not
// an avatar-menu-gated one. DeckCheckPage itself is stubbed (see the
// vi.mock above) -- its own auth-gating/entry/result behavior has its
// dedicated test file (DeckCheckPage.test.tsx).
describe("App deck-check pane (BL-142)", () => {
  it("mounts the deck-check pane (anonymous) hidden until the Deck Check tab is selected", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    expect(screen.getByText("deck-check-page:anon")).not.toBeVisible();
    expect(screen.getByText("cards-page:anon")).toBeVisible();
  });

  it("shows the deck-check pane (anonymous) when its nav tab is clicked -- no entry point is hidden, unlike Settings", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Deck Check" }));
    expect(screen.getByText("deck-check-page:anon")).toBeVisible();
    expect(screen.getByText("cards-page:anon")).not.toBeVisible();
  });

  it("shows the deck-check pane authenticated when signed in", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Deck Check" }));
    expect(screen.getByText("deck-check-page:auth")).toBeVisible();
  });

  it("returns to the Cards pane via the Vault tab from deck-check", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Deck Check" }));
    expect(screen.getByText("deck-check-page:anon")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(screen.getByText("cards-page:anon")).toBeVisible();
    expect(screen.getByText("deck-check-page:anon")).not.toBeVisible();
  });

  it("snaps back to the Cards pane when the user signs out while on deck-check", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Deck Check" }));
    expect(screen.getByText("deck-check-page:auth")).toBeVisible();

    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    rerender(<App />);

    expect(screen.getByText("cards-page:anon")).toBeVisible();
  });
});

// DISPOSITION (BL-125, CREATE): new coverage for the About modal's
// App-level open/close wiring -- mirrors the Change Password/Delete Account
// tests above (same state-in-App, modal-as-sibling-of-Header pattern), plus
// the anonymous-reachability case that's unique to this modal (Header's
// brand-line microcopy, unlike the avatar-menu-gated modals, is visible
// regardless of auth state).
describe("App About modal (BL-125)", () => {
  it("opens the about modal from the header brand-line microcopy when anonymous", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unofficial fan project/i }));

    expect(screen.getByRole("dialog", { name: /about this project/i })).toBeInTheDocument();
  });

  it("closes the about modal via its own onClose", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /unofficial fan project/i }));
    expect(screen.getByRole("dialog", { name: /about this project/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText("close-about-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("also opens the about modal from the avatar menu's About & Legal item when signed in", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /about & legal/i }));

    expect(screen.getByRole("dialog", { name: /about this project/i })).toBeInTheDocument();
  });
});

// DISPOSITION (BL-126, CREATE): new coverage for the Feedback modal's
// App-level open/close wiring -- mirrors the About modal tests directly
// above (same state-in-App, modal-as-sibling-of-Header pattern, same
// anonymous-reachability property since the header's Leave Feedback button
// is visible regardless of auth state).
describe("App Feedback modal (BL-126)", () => {
  it("opens the feedback modal from the header button when anonymous", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /leave feedback/i }));

    expect(screen.getByRole("dialog", { name: /leave feedback/i })).toBeInTheDocument();
  });

  it("closes the feedback modal via its own onClose", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /leave feedback/i }));
    expect(screen.getByRole("dialog", { name: /leave feedback/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText("close-feedback-modal"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("also opens the feedback modal from the header button when signed in", () => {
    mockUseAuth.mockReturnValue({ user: { email: "a@b.com" }, loading: false, logout: vi.fn() });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /leave feedback/i }));
    expect(screen.getByRole("dialog", { name: /leave feedback/i })).toBeInTheDocument();
  });
});

// DISPOSITION (BL-54 S3, CREATE): the import-export pane's App-level
// orchestration -- mirrors "App settings pane (BL-25)" above (mounted only
// while gated, snapped back to Cards on sign-out, reached via a callback
// threaded into a child rather than a Header menu item), plus one gate
// Settings doesn't have: unverified signed-in users are forced out too
// (§8.1 P9 -- import/export gates on verified email, Settings doesn't).
describe("App import-export pane (BL-54 S3)", () => {
  it("never renders the import-export pane for anonymous users (no entry point either)", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      logout: vi.fn(),
      emailVerified: false,
    });
    render(<App />);

    expect(screen.queryByText("import-export-page-stub")).not.toBeInTheDocument();
  });

  it("never renders the import-export pane for a signed-in but unverified user", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: false,
    });
    render(<App />);

    fireEvent.click(screen.getByText("trigger-open-import-export"));
    expect(screen.queryByText("import-export-page-stub")).not.toBeInTheDocument();
    // Render-time guard, not just "never mounted": Cards stays visible.
    expect(screen.getByText("cards-page:auth")).toBeVisible();
  });

  it("mounts the import-export pane hidden for a verified user until it's opened", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: true,
    });
    render(<App />);

    expect(screen.getByText("import-export-page-stub")).not.toBeVisible();
    expect(screen.getByText("cards-page:auth")).toBeVisible();
  });

  it("shows the import-export pane (hiding Cards, keeping it mounted) once opened", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: true,
    });
    render(<App />);

    fireEvent.click(screen.getByText("trigger-open-import-export"));

    expect(screen.getByText("import-export-page-stub")).toBeVisible();
    expect(screen.getByText("cards-page:auth")).not.toBeVisible();
  });

  // BL-54 S3 (§8.1 P10): the transient tab -- present (and active) only
  // while this view is active, gone the moment Vault is clicked. Header
  // itself is real here (not stubbed), so this exercises the actual
  // nav-branch wiring, not just App's pane-visibility switch above.
  it("shows the transient 'Import / Export' header tab only while the pane is active, and returns to Cards via Vault", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: true,
    });
    render(<App />);

    expect(screen.queryByText("Import / Export")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("trigger-open-import-export"));
    expect(screen.getByText("Import / Export").className).toContain("nav-tab--active");

    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(screen.queryByText("Import / Export")).not.toBeInTheDocument();
    expect(screen.getByText("cards-page:auth")).toBeVisible();
    expect(screen.getByText("import-export-page-stub")).not.toBeVisible();
  });

  it("returns to the Cards pane via its own 'Back to Vault' link", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: true,
    });
    render(<App />);

    fireEvent.click(screen.getByText("trigger-open-import-export"));
    expect(screen.getByText("import-export-page-stub")).toBeVisible();

    fireEvent.click(screen.getByText("trigger-back-to-vault"));
    expect(screen.getByText("cards-page:auth")).toBeVisible();
    expect(screen.getByText("import-export-page-stub")).not.toBeVisible();
  });

  it("snaps back to the Cards pane render-time when a user's verification regresses mid-session", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: true,
    });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByText("trigger-open-import-export"));
    expect(screen.getByText("import-export-page-stub")).toBeVisible();

    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: false,
    });
    rerender(<App />);

    expect(screen.queryByText("import-export-page-stub")).not.toBeInTheDocument();
    expect(screen.getByText("cards-page:auth")).toBeVisible();
  });

  it("snaps back to the Cards pane when the user signs out while on import-export", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "a@b.com" },
      loading: false,
      logout: vi.fn(),
      emailVerified: true,
    });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByText("trigger-open-import-export"));
    expect(screen.getByText("import-export-page-stub")).toBeVisible();

    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      logout: vi.fn(),
      emailVerified: false,
    });
    rerender(<App />);

    expect(screen.queryByText("import-export-page-stub")).not.toBeInTheDocument();
    expect(screen.getByText("cards-page:anon")).toBeVisible();
  });
});
