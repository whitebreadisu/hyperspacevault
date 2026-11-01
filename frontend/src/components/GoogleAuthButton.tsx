import { GoogleIcon } from "./GoogleIcon";
import "./GoogleAuthButton.css";

interface Props {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** Google's branding guidelines specify the button text ("Sign in with
 * Google" / "Sign up with Google" -- Google publishes both variants; the
 * caller picks one to match its own login-vs-signup copy, as AuthModal
 * does), the logo (GoogleIcon, unscaled multi-color mark), and roughly this
 * button shape -- dark-theme variant since this app's modals are dark
 * surfaces (.auth-modal-card's --bg-surface is dark; see AuthModal.css). */
export function GoogleAuthButton({ label, onClick, disabled }: Props) {
  return (
    <button type="button" className="google-auth-button" onClick={onClick} disabled={disabled}>
      <GoogleIcon size={18} />
      <span>{label}</span>
    </button>
  );
}
