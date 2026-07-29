import { useCallback, useEffect, useRef, useState } from "react";
import { useModalDismiss } from "../hooks/useModalDismiss";

interface Props {
  userEmail: string;
  onLogout: () => void;
  onChangePassword: () => void;
  onOpenSettings: () => void;
  /** BL-125: opens the About & Legal modal, same App-owned pattern as the
   * other menu-item callbacks. */
  onOpenAbout: () => void;
  /** BL-118 / ADR-0016 §3: hides the Change Password item entirely for a
   * Google-only account (no `password` entry in providerData -- there's no
   * password to change). Defaults to true so every pre-existing render call
   * (this component's own tests via Header.test.tsx included) keeps
   * showing the item unchanged. */
  hasPasswordProvider?: boolean;
}

/** BL-22: evolves the authenticated top-right account slot (previously
 * inline email + Log Out, BL-56) into an avatar button that opens a
 * dropdown menu. Plain positioned div -- no portal (BL-45 tracks
 * portal-based positioning separately). The menu holds a non-interactive
 * email display row plus a list of menu-item buttons -- BL-23 change
 * password was the first of these. BL-25 adds Settings at the top (it
 * navigates to the settings pane rather than opening a modal, but threads
 * through App exactly the same way). BL-125 adds "About & Legal" after the
 * Change Password/Settings-group items and above Log Out -- signed-in users
 * get this as a second entry point onto the same About modal the header's
 * brand-line microcopy also opens (that one is reachable anonymous +
 * signed-in; this one is authenticated-only, a convenience rather than the
 * sole path). BL-87 originally added a destructive Delete Account item below
 * Log Out here; BL-129 R5 relocated its trigger to a dedicated "danger zone"
 * section at the bottom of the Settings pane (SettingsPage.tsx) -- this menu
 * no longer offers it at all, and onDeleteAccount no longer threads through
 * this component. The menu only exists while authenticated (Header renders
 * Sign In otherwise), so Settings is unreachable for anonymous visitors by
 * construction. */
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

  // BL-153: Escape-key dismissal only, extracted to the shared hook -- see
  // FinishFilter.tsx's identical comment for why the outside-mousedown
  // detection above stays local instead of also moving into the hook.
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
