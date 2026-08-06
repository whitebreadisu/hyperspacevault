import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Header } from "./Header";

// DISPOSITION (BL-126, PORT/signature-only): every render call in this file
// gained the required onOpenFeedback prop (the same churn BL-23/BL-87/BL-25/
// BL-125 each documented above when they added their own required prop) --
// existing assertions are unchanged; new coverage for the button itself
// lives in the "Header Leave Feedback button (BL-126)" describe block below.
//
// DISPOSITION (BL-56 Slice 2, CREATE): no dedicated Header suite existed
// before this change. Covers the new top-right auth slot -- Sign In when
// anonymous, email + Log Out when authenticated -- and the single nav
// label untouched by this slice (BL-129 R3 later relabels it "Inventory").
describe("Header auth slot (BL-56 §5.5)", () => {
  it("shows a Sign In button and no email/logout when anonymous", () => {
    const onSignIn = vi.fn();
    const onLogout = vi.fn();
    render(
      <Header
        userEmail={null}
        onLogout={onLogout}
        onSignIn={onSignIn}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );

    const signInBtn = screen.getByRole("button", { name: /sign in/i });
    expect(signInBtn).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();

    fireEvent.click(signInBtn);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  // DISPOSITION (BL-22, PORT; re-ported for BL-23 prop signature only):
  // the authenticated slot used to render the email + Log Out button inline;
  // BL-22 evolves it into an avatar menu, so the email is now only visible
  // once the menu is opened and Log Out is a menuitem inside it rather than
  // a bare header button. BL-23 adds a required onChangePassword prop to
  // Header -- this test's render call is updated for that signature change
  // only, its assertions are unchanged.
  it("shows an avatar menu (email + Log Out) and no Sign In when authenticated", () => {
    const onSignIn = vi.fn();
    const onLogout = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={onLogout}
        onSignIn={onSignIn}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByText("a@b.com")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByText("a@b.com")).toBeInTheDocument();

    const logoutItem = screen.getByRole("menuitem", { name: /log out/i });
    fireEvent.click(logoutItem);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  // DISPOSITION (BL-142/BL-143, REPLACE): BL-129 R3's single non-interactive
  // "Inventory" label is superseded by BL-142's real two-tab bar (Vault /
  // Deck Check) -- Deck Check is a genuine peer view now, not a future
  // maybe. BL-143 renames the label itself to "Vault" in the same change
  // ("one nav change, not two"). The "no separate Catalog/Cards labels"
  // assertion survives; the "single tab" shape does not -- re-expressed as
  // the "Header peer nav (BL-142)" describe block below, which covers both
  // tabs' presence/active-state/click wiring.
  it("shows the Vault nav label (not Inventory/Catalog/Cards) regardless of auth state", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    expect(screen.getByText("Vault")).toBeInTheDocument();
    expect(screen.queryByText("Catalog")).not.toBeInTheDocument();
    expect(screen.queryByText("Cards")).not.toBeInTheDocument();
    expect(screen.queryByText("Inventory")).not.toBeInTheDocument();
  });
});

// DISPOSITION (BL-142, CREATE): net-new coverage for the two-tab peer nav
// bar (Vault / Deck Check) that replaces the old single-label nav on the
// cards/deck-check views -- Header's own doc comment covers why Settings
// keeps its separate way-back-button shape rather than joining this row.
describe("Header peer nav (BL-142)", () => {
  it("shows both Vault and Deck Check tabs, Vault active by default", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    const vaultTab = screen.getByRole("button", { name: "Vault" });
    const deckCheckTab = screen.getByRole("button", { name: "Deck Check" });
    expect(vaultTab.className).toContain("nav-tab--active");
    expect(deckCheckTab.className).not.toContain("nav-tab--active");
  });

  it("marks Deck Check active and Vault inactive when view is deck-check", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="deck-check"
      />
    );
    const vaultTab = screen.getByRole("button", { name: "Vault" });
    const deckCheckTab = screen.getByRole("button", { name: "Deck Check" });
    expect(deckCheckTab.className).toContain("nav-tab--active");
    expect(vaultTab.className).not.toContain("nav-tab--active");
  });

  it("calls onNavigateDeckCheck when the Deck Check tab is clicked", () => {
    const onNavigateDeckCheck = vi.fn();
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        onNavigateDeckCheck={onNavigateDeckCheck}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Deck Check" }));
    expect(onNavigateDeckCheck).toHaveBeenCalledTimes(1);
  });

  it("calls onNavigateCards when the Vault tab is clicked from the deck-check view", () => {
    const onNavigateCards = vi.fn();
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="deck-check"
        onNavigateCards={onNavigateCards}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(onNavigateCards).toHaveBeenCalledTimes(1);
  });

  it("does not render a Deck Check tab on the settings view (unchanged shape: way-back + active Settings tab only)", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="settings"
      />
    );
    expect(screen.queryByRole("button", { name: "Deck Check" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vault" })).toBeInTheDocument();
    expect(screen.getByText("Settings").className).toContain("nav-tab--active");
  });
});

// DISPOSITION (BL-22, CREATE): new coverage for the avatar dropdown menu
// itself -- initial rendering, open/close interactions (click toggle,
// Escape, outside click), and a11y attributes -- none of which existed
// before this slice introduced the menu. Render calls updated for BL-23's
// required onChangePassword prop; assertions unchanged.
// DISPOSITION (BL-54 S3, CREATE): net-new coverage for the transient
// "Import / Export" tab -- mirrors "Header settings-view nav (BL-25)" below
// (way-back Vault button + one active tab), the shape the `view` prop's own
// doc comment says this view reuses, plus the "not rendered on any other
// view" transience check (§8.1 P10) the peer nav tests above don't need
// since Vault/Deck Check are permanent tabs, not transient ones.
describe("Header import-export nav (BL-54 S3)", () => {
  it("renders an active 'Import / Export' tab plus a Vault button that navigates back", () => {
    const onNavigateCards = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="import-export"
        onNavigateCards={onNavigateCards}
      />
    );

    const tab = screen.getByText("Import / Export");
    expect(tab.className).toContain("nav-tab--active");

    const vaultTab = screen.getByRole("button", { name: "Vault" });
    expect(vaultTab.className).not.toContain("nav-tab--active");
    fireEvent.click(vaultTab);
    expect(onNavigateCards).toHaveBeenCalledTimes(1);
  });

  it("does not render a Deck Check tab on the import-export view (same shape as settings)", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="import-export"
      />
    );
    expect(screen.queryByRole("button", { name: "Deck Check" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vault" })).toBeInTheDocument();
  });

  it("does not render the Import / Export tab on any other view (transient tab)", () => {
    const { rerender } = render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    expect(screen.queryByText("Import / Export")).not.toBeInTheDocument();

    rerender(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="deck-check"
      />
    );
    expect(screen.queryByText("Import / Export")).not.toBeInTheDocument();

    rerender(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="settings"
      />
    );
    expect(screen.queryByText("Import / Export")).not.toBeInTheDocument();
  });
});

describe("Header avatar menu (BL-22)", () => {
  it("shows the uppercased first letter of the email as the avatar initial", () => {
    render(
      <Header
        userEmail="zed@example.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /account menu/i })).toHaveTextContent("Z");
  });

  it("has correct a11y attributes on the avatar button and menu", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    const avatar = screen.getByRole("button", { name: /account menu/i });
    expect(avatar).toHaveAttribute("aria-haspopup", "menu");
    expect(avatar).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(avatar);
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /log out/i })).toBeInTheDocument();
  });

  it("toggles closed when the avatar is clicked again", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    const avatar = screen.getByRole("button", { name: /account menu/i });

    fireEvent.click(avatar);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(avatar);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on outside click", () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <Header
          userEmail="a@b.com"
          onLogout={vi.fn()}
          onSignIn={vi.fn()}
          onChangePassword={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenAbout={vi.fn()}
          onOpenFeedback={vi.fn()}
        />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("calls onLogout and closes the menu when Log Out is selected", () => {
    const onLogout = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={onLogout}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));

    fireEvent.click(screen.getByRole("menuitem", { name: /log out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

// DISPOSITION (BL-23, CREATE): new coverage for the Change Password menu
// item threaded through Header -> UserMenu (App owns the modal-open state,
// same pattern as onSignIn/AuthModal).
describe("Header avatar menu Change Password item (BL-23)", () => {
  it("shows a Change Password menuitem alongside Log Out", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /log out/i })).toBeInTheDocument();
  });

  it("calls onChangePassword and closes the menu when Change Password is selected", () => {
    const onChangePassword = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={onChangePassword}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));

    fireEvent.click(screen.getByRole("menuitem", { name: /change password/i }));
    expect(onChangePassword).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

// DISPOSITION (BL-118, CREATE): net-new coverage for ADR-0016 §3's
// Change-Password-hidden-for-Google-only-accounts rule, threaded from App
// through Header into UserMenu (see UserMenu's own doc comment).
describe("Header avatar menu Change Password item hidden for Google-only accounts (BL-118)", () => {
  it("shows Change Password when hasPasswordProvider is left at its default (true)", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /change password/i })).toBeInTheDocument();
  });

  it("hides Change Password when hasPasswordProvider is false", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        hasPasswordProvider={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.queryByRole("menuitem", { name: /change password/i })).not.toBeInTheDocument();
    // Everything else in the menu still renders.
    expect(screen.getByRole("menuitem", { name: /log out/i })).toBeInTheDocument();
  });
});

// RETIRE (BL-129 R5 -- designed away): the avatar menu no longer offers a
// Delete Account item at all -- its trigger relocated to a "danger zone"
// section at the bottom of the Settings pane (Jeremy's dev review found it
// too easy to reach from the everyday account menu). Header no longer
// accepts an onDeleteAccount prop and UserMenu no longer renders the
// destructive menuitem these two tests asserted, so there's nothing left
// here to point at. The behavior itself survives -- re-expressed as
// SettingsPage.test.tsx's "SettingsPage danger zone (BL-129 R5)" describe
// block, PORTing the same two assertions (destructive-styled trigger
// present; clicking it calls the callback) against the new trigger site.

// DISPOSITION (BL-25, CREATE): new coverage for the Settings menu item and
// the settings-view nav treatment. Every earlier render call in this file
// gained the required onOpenSettings prop (signature-only update, the same
// churn BL-23 already documented above); assertions unchanged.
describe("Header avatar menu Settings item (BL-25)", () => {
  it("shows a Settings menuitem in the avatar menu", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /settings/i })).toBeInTheDocument();
  });

  it("calls onOpenSettings and closes the menu when Settings is selected", () => {
    const onOpenSettings = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));

    fireEvent.click(screen.getByRole("menuitem", { name: /settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers no Settings entry point when anonymous (no avatar menu at all)", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });
});

// DISPOSITION (BL-129 R3, PORT then BL-143, REPLACE label only): the
// way-back button and the default active tab both used to read "Cards",
// then "Inventory" (BL-129 R3); BL-143 renames the label again to "Vault"
// (nav label only -- the AppView id/routing key stays "cards", untouched).
// The navigation behavior these tests protect (way-back click fires
// onNavigateCards) is unchanged; the "no Settings tab on the default view"
// assertion is superseded by BL-142's two-tab bar -- re-expressed as "shows
// both Vault and Deck Check tabs..." in the "Header peer nav (BL-142)"
// describe block above.
describe("Header settings-view nav (BL-25)", () => {
  it("renders an active Settings tab plus a Vault button that navigates back", () => {
    const onNavigateCards = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="settings"
        onNavigateCards={onNavigateCards}
      />
    );

    const settingsTab = screen.getByText("Settings");
    expect(settingsTab.className).toContain("nav-tab--active");

    const vaultTab = screen.getByRole("button", { name: "Vault" });
    expect(vaultTab.className).not.toContain("nav-tab--active");
    fireEvent.click(vaultTab);
    expect(onNavigateCards).toHaveBeenCalledTimes(1);
  });
});

// DISPOSITION (BL-125, CREATE): new coverage for the header brand-line
// "Unofficial Fan Project" microcopy that opens the About modal -- reachable
// regardless of auth state (unlike the UserMenu item below, which only
// exists once signed in), so both an anonymous and an authenticated render
// are covered here.
describe("Header brand-line About microcopy (BL-125)", () => {
  it("shows the microcopy and fires onOpenAbout when anonymous", () => {
    const onOpenAbout = vi.fn();
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={onOpenAbout}
        onOpenFeedback={vi.fn()}
      />
    );

    const tag = screen.getByRole("button", { name: /unofficial fan project/i });
    expect(tag).toBeInTheDocument();

    fireEvent.click(tag);
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });

  it("shows the microcopy and fires onOpenAbout when authenticated", () => {
    const onOpenAbout = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={onOpenAbout}
        onOpenFeedback={vi.fn()}
      />
    );

    const tag = screen.getByRole("button", { name: /unofficial fan project/i });
    fireEvent.click(tag);
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });
});

// DISPOSITION (BL-125, CREATE): new coverage for the UserMenu "About &
// Legal" item -- authenticated-only (the menu itself doesn't exist for
// anonymous visitors, same constraint Settings/Change Password/Log Out
// already have), closing the menu before calling through to App the same
// way every other menu item does.
describe("Header avatar menu About & Legal item (BL-125)", () => {
  it("shows an About & Legal menuitem after Change Password and before Log Out", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    const aboutIndex = items.findIndex((t) => /about & legal/i.test(t ?? ""));
    const changePasswordIndex = items.findIndex((t) => /change password/i.test(t ?? ""));
    const logoutIndex = items.findIndex((t) => /^log out$/i.test(t ?? ""));

    expect(aboutIndex).toBeGreaterThan(changePasswordIndex);
    expect(aboutIndex).toBeLessThan(logoutIndex);
  });

  it("calls onOpenAbout and closes the menu when About & Legal is selected", () => {
    const onOpenAbout = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={onOpenAbout}
        onOpenFeedback={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));

    fireEvent.click(screen.getByRole("menuitem", { name: /about & legal/i }));
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers no About & Legal entry point via the avatar menu when anonymous (no menu at all)", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /about & legal/i })).not.toBeInTheDocument();
  });
});

// DISPOSITION (BL-126, CREATE): new coverage for the "Leave Feedback" header
// button -- visible regardless of auth state (unlike the Sign In/UserMenu
// split it sits beside), mirroring the brand-line About microcopy tests
// above (BL-125) for the same "anonymous + authenticated" shape.
describe("Header Leave Feedback button (BL-126)", () => {
  it("shows the button and fires onOpenFeedback when anonymous", () => {
    const onOpenFeedback = vi.fn();
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={onOpenFeedback}
      />
    );

    const btn = screen.getByRole("button", { name: /leave feedback/i });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);
  });

  it("shows the button and fires onOpenFeedback when authenticated", () => {
    const onOpenFeedback = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={onOpenFeedback}
      />
    );

    const btn = screen.getByRole("button", { name: /leave feedback/i });
    fireEvent.click(btn);
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);
  });
});

// DISPOSITION (BL-184, CREATE): new coverage for the footer version label
// (always rendered, anonymous + authenticated alike, mirroring the
// brand-line About microcopy tests above) and the "[HSV] What's New?" nav tab
// (conditionally rendered -- present only while hasUnread or already the
// active view, leftmost of the peer nav tabs, carrying the shared amber cue
// class while unread).
describe("Header version label + New Arrivals nav (BL-184)", () => {
  it("always shows the version label, even with no onOpenNotes/hasUnread wired", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /^v1.3/ })).toBeInTheDocument();
  });

  it("fires onOpenNotes when the version label is clicked", () => {
    const onOpenNotes = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        onOpenNotes={onOpenNotes}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^v1.3/ }));
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });

  it("does not render the New Arrivals nav tab when hasUnread is false and it isn't the active view", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    );
    expect(screen.queryByText("[HSV] What's New?")).not.toBeInTheDocument();
  });

  it("renders the New Arrivals nav tab, leftmost of the peer tabs, when hasUnread is true", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        hasUnread
      />
    );
    const tabs = screen.getAllByRole("button", {
      name: /^(\[HSV\] What's New\?|Vault|Deck Check)$/,
    });
    expect(tabs.map((t) => t.textContent)).toEqual(["[HSV] What's New?", "Vault", "Deck Check"]);
  });

  it("carries the cue class on both the nav tab and the version label while hasUnread is true", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        hasUnread
      />
    );
    expect(screen.getByRole("button", { name: "[HSV] What's New?" }).className).toContain(
      "nav-tab--cue"
    );
    expect(screen.getByRole("button", { name: /^v1.3/ }).className).toContain(
      "app-header__version--cue"
    );
  });

  it("carries no cue class on either entry point once hasUnread is false", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="new-arrivals"
      />
    );
    expect(screen.getByRole("button", { name: "[HSV] What's New?" }).className).not.toContain(
      "nav-tab--cue"
    );
    expect(screen.getByRole("button", { name: /^v1.3/ }).className).not.toContain(
      "app-header__version--cue"
    );
  });

  it("keeps the New Arrivals nav tab visible while it's the active view even once hasUnread is false", () => {
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="new-arrivals"
      />
    );
    const tab = screen.getByRole("button", { name: "[HSV] What's New?" });
    expect(tab.className).toContain("nav-tab--active");
  });

  it("fires onOpenNotes when the New Arrivals nav tab is clicked", () => {
    const onOpenNotes = vi.fn();
    render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        hasUnread
        onOpenNotes={onOpenNotes}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "[HSV] What's New?" }));
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });

  it("does not render the New Arrivals tab on the settings/import-export shape (same as Deck Check)", () => {
    render(
      <Header
        userEmail="a@b.com"
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        view="settings"
        hasUnread
      />
    );
    expect(screen.queryByText("[HSV] What's New?")).not.toBeInTheDocument();
  });
});
