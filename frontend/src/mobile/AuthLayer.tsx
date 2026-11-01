import { AuthModal } from "../screens/auth/AuthModal";

// The desktop AuthModal, unchanged, as a centred layer over the current phone
// screen. The wrapper only scopes the phone CSS (shell.css `.m-authlayer`:
// card width min(100%, 420px) inside a 16 px gutter, 16 px inputs, 44 px
// controls, X top-right).
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
