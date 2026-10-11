import { AuthModal } from "../screens/auth/AuthModal";

// BL-247 S1-09: the desktop AuthModal, unchanged, as a centred layer over the
// current phone screen (rev4 MAccountScreens.jsx:337-414). The wrapper only
// scopes the phone CSS (shell.css `.m-authlayer`: card width
// min(100% - 32px, 420px), 16 px inputs, 44 px controls, X top-right).
// Open state and the auto-close-on-auth effect live in MobileApp, as App.tsx
// does for desktop.

interface Props {
  onClose: () => void;
  onSignedUp: () => void;
  onGoogleLinked: () => void;
}

export function AuthLayer({ onClose, onSignedUp, onGoogleLinked }: Props) {
  return (
    <div className="m-authlayer">
      <AuthModal onClose={onClose} onSignedUp={onSignedUp} onGoogleLinked={onGoogleLinked} />
    </div>
  );
}
