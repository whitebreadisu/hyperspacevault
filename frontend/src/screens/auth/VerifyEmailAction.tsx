import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../context/AuthContext";
import { createAuthChannel, TAB_ID, type AuthChannelMessage } from "../../utils/authChannel";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import "./AuthModal.css";

type LandingStatus =
  | "checking"
  | "success-signed-in"
  | "success-signed-in-synced"
  | "success-signed-out"
  | "failure"
  | "unsupported"
  // BL-116 password reset states, independent of the verify-email states
  // above -- reset never touches auth.currentUser or the cross-tab
  // broadcast, so none of the sync machinery above applies to it.
  | "reset-checking"
  | "reset-form"
  | "reset-success"
  | "reset-invalid";

const PONG_TIMEOUT_MS = 400;

/** BL-95 cross-tab sync: pings the shared BroadcastChannel and resolves
 * `true` if any *other* SWU tab answers with a pong within
 * PONG_TIMEOUT_MS -- see utils/authChannel.ts for why TAB_ID is required to
 * ignore this tab's own ping/pong pair. Resolves `false` on timeout (no
 * other tab open, or none answered in time). */
function waitForOtherTab(channel: BroadcastChannel): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    function finish(result: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      resolve(result);
    }

    function onMessage(event: MessageEvent<AuthChannelMessage>) {
      const msg = event.data;
      if (msg.tabId === TAB_ID) return;
      if (msg.type === "pong") finish(true);
    }

    channel.addEventListener("message", onMessage);
    const timer = setTimeout(() => finish(false), PONG_TIMEOUT_MS);
    channel.postMessage({ type: "ping", tabId: TAB_ID });
  });
}

/** BL-95: in-app landing for Firebase email-action links. BL-16's original
 * flow sent users to Firebase's hosted `__/auth/action` page -- a dead end
 * with no path back into the app. Customizing that page away (pointing the
 * action URL itself at our origin) turned out to be **blocked** on this
 * project: both the Identity Platform admin API
 * (`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`) and the Firebase Console UI reject
 * the change. So the link still lands on Google's hosted page first, which
 * applies the oobCode itself and shows its own "Continue" button that
 * navigates to `actionCodeSettings.url` -- our origin, with a marker query
 * param (`?emailVerified=1`) appended by the sendEmailVerification call
 * sites (AuthModal signup + VerifyEmailBanner Resend). This component is
 * the one place, app-wide, that reads `window.location.search` on boot for
 * either signal Firebase can hand back:
 *   - `mode=verifyEmail` + `oobCode`: a direct action link landed straight
 *     on our origin. This is the transition-safe path if the action-URL
 *     restriction is ever lifted (BL-97), and also covers any already-sent
 *     links from before this marker existed. `applyActionCode(auth,
 *     oobCode)` is called here -- the code has not been consumed yet.
 *   - `emailVerified=1` with no `oobCode`: the continue-URL marker. Google's
 *     hosted handler already applied the code before redirecting here, so
 *     `applyActionCode` must NOT be called again (there is no code to apply,
 *     and re-applying an already-consumed oobCode is impossible anyway --
 *     Google's page never leaks it back to us, on purpose).
 * Both signals converge on the same success handling -- see
 * `finishVerificationSuccess` below -- since by the time either fires,
 * verification has already happened.
 *
 * The app is deliberately router-less, so this runs once on mount as a
 * plain effect rather than as a route. It has to tolerate every possible
 * page load without crashing: no params at all (the overwhelming majority of
 * loads), a supported mode, or an unrecognized/malformed one.
 *
 * BL-116 extends the same mechanism for `mode=resetPassword`: a direct
 * `mode=resetPassword` + `oobCode` link calls `verifyPasswordResetCode`
 * (returning the account email, shown on the form) then renders a
 * new-password form backed by `confirmPasswordReset` -- mirroring
 * `applyActionCode`'s one-shot-code shape but requiring user input in
 * between verify and apply, unlike email verification's single call. A
 * `passwordReset=1` marker with no `oobCode` means Firebase's hosted
 * `__/auth/action` page collected the new password itself (that page
 * renders its own reset UI for this mode, the same way it does the
 * one-click apply for `verifyEmail`) before redirecting here -- so that
 * landing skips straight to the success screen, no form, nothing left to
 * apply.
 *
 * Params (`mode`, `oobCode`, `apiKey`, `continueUrl`, `lang`,
 * `emailVerified`, `passwordReset`) are stripped via history.replaceState
 * the instant they're read -- before the async applyActionCode call even
 * starts -- so a refresh at any point (mid-verify, on the success screen,
 * on the failure screen) never re-applies the same code or re-triggers the
 * marker path.
 *
 * applyActionCode's oobCode is self-contained -- it succeeds whether or not
 * the browser has an active Firebase session -- and the marker path is the
 * same story (Google's handler already resolved the code independent of
 * this browser's session), so both success paths handle the signed-in vs.
 * signed-out split explicitly via `auth.currentUser` (read fresh at
 * resolution time, same pattern AuthContext.refreshEmailVerified uses)
 * rather than assuming one.
 *
 * BL-95 cross-tab sync: the link opens in a *new* tab, browser security
 * rules mean this code can't focus/reload the original tab, so this
 * component bridges the gap via BroadcastChannel (see utils/authChannel.ts)
 * instead. On success it announces `{type: "email-verified"}` so the
 * original tab's AuthContext listener can refresh itself in real time. When
 * landing signed in, it also pings and waits up to PONG_TIMEOUT_MS for a
 * pong -- if another SWU tab answers, the success copy tells the user their
 * other window is already ready and offers Continue only as a secondary
 * option; no pong (or no BroadcastChannel support) falls back to the
 * original copy unchanged. The signed-out landing never pings -- if this
 * tab itself isn't signed in, there's no reliable "other tab" story to tell.
 */

/** BL-95 continue-URL marker: the shared success tail for both the oobCode
 * path and the marker path (see the component docstring above for why they
 * converge here). By the time either caller invokes this, verification has
 * already happened -- this only broadcasts, refreshes local state, and
 * settles which success copy to show. Factored out so the two landing
 * shapes can't drift out of sync with each other. */
async function finishVerificationSuccess(
  channel: BroadcastChannel | null,
  refreshEmailVerified: () => Promise<void>,
  setStatus: (status: LandingStatus) => void
): Promise<void> {
  // BL-95: announce unconditionally -- even a signed-out landing tab
  // should let a signed-in tab elsewhere know to refresh.
  channel?.postMessage({ type: "email-verified", tabId: TAB_ID });

  if (auth.currentUser) {
    await refreshEmailVerified();
    const otherTabReady = channel ? await waitForOtherTab(channel) : false;
    setStatus(otherTabReady ? "success-signed-in-synced" : "success-signed-in");
  } else {
    setStatus("success-signed-out");
  }
}

interface Props {
  /** BL-116: mirrors the CardsPage `onRequestSignIn` wiring in App.tsx --
   * called (never itself opening a modal) when the reset landing wants to
   * hand the user back to AuthModal, either after a successful password
   * change or from the expired/invalid-code screen's "request a new reset
   * email" affordance. Optional so tests that don't care about this
   * transition can omit it, same as AuthModal's onSignedUp. */
  onRequestSignIn?: () => void;
}

export function VerifyEmailAction({ onRequestSignIn }: Props = {}) {
  const { refreshEmailVerified } = useAuth();
  const [status, setStatus] = useState<LandingStatus | null>(null);

  // BL-116 password-reset form state -- populated once verifyPasswordResetCode
  // resolves (reset-form) and consumed by handleResetSubmit below. Kept
  // separate from the verify-email states above; reset never touches
  // auth.currentUser or the BroadcastChannel sync machinery.
  const [resetOobCode, setResetOobCode] = useState<string | null>(null);
  const [resetAccountEmail, setResetAccountEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetFormError, setResetFormError] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const oobCode = params.get("oobCode");
    // BL-95 continue-URL marker: appended to actionCodeSettings.url by both
    // sendEmailVerification call sites. Only meaningful when there's no
    // oobCode -- see the component docstring for why the two never really
    // compete (a direct link carries mode+oobCode; Google's hosted handler's
    // Continue button carries only this marker).
    const emailVerifiedMarker = params.get("emailVerified") === "1";
    // BL-116: same marker mechanism, reused for password reset -- see
    // AuthModal's handleSendReset. Firebase's hosted __/auth/action page
    // handles resetPassword's own new-password form when a direct oobCode
    // link isn't intercepted first, so a landing with this marker and no
    // oobCode means the hosted page already completed the reset; there's no
    // code left to apply.
    const passwordResetMarker = params.get("passwordReset") === "1";

    if (!mode && !oobCode && !emailVerifiedMarker && !passwordResetMarker) return; // normal app boot -- no action link involved

    const url = new URL(window.location.href);
    url.searchParams.delete("mode");
    url.searchParams.delete("oobCode");
    url.searchParams.delete("apiKey");
    url.searchParams.delete("continueUrl");
    url.searchParams.delete("lang");
    url.searchParams.delete("emailVerified");
    url.searchParams.delete("passwordReset");
    window.history.replaceState({}, "", url.toString());

    if (mode === "verifyEmail" && oobCode) {
      const channel = createAuthChannel();
      setStatus("checking");
      applyActionCode(auth, oobCode)
        .then(() => finishVerificationSuccess(channel, refreshEmailVerified, setStatus))
        .catch(() => setStatus("failure"))
        .finally(() => channel?.close());

      // Deliberately mount-only: this reads window.location.search exactly
      // once, at the instant the app boots with an action link in the URL.
      // The channel is closed in .finally above once the async chain
      // settles, and again here (idempotent) as a safety net for an early
      // unmount.
      return () => channel?.close();
    }

    if (!oobCode && emailVerifiedMarker) {
      // BL-95 continue-URL marker landing: Google's hosted __/auth/action
      // page already applied the code before redirecting here via
      // actionCodeSettings.url -- do NOT call applyActionCode, there is no
      // oobCode to apply and the code is already consumed.
      const channel = createAuthChannel();
      setStatus("checking");
      void finishVerificationSuccess(channel, refreshEmailVerified, setStatus).finally(() =>
        channel?.close()
      );
      return () => channel?.close();
    }

    // BL-116: a direct password-reset link (or an emulator/local-dev link,
    // or a future link once BL-97 lifts the action-URL restriction) --
    // verify the code first (also returns the account email, shown on the
    // form below) before ever collecting a new password.
    if (mode === "resetPassword" && oobCode) {
      setStatus("reset-checking");
      verifyPasswordResetCode(auth, oobCode)
        .then((accountEmail) => {
          setResetOobCode(oobCode);
          setResetAccountEmail(accountEmail);
          setStatus("reset-form");
        })
        .catch(() => setStatus("reset-invalid"));
      return;
    }

    if (!oobCode && passwordResetMarker) {
      // BL-116 continue-URL marker landing: Firebase's hosted page already
      // collected the new password and completed the reset -- nothing left
      // to do here but report success (no account email to show, and no
      // form to build: only announcing an already-finished action).
      setStatus("reset-success");
      return;
    }

    // No in-app flow for this mode, or a malformed link missing its code --
    // fail soft, don't crash.
    setStatus("unsupported");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BL-153: `enabled: status !== null` reproduces the original effect's
  // `if (status === null) return` early-out -- this component is always
  // mounted (it renders null for the ordinary no-action-link case), so the
  // listener must not attach until there's actually something to dismiss.
  const dismiss = useCallback(() => setStatus(null), []);
  useModalDismiss(dismiss, { enabled: status !== null });

  if (status === null) return null;

  /** BL-116: submit the new-password form on the reset-form screen.
   * `resetOobCode` was captured back when verifyPasswordResetCode resolved
   * (see the mount effect) -- confirmPasswordReset consumes it once, same
   * one-shot semantics as applyActionCode above. A code that expires (or
   * gets used elsewhere) in the gap between verify and submit surfaces here
   * as `auth/expired-action-code` / `auth/invalid-action-code`; that's
   * routed to the same "request a new reset email" screen as a code that
   * was already invalid at verify time, rather than left as an inline form
   * error the user can't act on. */
  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    setResetFormError(null);

    if (newPassword !== confirmPassword) {
      setResetFormError("New passwords do not match.");
      return;
    }
    if (!resetOobCode) {
      setResetFormError("Something went wrong. Please try again.");
      return;
    }

    setResetSubmitting(true);
    try {
      await confirmPasswordReset(auth, resetOobCode, newPassword);
      setStatus("reset-success");
    } catch (err) {
      const code = err instanceof Error ? (err as { code?: string }).code : undefined;
      if (code === "auth/expired-action-code" || code === "auth/invalid-action-code") {
        setStatus("reset-invalid");
      } else if (code === "auth/weak-password") {
        setResetFormError("New password is too weak — use at least 6 characters.");
      } else {
        setResetFormError("Something went wrong. Please try again.");
      }
    } finally {
      setResetSubmitting(false);
    }
  }

  return (
    <div className="auth-modal-overlay modal-overlay" onClick={dismiss}>
      <div
        className="auth-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={status.startsWith("reset") ? "Reset Password" : "Email Verification"}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="auth-modal-close" onClick={dismiss} aria-label="Close">
          ×
        </button>

        {status === "checking" && (
          <>
            <h2 className="auth-card__subtitle">Verifying Email</h2>
            <p className="auth-success">Verifying your email…</p>
          </>
        )}

        {status === "success-signed-in" && (
          <>
            <h2 className="auth-card__subtitle">Email Verified</h2>
            <p className="auth-success">Email verified — welcome!</p>
            <button type="button" className="auth-submit" onClick={dismiss}>
              Continue
            </button>
          </>
        )}

        {/* BL-95 cross-tab sync: shown only when another SWU tab answered
            our ping -- see waitForOtherTab above. Continue is demoted to
            the secondary (.auth-cancel) style since the user may still
            prefer to keep working in this tab. */}
        {status === "success-signed-in-synced" && (
          <>
            <h2 className="auth-card__subtitle">Email Verified</h2>
            <p className="auth-success">
              Email verified — welcome! Your other SWU window is ready — you can close this tab.
            </p>
            <button type="button" className="auth-cancel" onClick={dismiss}>
              Continue
            </button>
          </>
        )}

        {status === "success-signed-out" && (
          <>
            <h2 className="auth-card__subtitle">Email Verified</h2>
            <p className="auth-success">Verified — sign in to continue.</p>
            <button type="button" className="auth-submit" onClick={dismiss}>
              Continue
            </button>
          </>
        )}

        {status === "failure" && (
          <>
            <h2 className="auth-card__subtitle">Verification Link Issue</h2>
            <p className="auth-error">This verification link has expired or was already used.</p>
            <p className="auth-success">
              Signed in? Use Resend in the verification banner to get a new link.
            </p>
            <button type="button" className="auth-submit" onClick={dismiss}>
              Continue
            </button>
          </>
        )}

        {status === "unsupported" && (
          <>
            <h2 className="auth-card__subtitle">Link Not Supported</h2>
            <p className="auth-success">
              This link isn&apos;t handled in-app yet. Please check your email for further
              instructions.
            </p>
            <button type="button" className="auth-submit" onClick={dismiss}>
              Continue
            </button>
          </>
        )}

        {/* BL-116 password reset states below -- see the mount effect's
            resetPassword/passwordReset-marker branches above. */}
        {status === "reset-checking" && (
          <>
            <h2 className="auth-card__subtitle">Verifying Reset Link</h2>
            <p className="auth-success">Verifying your reset link…</p>
          </>
        )}

        {status === "reset-form" && (
          <>
            <h2 className="auth-card__subtitle">Choose a New Password</h2>
            <p className="auth-success">
              Resetting password for <strong>{resetAccountEmail}</strong>.
            </p>
            <form className="auth-form" onSubmit={handleResetSubmit}>
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

              {resetFormError && <p className="auth-error">{resetFormError}</p>}

              <button type="submit" className="auth-submit" disabled={resetSubmitting}>
                {resetSubmitting ? "Please wait…" : "Reset Password"}
              </button>
            </form>
          </>
        )}

        {/* BL-116: reached either from the direct oobCode form above or the
            passwordReset continue-URL marker landing (no form -- Firebase's
            hosted page already collected the new password itself), so
            resetAccountEmail may be null here; the copy doesn't depend on
            it. onRequestSignIn mirrors App's onRequestSignIn wiring for
            CardsPage -- see this component's Props docstring. */}
        {status === "reset-success" && (
          <>
            <h2 className="auth-card__subtitle">Password Changed</h2>
            <p className="auth-success">
              Your password has been changed. Sign in with your new password.
            </p>
            <button
              type="button"
              className="auth-submit"
              onClick={() => {
                dismiss();
                onRequestSignIn?.();
              }}
            >
              Continue to Sign In
            </button>
          </>
        )}

        {status === "reset-invalid" && (
          <>
            <h2 className="auth-card__subtitle">Reset Link Issue</h2>
            <p className="auth-error">This password reset link has expired or was already used.</p>
            <button
              type="button"
              className="auth-submit"
              onClick={() => {
                dismiss();
                onRequestSignIn?.();
              }}
            >
              Request a New Reset Email
            </button>
          </>
        )}
      </div>
    </div>
  );
}
