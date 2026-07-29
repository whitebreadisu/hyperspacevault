import { useState } from "react";
import type { FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getAdditionalUserInfo,
} from "firebase/auth";
import { auth } from "../../firebase";
import { GoogleAuthButton } from "../../components/GoogleAuthButton";
import { describeGoogleAuthError } from "../../utils/googleAuth";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import "./AuthModal.css";

type Mode = "login" | "signup";

// BL-116: a third top-level screen alongside the login/signup form and the
// signup "check your email" screen above -- "forgot-email" is the reset
// address entry, "forgot-sent" is its confirmation. Kept separate from
// `Mode` since neither forgot-password screen has a login/signup toggle of
// its own; they're reached FROM the login form and return TO it.
type Screen = "credentials" | "forgot-email" | "forgot-sent";

const FRIENDLY_ERRORS: Record<string, string> = {
  "auth/invalid-email": "That email address looks invalid.",
  "auth/user-not-found": "No account found for that email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/invalid-credential": "Incorrect email or password.",
  // BL-118 / ADR-0016 §2: this code is only reachable from the signup path
  // (createUserWithEmailAndPassword). Enumeration protection means we can't
  // pre-flight-detect which provider actually owns the address (no
  // fetchSignInMethodsForEmail lookup), so the copy can't say *which* other
  // sign-in method it is -- it just names Google as the one other provider
  // this app offers, for the reverse-collision case (Google-first user
  // later tries to register with a password).
  "auth/email-already-in-use":
    "An account already exists for that email. If you originally signed up with Google, use Continue with Google instead.",
  "auth/weak-password": "Password must be at least 6 characters.",
};

// BL-116: deliberately narrower than FRIENDLY_ERRORS above -- see
// handleSendReset's catch clause for why. Only codes that describe a
// client-side input problem (bad format) or a transient failure (rate
// limit, network) are safe to surface distinctly for password reset; an
// unknown-account error is NOT in this map on purpose.
const RESET_FRIENDLY_ERRORS: Record<string, string> = {
  "auth/invalid-email": "That email address looks invalid.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "Network error. Please check your connection and try again.",
};

function describeError(err: unknown): string {
  const code = err instanceof Error ? (err as { code?: string }).code : undefined;
  return (code && FRIENDLY_ERRORS[code]) ?? "Something went wrong. Please try again.";
}

interface Props {
  onClose: () => void;
  /** BL-16: called synchronously, *before* createUserWithEmailAndPassword is
   * even invoked, so App can flag "a signup is in flight" ahead of Firebase's
   * onAuthStateChanged notification. Without this, App's existing
   * auto-close-on-auth effect (which exists so the modal "closes regardless
   * of how auth resolved") would close the modal the instant the new user
   * is signed in -- before the "check your email" screen below ever
   * renders. Optional so every pre-existing `<AuthModal onClose={...} />`
   * call site (this file's own login-flow tests included) keeps compiling
   * unchanged. */
  onSignedUp?: () => void;
  /** BL-118 / ADR-0016 §1: mirrors onSignedUp's contract -- called as soon
   * as a Google sign-in is recognized as an auto-link onto an existing
   * account (see handleGoogleSignIn), before this component transitions to
   * the "linked" notice screen, so App can suppress its auto-close-on-auth
   * effect for that one transition the same way it does mid-signup. Without
   * this, the notice screen below would never actually be seen -- App would
   * close the modal the instant `user` updates. Optional for the same
   * reason onSignedUp is. */
  onGoogleLinked?: () => void;
}

/** Sign-in / create-account modal (BL-56 §5.5). Replaces the old full-screen
 * AuthScreen gate -- opened from the header's Sign In control, over the
 * anonymous Cards view. On a successful login, Firebase's onAuthStateChanged
 * updates AuthContext's `user`; App closes this modal from that transition
 * (see App.tsx), not from a callback out of here. Signup instead lands on
 * its own "check your email" screen below (BL-16) -- the account is created
 * and the user is signed in immediately, same as before, but the modal now
 * waits for an explicit dismiss instead of vanishing the moment auth
 * resolves, so the verification message actually gets seen. */
export function AuthModal({ onClose, onSignedUp, onGoogleLinked }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(null);

  // BL-118: Google sign-in state, independent of the email/password submit
  // state above -- both actions live on the same credentials screen but are
  // mutually exclusive user gestures, so they share the one `error` banner
  // rather than each needing their own.
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [googleLinkedNotice, setGoogleLinkedNotice] = useState(false);

  // BL-116 forgot-password state, independent of the login/signup fields
  // above -- `resetEmail` starts as a copy of `email` (prefilled) at the
  // moment "Forgot password?" is clicked, not bound to it, so editing one
  // never mutates the other.
  const [screen, setScreen] = useState<Screen>("credentials");
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  useModalDismiss(onClose);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        onSignedUp?.();
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        try {
          // BL-95: the action link still goes through Firebase's hosted
          // __/auth/action page (customizing the action URL itself is
          // confirmed blocked on this project -- see VerifyEmailAction's
          // docstring), but its "Continue" button navigates here afterward.
          // The `emailVerified=1` marker tells VerifyEmailAction that
          // landing means verification just completed, without needing an
          // oobCode to apply.
          await sendEmailVerification(credential.user, {
            url: `${window.location.origin}/?emailVerified=1`,
          });
        } catch {
          // Account creation already succeeded -- the site-wide banner's own
          // Resend action (VerifyEmailBanner) covers recovering from a
          // failed verification-email send, so this doesn't block the
          // confirmation screen below.
        }
        setVerificationSentTo(email);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  /** BL-118 / ADR-0016: Google sign-in via popup, with a redirect fallback
   * for the one popup failure mode that isn't the user's own doing --
   * `auth/popup-blocked` (the browser itself refused to open it). Every
   * other popup failure (closed by the user, a real provider error) is left
   * alone; falling back to a full-page redirect for those too would be
   * surprising (the user didn't ask for a page navigation, they closed a
   * window).
   *
   * Collision handling is deliberately *reactive*, per ADR-0016 §1/§2: no
   * pre-flight fetchSignInMethodsForEmail lookup (email-enumeration
   * protection makes that call unreliable/empty anyway) -- this only reacts
   * to what signInWithPopup resolves or throws. Firebase's own trusted-
   * provider auto-link handles the common collision transparently (verified
   * password account + Google, same email -> linked, same UID); the only
   * thing left to do here is *notice* that happened and say so in-modal.
   * getAdditionalUserInfo(result).isNewUser is false whenever this UID
   * already existed (a fresh account is always isNewUser: true) -- combined
   * with a `password` entry in providerData, that reliably means "signed
   * into a pre-existing account that also has a password credential",
   * whether the auto-link just happened this instant or happened in an
   * earlier session; either way the notice is factually accurate. A
   * redirect completing on reload (getRedirectResult, see AuthContext) can't
   * show this notice -- this component won't still be mounted by then; that
   * gap is accepted as a fallback-path limitation (see PR description). */
  async function handleGoogleSignIn() {
    setError(null);
    setGoogleSubmitting(true);
    const provider = new GoogleAuthProvider();
    try {
      let result;
      try {
        result = await signInWithPopup(auth, provider);
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: string }).code : undefined;
        if (code === "auth/popup-blocked") {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw err;
      }

      const info = getAdditionalUserInfo(result);
      const linkedToExisting =
        !!info &&
        !info.isNewUser &&
        result.user.providerData.some((p) => p.providerId === "password");
      if (linkedToExisting) {
        onGoogleLinked?.();
        setGoogleLinkedNotice(true);
      }
    } catch (err) {
      const msg = describeGoogleAuthError(err);
      if (msg) setError(msg);
    } finally {
      setGoogleSubmitting(false);
    }
  }

  /** BL-116: request a password reset email. Mind email enumeration --
   * Firebase's email-enumeration-protection setting (on by default for
   * newer projects) makes sendPasswordResetEmail resolve successfully even
   * for an unknown address, but a project *without* that protection can
   * still throw `auth/user-not-found`. Either way, this UI must not let the
   * response distinguish "no account" from "sent": any error that isn't a
   * recognized, non-account-revealing failure (bad email format, rate
   * limit, network) is folded into the same success screen as a real send.
   */
  async function handleSendReset(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetSubmitting(true);
    try {
      // BL-116: reuses the BL-95 continue-URL marker mechanism -- action
      // URL customization is confirmed blocked on this project (see
      // VerifyEmailAction's docstring), so a real reset link still bounces
      // through Firebase's hosted __/auth/action page first. Its own
      // "Continue" button, once the hosted page finishes the reset itself,
      // carries this marker back to our origin so the in-app landing can
      // show a completion screen without an oobCode to apply.
      await sendPasswordResetEmail(auth, resetEmail, {
        url: `${window.location.origin}/?passwordReset=1`,
      });
      setScreen("forgot-sent");
    } catch (err) {
      const code = err instanceof Error ? (err as { code?: string }).code : undefined;
      if (code && code in RESET_FRIENDLY_ERRORS) {
        setResetError(RESET_FRIENDLY_ERRORS[code]);
      } else {
        setScreen("forgot-sent");
      }
    } finally {
      setResetSubmitting(false);
    }
  }

  if (screen === "forgot-sent") {
    return (
      <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
        <div
          className="auth-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Check Your Email"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <h2 className="auth-card__subtitle">Check Your Email</h2>
          <p className="auth-success">
            If an account exists for <strong>{resetEmail}</strong>, a password reset link is on its
            way. It may take a minute — check your spam folder.
          </p>
          <button
            type="button"
            className="auth-submit"
            onClick={() => {
              setScreen("credentials");
              setResetError(null);
            }}
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  if (screen === "forgot-email") {
    return (
      <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
        <div
          className="auth-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Reset Password"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>

          <h2 className="auth-card__subtitle">Reset Password</h2>
          <p className="auth-success">
            Enter your account email and we&apos;ll send you a link to reset your password.
          </p>

          <form className="auth-form" onSubmit={handleSendReset}>
            <label className="auth-field">
              <span className="auth-field__label">Email</span>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {resetError && <p className="auth-error">{resetError}</p>}

            <button type="submit" className="auth-submit" disabled={resetSubmitting}>
              {resetSubmitting ? "Please wait…" : "Send Reset Link"}
            </button>
          </form>

          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setScreen("credentials");
              setResetError(null);
            }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // BL-118 / ADR-0016 §1: shown once a Google sign-in is recognized as an
  // auto-link onto an existing password account -- see handleGoogleSignIn's
  // docstring for how "linked" is detected. Checked ahead of
  // verificationSentTo below since the two are mutually exclusive (Google
  // sign-in never goes through the email/password signup path).
  if (googleLinkedNotice) {
    return (
      <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
        <div
          className="auth-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Signed In"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <h2 className="auth-card__subtitle">Signed In</h2>
          <p className="auth-success">
            Your Google account is linked to your existing HyperspaceVault account — you&apos;re
            signed in with the same email as before.
          </p>
          <button type="button" className="auth-submit" onClick={onClose}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (verificationSentTo) {
    return (
      <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
        <div
          className="auth-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Verify Your Email"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <h2 className="auth-card__subtitle">Check Your Email</h2>
          <p className="auth-success">
            We sent a verification link to <strong>{verificationSentTo}</strong>. You&apos;re signed
            in and can start browsing now -- verify your email when you get the chance to manage
            your inventory. It may take a minute — check your spam folder.
          </p>
          <button type="button" className="auth-submit" onClick={onClose}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    // BL-153 stragglers (owner dev review 2026-07-26): this primary-form
    // render (and ChangePasswordModal's) missed the shared class when the
    // per-modal overlay rules were consolidated -- without it the overlay
    // has no styling at all and the card sits bottom-left in page flow.
    <div className="auth-modal-overlay modal-overlay" onClick={onClose}>
      <div
        className="auth-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "Log In" : "Sign Up"}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <h1 className="auth-card__title">HyperspaceVault</h1>
        <h2 className="auth-card__subtitle">{mode === "login" ? "Log In" : "Sign Up"}</h2>

        <GoogleAuthButton
          label={mode === "login" ? "Sign in with Google" : "Sign up with Google"}
          onClick={handleGoogleSignIn}
          disabled={googleSubmitting || submitting}
        />

        <div className="auth-divider">
          <span>or</span>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span className="auth-field__label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-field__label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </label>

          {/* BL-116: login-only -- signup has no account yet to reset. */}
          {mode === "login" && (
            <button
              type="button"
              className="auth-forgot-link"
              onClick={() => {
                setResetEmail(email);
                setResetError(null);
                setScreen("forgot-email");
              }}
            >
              Forgot password?
            </button>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? "Please wait…" : mode === "login" ? "Log In" : "Sign Up"}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </div>
    </div>
  );
}
