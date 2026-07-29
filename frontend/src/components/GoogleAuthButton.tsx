import { GoogleIcon } from "./GoogleIcon";
import "./GoogleAuthButton.css";

interface Props {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** BL-118: Google's branding guidelines specify the button text ("Sign in
 * with Google" / "Sign up with Google" -- Google publishes both variants,
 * chosen by the caller to match AuthModal/DeleteAccountModal's own
 * login-vs-signup or sign-in-vs-reauth copy), the logo (GoogleIcon, unscaled
 * multi-color mark), and roughly this button shape -- dark-theme variant
 * since this app's modals are dark surfaces (.auth-modal-card's --bg-surface
 * is dark; see AuthModal.css). Reused as-is by DeleteAccountModal's
 * Google-reauth path so both call sites render an identical, recognizable
 * button rather than two near-duplicates. */
export function GoogleAuthButton({ label, onClick, disabled }: Props) {
  return (
    <button type="button" className="google-auth-button" onClick={onClick} disabled={disabled}>
      <GoogleIcon size={18} />
      <span>{label}</span>
    </button>
  );
}
