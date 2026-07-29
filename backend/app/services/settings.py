"""BL-24: GET/PUT /api/settings/limits -- the effective per-tenant
inventory-limit matrix (code defaults merged with the tenant's override
rows). See app/services/limits.py for the shared category/bucket
vocabulary and defaults that app/services/inventory.py's enforcement also
draws from, keeping the two from drifting apart.

BL-35 extends the same GET/PUT round-trip with cap_mode (hard/soft keep-
limit enforcement) rather than adding separate endpoints -- one settings
round-trip for the whole tenant-configuration surface.
"""

from sqlalchemy.orm import Session

from app.ingestion.swuapi_classify import ALL_LIMIT_BUCKETS
from app.repositories import tenant_card_limits as tenant_card_limits_repo
from app.schemas.settings_schema import (
    LimitCell,
    LimitsResponse,
    LimitsUpdateRequest,
)
from app.services.limits import (
    ALL_TYPE_CATEGORIES,
    DEFAULT_LIMITS,
    effective_cap_mode,
    set_cap_mode,
)


def get_effective_limits(db: Session) -> LimitsResponse:
    """Every (type_category x canonical bucket) cell, merging the tenant's
    override rows onto the code defaults, plus the tenant's current
    cap_mode. Sorted buckets within each category for a deterministic
    response shape."""
    overrides = tenant_card_limits_repo.get_overrides(db)
    cells = []
    for category in ALL_TYPE_CATEGORIES:
        for bucket in sorted(ALL_LIMIT_BUCKETS):
            key = (category, bucket)
            has_override = key in overrides
            max_quantity = overrides[key] if has_override else DEFAULT_LIMITS[category]
            cells.append(
                LimitCell(
                    type_category=category,
                    limit_bucket=bucket,
                    max_quantity=max_quantity,
                    is_default=not has_override,
                )
            )
    return LimitsResponse(limits=cells, cap_mode=effective_cap_mode(db))


def replace_limits(db: Session, payload: LimitsUpdateRequest) -> LimitsResponse:
    """Full replacement of this tenant's override set (LimitsUpdateRequest's
    own field_validators already reject unknown categories/buckets,
    out-of-range max_quantity, and duplicate cells with 422 before this
    ever runs), plus an optional cap_mode change -- absent (None) leaves
    the tenant's current cap_mode untouched. Returns the new effective
    matrix, same shape as GET."""
    overrides = [
        (row.type_category, row.limit_bucket, row.max_quantity)
        for row in payload.limits
    ]
    tenant_card_limits_repo.replace_overrides(db, overrides)
    if payload.cap_mode is not None:
        set_cap_mode(db, payload.cap_mode)
    return get_effective_limits(db)
