"""BL-24: request/response shapes for GET/PUT /api/settings/limits.

TypeCategory's two values must match app/services/limits.py's
TYPE_CATEGORY_SINGLETON/TYPE_CATEGORY_STANDARD -- duplicated here as a
Literal (rather than importing the service module) so schemas stay leaf
modules with no service-layer dependency, matching the rest of this
codebase's schemas.

BL-35 adds CapMode the same way: its two values must match
app/services/limits.py's CAP_MODE_HARD/CAP_MODE_SOFT.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.ingestion.swuapi_classify import ALL_LIMIT_BUCKETS

TypeCategory = Literal["singleton", "standard"]

# BL-35: "hard" (default) blocks an at/over-limit increment; "soft" commits
# it and flags the response over_limit=True instead. A Literal type means
# an invalid value is rejected with 422 before the service layer ever runs.
CapMode = Literal["hard", "soft"]


class LimitCell(BaseModel):
    """One (type_category, limit_bucket) cell of the effective limits
    matrix. max_quantity is None for "no limit" (either an explicit
    unlimited override or -- is_default True -- there is no numeric code
    default that means unlimited, so None+is_default only ever happens via
    an override)."""

    type_category: TypeCategory
    limit_bucket: str
    max_quantity: int | None
    is_default: bool


class LimitsResponse(BaseModel):
    limits: list[LimitCell]
    # BL-35: the tenant's current keep-limit enforcement mode.
    cap_mode: CapMode


class LimitOverrideInput(BaseModel):
    """One row of a PUT /api/settings/limits request body."""

    type_category: TypeCategory
    limit_bucket: str
    max_quantity: int | None = Field(default=None, ge=0, le=999)

    @field_validator("limit_bucket")
    @classmethod
    def _known_limit_bucket(cls, value: str) -> str:
        if value not in ALL_LIMIT_BUCKETS:
            raise ValueError(
                f"unknown limit_bucket {value!r} -- must be one of the canonical "
                "finish/channel buckets (swuapi_classify.ALL_LIMIT_BUCKETS)"
            )
        return value


class LimitsUpdateRequest(BaseModel):
    """The tenant's complete override set -- PUT semantics are full
    replacement, not a patch (see repositories/tenant_card_limits.py's
    replace_overrides).

    cap_mode is OPTIONAL and orthogonal to limits' full-replacement
    semantics: absent (or explicit null) means "leave the tenant's current
    cap_mode unchanged" -- there's no meaningful "no cap_mode" state to
    reset to, unlike limits' empty-list-resets-to-defaults. See
    services/settings.py's replace_limits.
    """

    limits: list[LimitOverrideInput]
    cap_mode: CapMode | None = None

    @field_validator("limits")
    @classmethod
    def _no_duplicate_cells(
        cls, value: list[LimitOverrideInput]
    ) -> list[LimitOverrideInput]:
        seen: set[tuple[str, str]] = set()
        for row in value:
            key = (row.type_category, row.limit_bucket)
            if key in seen:
                raise ValueError(
                    f"duplicate override for (type_category={row.type_category!r}, "
                    f"limit_bucket={row.limit_bucket!r}) -- each cell may appear at "
                    "most once"
                )
            seen.add(key)
        return value
