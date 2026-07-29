from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_optional_db
from app.rate_limit import is_rate_limited
from app.schemas.feedback_schema import FeedbackSubmitRequest, FeedbackSubmitResponse
from app.services import feedback as feedback_service

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


# BL-126: optional-auth like GET /api/base-cards/{id} (get_optional_db,
# BL-56 / ADR-0008) -- anonymous submissions are a first-class case (owner
# decision #1: the feedback table is tenant-optional), not an error.
# get_optional_db stamps request.state.tenant_id (None for anonymous, the
# real tenant id for a signed-in caller) exactly like every other
# optional-auth route; that's the only piece of identity this route needs
# -- app/services/feedback.py applies the consent semantics from there.
@router.post("", response_model=FeedbackSubmitResponse, status_code=201)
def submit_feedback(
    payload: FeedbackSubmitRequest,
    request: Request,
    db: Session = Depends(get_optional_db),
):
    """Rate limiting (decision #5, cheap tier -- app/rate_limit.py) runs
    before the DB write so a limited caller never consumes a round trip.
    It deliberately does not special-case the honeypot path -- a bot
    retrying past the honeypot is exactly the traffic this limiter exists
    to blunt too.
    """
    client_key = request.client.host if request.client else "unknown"
    if is_rate_limited(client_key):
        raise HTTPException(
            status_code=429, detail="Too many submissions -- please try again later"
        )

    tenant_id = request.state.tenant_id
    return feedback_service.submit_feedback(db, payload, tenant_id)
