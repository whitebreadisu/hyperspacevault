import { useEffect, useState } from "react";
import { MSWUButton } from "./MSWUButton";
import { go } from "./router";

// BL-247 S1-08: the header's account slot (rev4 MHome.jsx:77-117 = desktop
// UserMenu.tsx). Signed out: a "Sign in" SWUButton (desktop voice) that opens
// the auth layer. Signed in: the avatar bubble (initial) opening desktop's
// menu -- email row, Settings, Change Password (password accounts only),
// About & Legal, Log Out. Closes on a scrim tap, Escape or any item.
//
// BL-252 S6-03: inside a share (the shared vault shown) an anonymous viewer
// gets a Sign in TEXT link (rev4 R4-8, 13 px / 0.04em so the wordmark never
// truncates); a signed-in viewer keeps the bubble. Its Settings / Change
// Password leave the share first (`onLeaveShare`), as desktop's avatar menu
// switches the pane away from the shared view.

interface Props {
  email: string | null;
  hasPasswordProvider: boolean;
  onSignIn: () => void;
  onLogout: () => void;
  /** The shared vault is shown (S6-03). */
  shared?: boolean;
  /** Shows the viewer's own vault again (before an account screen opens). */
  onLeaveShare?: () => void;
}

export function AccountSlot({
  email,
  hasPasswordProvider,
  onSignIn,
  onLogout,
  shared = false,
  onLeaveShare,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!email && shared) {
    return (
      <div className="m-acct m-acct--shared">
        <button type="button" className="m-shared-signin" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    );
  }
  if (!email) {
    return (
      <div className="m-acct">
        <MSWUButton size="sm" className="m-acct__signin" onClick={onSignIn}>
          Sign in
        </MSWUButton>
      </div>
    );
  }

  const nav = (hash: string) => {
    setOpen(false);
    go(hash);
  };
  const navOwn = (hash: string) => {
    if (shared) onLeaveShare?.();
    nav(hash);
  };
  return (
    <div className="m-acct">
      <button
        type="button"
        className="m-acct__hit"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="app-header__avatar m-acct__avatar">{email.charAt(0).toUpperCase()}</span>
      </button>
      {open ? (
        <>
          <div className="m-acct__scrim" onClick={() => setOpen(false)} />
          <div className="app-header__menu m-acct__menu" role="menu">
            <div className="app-header__menu-email m-acct__email">{email}</div>
            <button
              type="button"
              role="menuitem"
              className="app-header__menu-item m-acct__item"
              onClick={() => navOwn("#/more/settings")}
            >
              Settings
            </button>
            {hasPasswordProvider ? (
              <button
                type="button"
                role="menuitem"
                className="app-header__menu-item m-acct__item"
                onClick={() => navOwn("#/more/password")}
              >
                Change Password
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="app-header__menu-item m-acct__item"
              onClick={() => nav("#/about")}
            >
              About & Legal
            </button>
            <button
              type="button"
              role="menuitem"
              className="app-header__menu-item m-acct__item"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              Log Out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
