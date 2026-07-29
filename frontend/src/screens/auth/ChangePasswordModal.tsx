import { useState } from "react";
import type { FormEvent } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { useAuth } from "../../context/AuthContext";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import "./AuthModal.css";

const FRIENDLY_ERRORS: Record<string, string> = {
  "auth/wrong-password": "Current password is incorrect.",
  "auth/invalid-credential": "Current password is incorrect.",
  "auth/weak-password": "New password is too weak — use at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
};

function describeError(err: unknown): string {
  const code = err instanceof Error ? (err as { code?: string }).code : undefined;
  return (code && FRIENDLY_ERRORS[code]) ?? "Something went wrong. Please try again.";
}

interface Props {
  onClose: () => void;
}

/** BL-23: change-password modal opened from the avatar menu (UserMenu). Reuses
 * AuthModal's overlay/card/form CSS classes rather than forking new ones --
 * same visual family, different field set. Firebase requires a *recent*
 * sign-in for sensitive account operations like updatePassword, so this
 * always reauthenticates with the current password immediately beforehand
 * (reauthenticateWithCredential) rather than relying on session recency.
 * Client-side only -- no backend call, matching AuthModal's grain. Pulls
 * `user` from AuthContext directly (this modal is only ever rendered while
 * authenticated, from App.tsx) instead of threading it down as a prop. */
export function ChangePasswordModal({ onClose }: Props) {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useModalDismiss(onClose);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (!user || !user.email) {
      setError("Something went wrong. Please try again.");
      return;
    }

    setSubmitting(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
        <div
          className="auth-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Change Password"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <h2 className="auth-card__subtitle">Password Changed</h2>
          <p className="auth-success">Password changed.</p>
          <button type="button" className="auth-submit" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    // BL-153 straggler -- see AuthModal.tsx's primary render note.
    <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
      <div
        className="auth-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Change Password"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <h2 className="auth-card__subtitle">Change Password</h2>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span className="auth-field__label">Current Password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-field__label">New Password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-field__label">Confirm New Password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <div className="auth-modal-actions">
            <button type="button" className="auth-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? "Please wait…" : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
