"""BL-126: POST /api/feedback business logic. See app/routers/feedback.py
for the HTTP adapter and migration 0027 for the RLS shape the insert path
relies on.
"""

import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.repositories import feedback as feedback_repo
from app.schemas.feedback_schema import FeedbackSubmitRequest, FeedbackSubmitResponse
from app.services import github_notify


def submit_feedback(
    db: Session,
    payload: FeedbackSubmitRequest,
    tenant_id: int | None,
) -> FeedbackSubmitResponse:
    """tenant_id is whatever app/database.py's get_optional_db already
    resolved for this request (request.state.tenant_id) -- None for an
    anonymous/tenant-less session, the caller's real tenant id when
    authenticated. This function never re-derives it.

    Honeypot (decision #5): a non-empty `website` field marks this as a bot
    submission. The response is identical to a real success (never tips a
    bot off that it was caught), but nothing is stored and no notification
    fires -- returning here, before the DB write, is what "store nothing"
    means in practice.
    """
    if payload.website:
        return FeedbackSubmitResponse()

    # Consent semantics (owner decision #3): contact_ok=false means
    # genuinely anonymous, even for a signed-in caller -- tenant_id/email
    # are only ever attached to the row when contact_ok is true. An
    # anonymous caller's tenant_id is already None, so this is a no-op for
    # them either way.
    stored_tenant_id = tenant_id if payload.contact_ok else None
    stored_email = payload.contact_email if payload.contact_ok else None

    # Server-side metadata only (decision #4): commit_sha comes from the
    # backend's own environment, never the client. No such env var existed
    # in this codebase before BL-126 -- terraform/modules/app/cloud_run.tf
    # now wires COMMIT_SHA to var.backend_image_tag (already the deploying
    # commit's github.sha); locally/in CI this is simply unset, so
    # commit_sha is None there.
    commit_sha = os.environ.get("COMMIT_SHA")

    feedback_repo.insert_feedback(
        db,
        message=payload.message,
        contact_ok=payload.contact_ok,
        contact_email=stored_email,
        tenant_id=stored_tenant_id,
        commit_sha=commit_sha,
    )

    # Decision #1: notification is best-effort AFTER the DB write commits
    # above -- github_notify.notify never raises, so a notification
    # failure can never turn a persisted submission into an error
    # response. The timestamp here is this process's own clock, not a
    # read-back of the row's server-assigned created_at -- insert_feedback
    # deliberately never reads the row back (see its docstring); the two
    # values are for-humans-adjacent anyway (an issue body's "Submitted:"
    # line), not something anything reconciles against the DB row.
    submitted_at = datetime.now(timezone.utc).isoformat()
    github_notify.notify(
        message=payload.message,
        commit_sha=commit_sha,
        created_at=submitted_at,
        contact_email=stored_email,
    )

    return FeedbackSubmitResponse()
