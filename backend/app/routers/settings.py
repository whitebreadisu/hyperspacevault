from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.http_cache import tenant_no_store
from app.schemas.settings_schema import LimitsResponse, LimitsUpdateRequest
from app.services import settings as settings_service

# BL-24: tenant_no_store router-wide, matching inventory.py -- every
# response here (the effective limits matrix) is per-tenant.
router = APIRouter(
    prefix="/api/settings",
    tags=["settings"],
    dependencies=[Depends(tenant_no_store)],
)


@router.get("/limits", response_model=LimitsResponse)
def get_limits(db: Session = Depends(get_db)):
    return settings_service.get_effective_limits(db)


# Not gated by require_verified_email (unlike POST /api/inventory/{id}/
# {increment,decrement} and the BL-54 import/export surface): OWNER-DECIDED
# 2026-07-23 (Jeremy), deliberate and settled -- the gate protects
# inventory data writes; account-scoped configuration sits outside it.
# Rationale: this route is RLS-isolated to the caller's own tenant, its
# payload is validated and bounded, and everything limits config
# *influences* is already verified-gated, so an unverified account's
# settings are inert. Do not re-flag; revisit only if this route ever
# affects anything beyond the caller's own tenant configuration.
@router.put("/limits", response_model=LimitsResponse)
def put_limits(payload: LimitsUpdateRequest, db: Session = Depends(get_db)):
    return settings_service.replace_limits(db, payload)
