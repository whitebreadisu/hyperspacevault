import { useEffect, useRef, useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { useAuth } from "../context/AuthContext";
import "./VerifyEmailBanner.css";

const RESEND_COOLDOWN_MS = 30_000;

type ResendState = "idle" | "sending" | "sent";

/** BL-16: persistent, dismiss-proof banner shown site-wide whenever a
 * signed-in user's email is unverified -- no close button, since the point
 * is to keep nudging until the user actually verifies (browsing itself
 * stays unblocked; only inventory mutations are gated, see api/inventory.ts's
 * EmailNotVerifiedError). Renders under the header (see App.tsx). */
export function VerifyEmailBanner() {
  const { user, emailVerified, refreshEmailVerified } = useAuth();
  const [resendState, setResendState] = useState<ResendState>("idle");
  // A boolean flipped by a scheduled setTimeout, not a `Date.now() <
  // deadline` comparison read during render -- the latter is an impure
  // render-time call (react-hooks/purity: the same render could observe a
  // different value depending on *when* it happens to run, independent of
  // any state/props change) and eslint's React Compiler rule rejects it.
  const [onCooldown, setOnCooldown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(cooldownTimeoutRef.current);
  }, []);

  if (!user || emailVerified) return null;

  async function handleResend() {
    if (!user || onCooldown || resendState === "sending") return;
    setError(null);
    setResendState("sending");
    try {
      // BL-95: same actionCodeSettings as AuthModal's signup send -- see
      // that call site's comment for why the continue URL carries the
      // `emailVerified=1` marker.
      await sendEmailVerification(user, {
        url: `${window.location.origin}/?emailVerified=1`,
      });
      setResendState("sent");
      setOnCooldown(true);
      cooldownTimeoutRef.current = setTimeout(() => setOnCooldown(false), RESEND_COOLDOWN_MS);
    } catch {
      setError("Couldn't resend the email. Please try again shortly.");
      setResendState("idle");
    }
  }

  // The "trap" (AuthContext.refreshEmailVerified's docstring): after the
  // user clicks the link in the email, both the client User object and the
  // cached ID token still say unverified until reload() + a forced token
  // refresh. This is that recheck path.
  async function handleCheckVerified() {
    setChecking(true);
    setError(null);
    try {
      await refreshEmailVerified();
    } catch {
      setError("Couldn't check verification status. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="verify-email-banner" role="status">
      <span className="verify-email-banner__text">Verify your email to manage inventory</span>
      <span className="verify-email-banner__actions">
        <button
          type="button"
          className="verify-email-banner__button"
          onClick={handleResend}
          disabled={onCooldown || resendState === "sending"}
        >
          {resendState === "sent"
            ? "Email sent"
            : resendState === "sending"
              ? "Sending…"
              : "Resend email"}
        </button>
        <button
          type="button"
          className="verify-email-banner__button verify-email-banner__button--primary"
          onClick={handleCheckVerified}
          disabled={checking}
        >
          {checking ? "Checking…" : "I've verified"}
        </button>
      </span>
      {/* BL-94 layer 2: inline hint on the "sent" confirmation -- most
          verification-email deliverability complaints turn out to be spam
          folder, not a broken send. */}
      {resendState === "sent" && (
        <span className="verify-email-banner__hint">
          It may take a minute — check your spam folder.
        </span>
      )}
      {error && <span className="verify-email-banner__error">{error}</span>}
    </div>
  );
}
