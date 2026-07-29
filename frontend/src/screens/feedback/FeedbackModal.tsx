import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { submitFeedback } from "../../api/feedback";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import "./FeedbackModal.css";

interface Props {
  onClose: () => void;
}

// Deliberately the same "looks like an email" bar the backend applies
// (backend/app/schemas/feedback_schema.py's _EMAIL_RE) -- client-side
// validation only ever promised to gate the Submit button, not to be
// authoritative; the server re-validates independently.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const SUCCESS_AUTO_CLOSE_MS = 1500;

/** BL-126: "Leave Feedback" console modal -- App owns the open/close state
 * (feedbackModalOpen in App.tsx), same pattern as AuthModal/AboutModal.
 * Visually follows AboutModal's compact ~520px steel-ring shell (see that
 * component's docstring for the clip-path technique) rather than
 * AuthModal's plain rounded card, since this is chrome reachable from the
 * header for both anonymous and signed-in visitors, like About & Legal.
 *
 * Owner spec (issue #289), verbatim behavior: free-form message; a
 * contact-consent checkbox; an email field that only appears once checked
 * (prefilled from the Firebase user's email when signed in, empty when
 * anonymous, always editable either way); Submit enabled only when the
 * message is non-empty AND (consent is unchecked OR (consent is checked
 * AND the email passes format validation)); in-modal success state, then
 * auto-close; no client-side submission limit. A hidden honeypot input
 * (decision #5) is submitted alongside every request -- a real visitor
 * never sees or fills it.
 */
export function FeedbackModal({ onClose }: Props) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [email, setEmail] = useState(user?.email ?? "");
  const [website, setWebsite] = useState(""); // honeypot -- see api/feedback.ts
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // BL-153: submitting-guard lives inside the callback (not `enabled`) --
  // see DeleteAccountModal.tsx's identical comment for why.
  const dismissUnlessSubmitting = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);
  useModalDismiss(dismissUnlessSubmitting);

  // Auto-close after a successful submit -- cleared on unmount so a modal
  // closed some other way (e.g. a fast re-navigation) never fires onClose
  // a second time against an already-unmounted component.
  useEffect(() => {
    if (!succeeded) return;
    closeTimerRef.current = setTimeout(onClose, SUCCESS_AUTO_CLOSE_MS);
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [succeeded, onClose]);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit =
    message.trim().length > 0 && (!contactOk || (contactOk && emailValid)) && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await submitFeedback({
        message,
        contact_ok: contactOk,
        contact_email: contactOk ? email.trim() : undefined,
        website,
      });
      setSucceeded(true);
    } catch {
      setError("Something went wrong sending your feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="feedback-overlay modal-overlay" onClick={submitting ? undefined : onClose}>
      <div
        className="feedback-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Leave Feedback"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feedback-modal">
          {!submitting && (
            <button type="button" className="feedback-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}

          <h2 className="feedback-title">Leave Feedback</h2>

          {succeeded ? (
            <div className="feedback-body">
              <p className="feedback-success">Thanks for the feedback!</p>
            </div>
          ) : (
            <div className="feedback-body">
              <label className="feedback-field">
                <span className="feedback-field__label">Your Feedback</span>
                <textarea
                  className="feedback-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={5000}
                  disabled={submitting}
                  placeholder="Bug reports, ideas, anything on your mind..."
                />
              </label>

              {/* Honeypot -- visually hidden, aria-hidden, and out of tab
                  order, so a human visitor never notices or fills it; a bot
                  filling every field on the page fills this one too. */}
              <div className="feedback-honeypot" aria-hidden="true">
                <label>
                  Website
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </div>

              <label className="feedback-checkbox-row">
                <input
                  type="checkbox"
                  checked={contactOk}
                  onChange={(e) => setContactOk(e.target.checked)}
                  disabled={submitting}
                />
                <span>Is it OK if we contact you to learn more?</span>
              </label>

              {contactOk && (
                <label className="feedback-field">
                  <span className="feedback-field__label">Your Email</span>
                  <input
                    type="email"
                    className="feedback-email-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    placeholder="you@example.com"
                  />
                </label>
              )}

              {error && <p className="feedback-error">{error}</p>}

              <p className="feedback-fine-print">
                When you submit, we record your message along with the app version (commit) and time
                of submission. Your email is only stored if you opt in above.
              </p>

              <div className="feedback-actions">
                <button
                  type="button"
                  className="feedback-cancel"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="feedback-submit"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                >
                  {submitting ? "Sending…" : "Submit Feedback"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
