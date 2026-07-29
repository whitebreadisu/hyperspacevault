"""BL-126: request/response shapes for POST /api/feedback.

No response_model beyond FeedbackSubmitResponse is needed -- there's no
GET counterpart (RLS denies SELECT to swu_app outright, see migration
0027's docstring), so this module only ever carries the submit shape.
"""

import re

from pydantic import BaseModel, Field, field_validator, model_validator

# Deliberately simple (not the pydantic `EmailStr` type, which pulls in the
# email-validator package -- not a runtime dependency of this backend
# today, see requirements.txt) -- "looks like an email" is all client-side
# validation ever promised (owner spec: "email field... passes client-side
# format validation"), so the server-side check mirrors that bar rather
# than pulling in RFC-5322-grade validation for a field that's never used
# to actually send mail from this service (GitHub-issue notification only,
# decision #2).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MESSAGE_MAX_LENGTH = 5000
EMAIL_MAX_LENGTH = 254


class FeedbackSubmitRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)
    contact_ok: bool = False
    contact_email: str | None = Field(default=None, max_length=EMAIL_MAX_LENGTH)
    # Honeypot (decision #5): a real browser never fills this -- it's
    # visually hidden + aria-hidden + tabIndex -1 on the frontend. A
    # non-empty value marks the submission as a bot; the router still
    # returns the normal success response (never tips off a bot that it
    # was caught) but the service stores nothing and sends no
    # notification. See app/services/feedback.py's submit_feedback.
    website: str = ""

    @field_validator("message")
    @classmethod
    def _message_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value

    @field_validator("contact_email")
    @classmethod
    def _email_format(cls, value: str | None) -> str | None:
        if value is not None and not _EMAIL_RE.match(value):
            raise ValueError("contact_email is not a valid email address")
        return value

    @model_validator(mode="after")
    def _email_required_when_contact_ok(self) -> "FeedbackSubmitRequest":
        if self.contact_ok and not self.contact_email:
            raise ValueError("contact_email is required when contact_ok is true")
        return self


class FeedbackSubmitResponse(BaseModel):
    """Minimal by design (owner spec) -- no submission id is returned, so
    there's nothing here for a caller to enumerate."""

    status: str = "ok"
