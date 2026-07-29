from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_recent_auth
from app.database import get_db
from app.services import account as account_service

router = APIRouter(prefix="/api/account", tags=["account"])


# BL-87: authenticated (Depends(get_db) transitively requires a verified
# token -- 401 on missing/invalid, matching every other authenticated
# route). No request body, no query params, no path params -- the tenant
# purged is always the caller's own, derived from the verified token via
# get_db's app.current_tenant_id, never from anything client-supplied.
# Idempotent, so success is always 204 regardless of whether there was
# anything left to delete -- FastAPI omits the body automatically for a
# 204 response.
#
# BL-88: also gated on require_recent_auth -- a valid-but-stale ID token
# (auth_time older than the 5-minute sensitive-op window) is rejected
# before the purge runs, closing the gap where a stolen token could hit
# this endpoint directly and skip DeleteAccountModal's client-side
# password/Google reauth. Deliberately NOT also gated on
# require_verified_email (BL-16's audit note): recency and email
# verification are separate concerns, and an unverified user must still be
# able to delete their own account.
@router.delete("", status_code=204)
def delete_account(
    db: Session = Depends(get_db),
    _: None = Depends(require_recent_auth),
) -> None:
    account_service.delete_account(db)
