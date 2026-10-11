import { useCallback, useEffect, useRef, useState } from "react";
import { submitFeedback } from "../api/feedback";
import { useAuth } from "../context/AuthContext";
import { MIcon } from "./icons";
import { SWUButton } from "../components/SWUButton";
import { capturePhone } from "./phoneAnalytics";
import { backOr } from "./router";
import "./feedback.css";

// BL-247 S1-25: Leave Feedback at #/more/feedback (rev4 MMore.jsx:73-136;
// CSS m-rev2.css:113-158, m-rev3.css:226-235). Steel-ring console shell at
// full-shell scale (18 / 17 px cuts), X top-right. Behaviour and copy are
// desktop FeedbackModal.tsx's, verbatim: free-form message; the contact
// checkbox reveals "Your Email" (prefilled from the account, editable);
// Submit only with a message and, when contact is ticked, a plausible email
// (the backend's own regex); the hidden honeypot; inline error; in-place
// success, then auto-close after 1.5 s. Close = back (the screen's caller).

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUCCESS_AUTO_CLOSE_MS = 1500;

export function FeedbackScreen({
  onClose,
  fromMore = false,
}: {
  onClose: () => void;
  /** S4 F3: reached from More -> a left back chevron to #/more (like every
   * More sub-page); reached from the Vault header -> the X top-right. */
  fromMore?: boolean;
}) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [email, setEmail] = useState(user?.email ?? "");
  const [website, setWebsite] = useState(""); // honeypot -- see api/feedback.ts
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  // Desktop useModalDismiss: Escape closes, except mid-submit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss]);

  useEffect(() => {
    if (!succeeded) return undefined;
    closeTimer.current = setTimeout(onClose, SUCCESS_AUTO_CLOSE_MS);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [succeeded, onClose]);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = message.trim().length > 0 && (!contactOk || emailValid) && !submitting;

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
      capturePhone("feedback_submitted"); // BL-235 / S1-27
    } catch {
      setError("Something went wrong sending your feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="m-screen m-fb" role="dialog" aria-labelledby="fb-title">
      <div className="m-fb__shell">
        <div className="m-fb__panel">
          <header className="m-fb__head">
            {fromMore && !submitting ? (
              <button
                type="button"
                className="m-iconbtn m-fb__back"
                onClick={() => backOr("#/more")}
                aria-label="Back"
              >
                <MIcon name="back" />
              </button>
            ) : (
              <span className="m-fb__bal" aria-hidden="true" />
            )}
            <h1 className="m-fb__title" id="fb-title">
              Leave Feedback
            </h1>
            {fromMore || submitting ? (
              <span className="m-fb__bal" aria-hidden="true" />
            ) : (
              <button
                type="button"
                className="m-iconbtn m-fb__close"
                onClick={onClose}
                aria-label="Close"
              >
                <MIcon name="close" />
              </button>
            )}
          </header>
          {succeeded ? (
            <div className="m-fb__body">
              <p className="m-fb__success">Thanks for the feedback!</p>
            </div>
          ) : (
            <div className="m-fb__body">
              <label className="m-fb__field">
                <span className="m-fb__label">Your Feedback</span>
                <textarea
                  className="m-fb__textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  disabled={submitting}
                  placeholder="Bug reports, ideas, anything on your mind..."
                />
              </label>

              {/* Honeypot (desktop): hidden, aria-hidden, out of tab order. */}
              <div className="m-fb__honeypot" aria-hidden="true">
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

              <button
                type="button"
                className={"m-check m-fb__check" + (contactOk ? " m-check--on" : "")}
                role="checkbox"
                aria-checked={contactOk}
                disabled={submitting}
                onClick={() => setContactOk(!contactOk)}
              >
                <span className="m-check__box">
                  {contactOk ? <MIcon name="check" size={16} /> : null}
                </span>
                <span className="m-check__text">Is it OK if we contact you to learn more?</span>
              </button>

              {contactOk ? (
                <label className="m-fb__field">
                  <span className="m-fb__label">Your Email</span>
                  <input
                    type="email"
                    className="m-fb__input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </label>
              ) : null}

              {error ? <p className="m-fb__error">{error}</p> : null}

              <p className="m-fb__fine">
                When you submit, we record your message along with the app version (commit) and time
                of submission. Your email is only stored if you opt in above.
              </p>

              <div className="m-fb__actions">
                <button
                  type="button"
                  className="m-fb__cancel"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <SWUButton
                  size="md"
                  active={canSubmit}
                  ariaDisabled={!canSubmit}
                  onClick={() => void handleSubmit()}
                  className="m-fb__submit"
                >
                  {submitting ? "Sending…" : "Submit Feedback"}
                </SWUButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
