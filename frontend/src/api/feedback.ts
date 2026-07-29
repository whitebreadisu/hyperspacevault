import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

/** BL-126: POST /api/feedback request body. Mirrors
 * app/schemas/feedback_schema.py's FeedbackSubmitRequest field-for-field --
 * `website` is the hidden honeypot input (FeedbackModal renders it visually
 * hidden + aria-hidden + tabIndex -1; a real submitter never fills it). */
export interface FeedbackSubmission {
  message: string;
  contact_ok: boolean;
  contact_email?: string;
  website?: string;
}

/** authedFetch (not plain fetch) -- the endpoint is optional-auth
 * (get_optional_db, BL-56/ADR-0008 idiom): attaching the current user's ID
 * token when signed in is what lets the backend attach tenant_id when
 * contact_ok is true, while an anonymous caller sends no token at all and
 * the backend treats the submission as tenant-less. Throws on a non-2xx
 * response so FeedbackModal's submit handler can show its inline error
 * state and preserve the form, matching api/account.ts's deleteAccount
 * idiom. */
export async function submitFeedback(payload: FeedbackSubmission): Promise<void> {
  const res = await authedFetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // BL-154: migrated from a bare `throw new Error`.
  if (!res.ok) throw new ApiError(`Feedback submission failed: ${res.status}`, res.status);
}
