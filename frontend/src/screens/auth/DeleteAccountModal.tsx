import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from "firebase/auth";
import { useAuth } from "../../context/AuthContext";
import { deleteAccount } from "../../api/account";
import { describeGoogleAuthError, hasPasswordProvider } from "../../utils/googleAuth";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import "./AuthModal.css";

const FRIENDLY_REAUTH_ERRORS: Record<string, string> = {
  "auth/wrong-password": "Current password is incorrect.",
  "auth/invalid-credential": "Current password is incorrect.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
};

function describeReauthError(err: unknown): string {
  const code = err instanceof Error ? (err as { code?: string }).code : undefined;
  return (code && FRIENDLY_REAUTH_ERRORS[code]) ?? "Something went wrong. Please try again.";
}

const CONFIRM_PHRASE = "DELETE";

const RETRY_GUIDANCE =
  "Your data was deleted but the account removal failed — please sign out and sign in again, then retry Delete Account.";

interface Props {
  onClose: () => void;
}

/** BL-87: two-level destructive confirmation, following ChangePasswordModal's
 * modal/CSS grain (reuses AuthModal.css's .auth-modal-* classes plus the
 * .auth-danger-* modifiers below). Step 1 states the consequences and
 * collects the current password (reauth is required -- same Firebase
 * platform constraint BL-23 already works around); step 2 is a
 * type-to-confirm gate ("DELETE", case-sensitive, exact match) whose
 * destructive button stays disabled until it matches.
 *
 * The final confirm on step 2 runs a strict, load-bearing sequence: (a)
 * reauthenticate, (b) the backend purge (DELETE /api/account), (c) Firebase
 * deleteUser(). Purge-first is deliberate -- if deleteUser() fails *after*
 * a successful purge, the failure is safely retryable: the Firebase account
 * still exists, so the user can sign back in and run this flow again; the
 * repeat purge deletes zero rows (idempotent) and only deleteUser() needs
 * to succeed. The reverse order would risk deleting the auth identity while
 * Postgres data survives, with no verified-token path left to reach it.
 *
 * BL-118 / ADR-0016 §3: the recent-auth gate above is provider-aware --
 * `passwordProvider` is false for a Google-only account (born via Google
 * sign-in, no password ever set), so step 1 skips the current-password
 * field entirely and reauthenticates via reauthenticateWithPopup(user, new
 * GoogleAuthProvider()) instead, right before the same purge-then-delete
 * sequence below. Everything past "reauthenticate, however it happened" is
 * unchanged. */
export function DeleteAccountModal({ onClose }: Props) {
  const { user } = useAuth();
  const passwordProvider = hasPasswordProvider(user);
  const [step, setStep] = useState<"warn" | "confirm">("warn");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // BL-153: submitting-guard lives inside the callback (not `enabled`) so
  // the listener stays attached and just no-ops while submitting, matching
  // the original always-attached effect -- see useModalDismiss's docstring.
  const dismissUnlessSubmitting = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);
  useModalDismiss(dismissUnlessSubmitting);

  function handleContinue(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStep("confirm");
  }

  async function handleDelete() {
    if (!user || !user.email) {
      setError("Something went wrong. Please try again.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      try {
        if (passwordProvider) {
          const credential = EmailAuthProvider.credential(user.email, currentPassword);
          await reauthenticateWithCredential(user, credential);
        } else {
          await reauthenticateWithPopup(user, new GoogleAuthProvider());
        }
      } catch (err) {
        // BL-118: a Google reauth popup the user closed themselves
        // (auth/popup-closed-by-user etc.) describes to `null` -- see
        // describeGoogleAuthError -- so this silently returns to step 1
        // rather than showing an alarming "something went wrong" for a
        // cancellation that isn't actually a failure.
        const msg = passwordProvider ? describeReauthError(err) : describeGoogleAuthError(err);
        if (msg) setError(msg);
        setStep("warn");
        return;
      }

      try {
        await deleteAccount();
      } catch {
        setError(
          "Something went wrong deleting your data. Your account is intact — please try again."
        );
        return;
      }

      try {
        await deleteUser(user);
        onClose();
      } catch {
        setError(RETRY_GUIDANCE);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const confirmMatches = confirmText === CONFIRM_PHRASE;

  if (step === "warn") {
    return (
      <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
        <div
          className="auth-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Delete Account"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>

          <h2 className="auth-card__subtitle">Delete Account</h2>
          <p className="auth-danger-warning">
            This permanently deletes your account and all inventory records. This cannot be undone.
          </p>

          <form className="auth-form" onSubmit={handleContinue}>
            {passwordProvider ? (
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
            ) : (
              // BL-118: Google-only account -- no password to collect.
              // Reauthentication happens via a Google popup on final
              // confirm instead (see handleDelete).
              <p className="auth-success">
                You&apos;ll be asked to reauthenticate with Google before your account is deleted.
              </p>
            )}

            {error && <p className="auth-error">{error}</p>}

            <div className="auth-modal-actions">
              <button type="button" className="auth-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="auth-danger-submit">
                Continue
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-modal-overlay modal-overlay" onClick={submitting ? undefined : onClose}>
      <div
        className="auth-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Account"
        onClick={(e) => e.stopPropagation()}
      >
        {!submitting && (
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}

        <h2 className="auth-card__subtitle">Are You Sure?</h2>
        <p className="auth-danger-warning">
          This permanently deletes your account and all inventory records and cannot be undone. Type{" "}
          <strong>DELETE</strong> to confirm.
        </p>

        <div className="auth-form">
          <label className="auth-field">
            <span className="auth-field__label">Type DELETE to confirm</span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              disabled={submitting}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <div className="auth-modal-actions">
            <button type="button" className="auth-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="auth-danger-submit"
              onClick={handleDelete}
              disabled={!confirmMatches || submitting}
            >
              {submitting ? "Please wait…" : "Delete Account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
