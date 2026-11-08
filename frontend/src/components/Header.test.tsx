import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Header } from "./Header";

const BRAND = /^Hyperspace Vault, Unofficial Fan Project v\d+\.\d+.* - About & Legal and Updates$/;
/** Open the brand chooser (the logo + tag line button) and return the dialog. */
function openChooser() {
  fireEvent.click(screen.getByRole("button", { name: BRAND }));
  return screen.getByRole("dialog");
}

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

// DISPOSITION (BL-22, CREATE): new coverage for the avatar dropdown menu
// itself -- initial rendering, open/close interactions (click toggle,
// Escape, outside click), and a11y attributes -- none of which existed
// before this slice introduced the menu. Render calls updated for BL-23's
// required onChangePassword prop; assertions unchanged.
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

// DISPOSITION (BL-125, CREATE): new coverage for the header brand-line
// "Unofficial Fan Project" microcopy that opens the About modal -- reachable
// regardless of auth state (unlike the UserMenu item below, which only
// exists once signed in), so both an anonymous and an authenticated render
// are covered here.
// PORT: the tag line is no longer its own About button; the brand button
// opens the chooser and its About & Legal button calls onOpenAbout, for a
// signed-out visitor too.
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

    const dlg = openChooser();
    fireEvent.click(within(dlg).getByRole("button", { name: "About & Legal" }));
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

    const dlg = openChooser();
    fireEvent.click(within(dlg).getByRole("button", { name: "About & Legal" }));
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
// brand-line About microcopy tests above) and the "[HSV] Updates" nav tab
// (conditionally rendered -- present only while hasUnread or already the
// active view, leftmost of the peer nav tabs, carrying the shared amber cue
// class while unread).
// PORT: the version is plain text on the tag line; Updates is reached through
// the brand chooser, and the version label's cue moved to the tag line and
// the chooser's Updates button.
describe("Header version label + New Arrivals nav (BL-184)", () => {
  it("always shows the version on the tag line, even with no onOpenNotes/hasUnread wired", () => {
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
    expect(screen.getByRole("button", { name: BRAND }).textContent).toMatch(
      /^Unofficial Fan Project v\d+\.\d+/
    );
  });

  it("fires onOpenNotes from the brand chooser's Updates button", () => {
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
    const dlg = openChooser();
    fireEvent.click(within(dlg).getByRole("button", { name: "[HSV] Updates" }));
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// DISPOSITION (REPLACE): the logo no longer goes to the Vault and the tag
// line no longer holds two buttons. The logo and the one-line tag are one
// button whose name says what it opens; it opens the brand chooser (About &
// Legal / [HSV] Updates). The DOM-only "tag and version on one line" and
// "styled as the tag" tests are retired: the one-line claim is asserted with
// rendered geometry in e2e (s6-11-desktop-smoke, desktop-1440).
describe("Header brand button and chooser", () => {
  function renderBrand(
    props: { onNavigateCards?: () => void; onOpenNotes?: () => void; onOpenAbout?: () => void } = {}
  ) {
    return render(
      <Header
        userEmail={null}
        onLogout={vi.fn()}
        onSignIn={vi.fn()}
        onChangePassword={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenFeedback={vi.fn()}
        {...props}
      />
    );
  }

  it("shows the full logo at its intrinsic size inside the brand button", () => {
    renderBrand();
    const logo = screen.getByRole("img", { name: "Hyperspace Vault" });
    expect(logo.getAttribute("srcset")).toMatch(/ 2x, .* 3x$/);
    expect(logo.getAttribute("width")).toBe("158");
    expect(logo.getAttribute("height")).toBe("46");
    expect(screen.getByRole("button", { name: BRAND }).contains(logo)).toBe(true);
    expect(screen.queryByText(/\[HSV\] Hyperspace Vault/)).not.toBeInTheDocument();
    expect(screen.queryByText(/release notes/i)).not.toBeInTheDocument();
  });

  it("opens the chooser instead of going to the Vault; X closes it", () => {
    const onNavigateCards = vi.fn();
    renderBrand({ onNavigateCards });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const dlg = openChooser();
    expect(onNavigateCards).not.toHaveBeenCalled();
    expect(
      within(dlg)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["", "About & Legal", "[HSV] Updates"]);
    expect(within(dlg).getByRole("img", { name: "Hyperspace Vault" })).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape closes the chooser without calling either handler", () => {
    const onOpenAbout = vi.fn();
    const onOpenNotes = vi.fn();
    renderBrand({ onOpenAbout, onOpenNotes });
    openChooser();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onOpenAbout).not.toHaveBeenCalled();
    expect(onOpenNotes).not.toHaveBeenCalled();
  });

  it("has no separate About or version buttons on the tag line", () => {
    renderBrand();
    expect(screen.queryByRole("button", { name: /^unofficial fan project$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^v\d+\.\d+/ })).toBeNull();
  });
});

// DISPOSITION (v3.0 Command pod): the peer tab bar (Vault, Deck Check, the
// conditional [HSV] Updates and share tabs) and the settings / import-export
// "way-back Vault + one active tab" shape are replaced by the Command pod
// (NavPod.tsx). Each old test, by its old describe:
//   peer nav: "both tabs, Vault active" -> PORT ("Vault lit with Collection
//     current by default"); "Deck Check active on deck-check" -> PORT ("Decks
//     lit, Deck Check current"); "onNavigateDeckCheck on click" -> PORT (the
//     Decks item and its Deck Check sub item); "Vault from deck-check" ->
//     PORT (the Vault item); "no Deck Check on settings" -> REPLACE ("no
//     item lit on settings / import-export, the pod is unchanged").
//   import-export nav: "active Import / Export tab + way-back Vault" and
//     settings-view nav: "active Settings tab + way-back Vault" -> REPLACE
//     (same test as above: nothing lit; the Vault item goes back); "no Deck
//     Check on import-export" -> RETIRE (the pod keeps Decks on every view);
//     "Import / Export tab transient" -> RETIRE (no such tab exists).
//   New Arrivals nav: "hidden when not unread" and "visible while active"
//     -> PORT (the pod's Updates item keeps that rule, owner 2026-11-07);
//     "not on settings" -> REPLACE ("shown on settings while unread": the
//     pod keeps its items on every view); "leftmost" -> REPLACE ("Vault,
//     Decks, Updates in that order"); the cue / no-cue tests -> PORT (the
//     amber cue now sits on the Updates label); "fires onOpenNotes" -> PORT.
//   shared-vault nav: "no tab without a share" -> PORT; "named by the
//     owner" -> PORT (a Vault sub item); "active when shared" -> PORT
//     (amber Vault item, the share sub item current, My vault beside it);
//     "fires onNavigateShared" -> PORT; "signed in too" -> PORT; "not on
//     settings" -> PORT (folded away with the Vault item).
// Stash entries (the Stashes sub item, its hover menu), the glide motion and
// reduced motion are covered in NavPod.test.tsx.
const BASE = {
  onLogout: () => {},
  onSignIn: () => {},
  onChangePassword: () => {},
  onOpenSettings: () => {},
  onOpenAbout: () => {},
  onOpenFeedback: () => {},
};
const top = (id: string) => document.querySelector<HTMLElement>(`[data-top="${id}"]`)!;
const sub = (key: string) => screen.queryByRole("button", { name: SUB_NAME[key] ?? key });
const SUB_NAME: Record<string, string> = {
  collection: "Collection",
  stashes: "Stashes",
  "deck-check": "Deck Check",
  own: "My vault",
};

describe("Header Command pod", () => {
  it("lights Vault with Collection current by default; Decks and Updates are items", () => {
    render(<Header userEmail={null} {...BASE} />);
    expect(top("vault").closest(".pod__item")!.className).toContain("pod__item--on");
    expect(sub("collection")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Decks" })).toBeInTheDocument();
    // Deck Check is folded away while Decks is not lit.
    expect(sub("deck-check")).toBeNull();
  });

  it("orders the items Vault, Decks, [HSV] Updates (Updates while unread)", () => {
    render(<Header userEmail={null} {...BASE} hasUnread />);
    const items = [...document.querySelectorAll<HTMLElement>("[data-top]")].map(
      (b) => b.dataset.top
    );
    expect(items).toEqual(["vault", "decks", "updates"]);
    expect(screen.getByRole("button", { name: "[HSV] Updates" })).toBeInTheDocument();
  });

  it("lights Decks with Deck Check current on deck-check", () => {
    render(<Header userEmail={null} {...BASE} view="deck-check" />);
    expect(top("decks").closest(".pod__item")!.className).toContain("pod__item--on");
    expect(top("vault").closest(".pod__item")!.className).not.toContain("pod__item--on");
    expect(sub("deck-check")).toHaveAttribute("aria-current", "page");
    expect(sub("collection")).toBeNull();
  });

  it("calls onNavigateDeckCheck from the Decks item and from Deck Check", () => {
    const onNavigateDeckCheck = vi.fn();
    render(
      <Header
        userEmail={null}
        {...BASE}
        view="deck-check"
        onNavigateDeckCheck={onNavigateDeckCheck}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Decks" }));
    fireEvent.click(sub("deck-check")!);
    expect(onNavigateDeckCheck).toHaveBeenCalledTimes(2);
  });

  it("calls onNavigateCards from the Vault item and from Collection", () => {
    const onNavigateCards = vi.fn();
    render(<Header userEmail={null} {...BASE} onNavigateCards={onNavigateCards} />);
    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    fireEvent.click(sub("collection")!);
    expect(onNavigateCards).toHaveBeenCalledTimes(2);
  });

  it.each(["settings", "import-export"] as const)(
    "lights no item on %s and the Vault item goes back to the Vault",
    (view) => {
      const onNavigateCards = vi.fn();
      render(
        <Header userEmail="a@b.com" {...BASE} view={view} onNavigateCards={onNavigateCards} />
      );
      expect(document.querySelectorAll(".pod__item--on")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Collection" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Vault" }));
      expect(onNavigateCards).toHaveBeenCalledTimes(1);
    }
  );

  it("does not show the Updates item when nothing is unread and it isn't the view", () => {
    render(<Header userEmail={null} {...BASE} />);
    expect(screen.queryByRole("button", { name: "[HSV] Updates" })).toBeNull();
    expect(document.querySelector('[data-top="updates"]')).toBeNull();
  });

  it("keeps the Updates item while it is the view, even once read", () => {
    render(<Header userEmail={null} {...BASE} view="new-arrivals" />);
    expect(screen.getByRole("button", { name: "[HSV] Updates" })).toBeInTheDocument();
  });

  it.each(["cards", "deck-check", "settings", "import-export"] as const)(
    "shows the Updates item while unread (%s)",
    (view) => {
      render(<Header userEmail="a@b.com" {...BASE} view={view} hasUnread />);
      expect(screen.getByRole("button", { name: "[HSV] Updates" })).toBeInTheDocument();
    }
  );

  it("lights Updates on new-arrivals", () => {
    render(<Header userEmail={null} {...BASE} view="new-arrivals" />);
    expect(top("updates")).toHaveAttribute("aria-current", "page");
  });

  it("carries the amber cue on the Updates label, the tag line and the chooser while unread", () => {
    render(<Header userEmail={null} {...BASE} hasUnread />);
    expect(top("updates").querySelector(".pod__label")!.className).toContain("nav-tab--cue");
    const tag = screen
      .getByRole("button", { name: BRAND })
      .querySelector(".app-header__brand-line")!;
    expect(tag.className).toContain("app-header__brand-line--cue");
    const dlg = openChooser();
    const updates = within(dlg).getByRole("button", { name: "[HSV] Updates" });
    expect(updates.className).toContain("m-chooser__btn--cue");
  });

  it("carries no cue anywhere once read", () => {
    render(<Header userEmail={null} {...BASE} view="new-arrivals" />);
    expect(top("updates").querySelector(".pod__label")!.className).not.toContain("nav-tab--cue");
    const tag = screen
      .getByRole("button", { name: BRAND })
      .querySelector(".app-header__brand-line")!;
    expect(tag.className).not.toContain("app-header__brand-line--cue");
  });

  it("fires onOpenNotes from the Updates item", () => {
    const onOpenNotes = vi.fn();
    render(<Header userEmail={null} {...BASE} hasUnread onOpenNotes={onOpenNotes} />);
    fireEvent.click(screen.getByRole("button", { name: "[HSV] Updates" }));
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });
});

describe("Header Command pod: shared vault", () => {
  it("lists no share without a share session", () => {
    render(<Header userEmail={null} {...BASE} />);
    expect(screen.queryByRole("button", { name: "Bobs big vault" })).toBeNull();
  });

  it("lists the share by its owner-chosen name under Vault, signed out or in", () => {
    const { unmount } = render(<Header userEmail={null} {...BASE} shareName="Bobs big vault" />);
    expect(screen.getByRole("button", { name: "Bobs big vault" })).toBeInTheDocument();
    expect(screen.queryByText(/shared with me/i)).not.toBeInTheDocument();
    unmount();
    render(<Header userEmail="a@b.com" {...BASE} shareName="Bobs big vault" />);
    expect(screen.getByRole("button", { name: "Bobs big vault" })).toBeInTheDocument();
  });

  it("turns the Vault item amber on the shared view: My vault · the share, current", () => {
    const onNavigateCards = vi.fn();
    render(
      <Header
        userEmail="a@b.com"
        {...BASE}
        shareName="Bobs big vault"
        view="shared"
        onNavigateCards={onNavigateCards}
      />
    );
    expect(top("vault").closest(".pod__item")!.className).toContain("pod__item--amber");
    expect(screen.getByTestId("nav-pod").className).toContain("pod--shared");
    expect(screen.getByRole("button", { name: "Bobs big vault" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(sub("collection")).toBeNull();
    expect(sub("stashes")).toBeNull();
    fireEvent.click(sub("own")!);
    expect(onNavigateCards).toHaveBeenCalledTimes(1);
  });

  it("fires onNavigateShared from the share's sub item", () => {
    const onNavigateShared = vi.fn();
    render(
      <Header
        userEmail={null}
        {...BASE}
        shareName="Bobs big vault"
        onNavigateShared={onNavigateShared}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Bobs big vault" }));
    expect(onNavigateShared).toHaveBeenCalledTimes(1);
  });

  it("folds the share away with the Vault item on settings", () => {
    render(<Header userEmail="a@b.com" {...BASE} view="settings" shareName="Bobs big vault" />);
    expect(screen.queryByRole("button", { name: "Bobs big vault" })).toBeNull();
  });
});
