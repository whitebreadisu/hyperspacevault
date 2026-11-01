import { useCallback, useEffect, useRef, useState } from "react";
import { useModalDismiss } from "../hooks/useModalDismiss";

interface Props {
  userEmail: string;
  onLogout: () => void;
  onChangePassword: () => void;
  onOpenSettings: () => void;
  /** Opens the About & Legal modal, same App-owned pattern as the
   * other menu-item callbacks. */
  onOpenAbout: () => void;
  /** Hides the Change Password item entirely for a Google-only account (no
   * `password` entry in providerData -- there's no password to change;
   * ADR-0016 decision 3). Defaults to true, so a caller that omits it shows
   * the item. */
  hasPasswordProvider?: boolean;
}

/** The authenticated top-right account slot: an avatar button that opens a
 * dropdown menu. Plain positioned div -- no portal. The menu holds a
 * non-interactive email display row, then Settings (navigates to the
 * settings pane rather than opening a modal, but threads through App the
 * same way), Change Password (password accounts only), About & Legal, and
 * Log Out. About & Legal is a second entry point onto the same About modal
 * the header's brand link opens (that one is reachable anonymous +
 * signed-in; this one is a signed-in convenience, not the sole path).
 * Delete Account is not here: its trigger is the "danger zone" section at
 * the bottom of the Settings pane (SettingsPage.tsx). The menu only exists
 * while authenticated (Header renders Sign In otherwise), so Settings is
 * unreachable for anonymous visitors by construction. */
export function UserMenu({
  userEmail,
  onLogout,
  onChangePassword,
  onOpenSettings,
  onOpenAbout,
  hasPasswordProvider = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = userEmail.charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
    };
  }, [open]);

  // Only Escape-key dismissal comes from the shared hook -- see
  // FinishFilter.tsx's comment for why the outside-mousedown detection
  // above stays local instead of also moving into the hook.
  const closeMenu = useCallback(() => setOpen(false), []);
  useModalDismiss(closeMenu, { enabled: open });

  function handleLogout() {
    setOpen(false);
    onLogout();
  }

  function handleChangePassword() {
    setOpen(false);
    onChangePassword();
  }

  function handleOpenSettings() {
    setOpen(false);
    onOpenSettings();
  }

  function handleOpenAbout() {
    setOpen(false);
    onOpenAbout();
  }

  return (
    <div className="app-header__user-menu" ref={ref}>
      <button
        type="button"
        className="app-header__avatar"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initial}
      </button>

      {open && (
        <div className="app-header__menu" role="menu">
          <div className="app-header__menu-email">{userEmail}</div>
          <button
            type="button"
            role="menuitem"
            className="app-header__menu-item"
            onClick={handleOpenSettings}
          >
            Settings
          </button>
          {hasPasswordProvider && (
            <button
              type="button"
              role="menuitem"
              className="app-header__menu-item"
              onClick={handleChangePassword}
            >
              Change Password
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="app-header__menu-item"
            onClick={handleOpenAbout}
          >
            About & Legal
          </button>
          <button
            type="button"
            role="menuitem"
            className="app-header__menu-item"
            onClick={handleLogout}
          >
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
