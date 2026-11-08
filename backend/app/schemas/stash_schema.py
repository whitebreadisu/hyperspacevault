"""stashes: request/response shapes for /api/stashes."""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

NAME_MAX = 40
DESCRIPTION_MAX = 280


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be empty")
    if len(value) > NAME_MAX:
        raise ValueError(f"name must be at most {NAME_MAX} characters")
    return value


def _clean_description(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) > DESCRIPTION_MAX:
        raise ValueError(f"description must be at most {DESCRIPTION_MAX} characters")
    return value or None


class StashCreateRequest(BaseModel):
    name: str
    description: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("description")
    @classmethod
    def _description(cls, value: str | None) -> str | None:
        return _clean_description(value)


class StashPatchRequest(BaseModel):
    """Only the fields present in the body change; an explicit
    `description: null` (or empty) clears it. `name` cannot be null."""

    name: str | None = None
    description: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("name must not be null")
        return _clean_name(value)

    @field_validator("description")
    @classmethod
    def _description(cls, value: str | None) -> str | None:
        return _clean_description(value)


class StashResponse(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime
    copies: int


class StashItemResponse(BaseModel):
    stash_id: int
    variant_id: int
    quantity: int
    # When copies of this printing last went into this stash (R1-16 sort).
    stashed_at: datetime


class AllocationRequest(BaseModel):
    stash_id: int
    quantity: int = Field(ge=0, le=999)


class SplitRequest(BaseModel):
    allocations: list[AllocationRequest]
    # Optimistic concurrency (optional): the split the client last saw. When
    # it differs from the stored split the PUT writes nothing and answers 409
    # `split_changed` with the stored split. Absent = replace unconditionally.
    expected: list[AllocationRequest] | None = None

    @field_validator("allocations", "expected")
    @classmethod
    def _unique_stashes(cls, value: list[AllocationRequest] | None):
        if value is None:
            return value
        ids = [a.stash_id for a in value]
        if len(ids) != len(set(ids)):
            raise ValueError("a stash may appear only once in allocations")
        return value


class AllocationResponse(BaseModel):
    stash_id: int
    quantity: int


class SplitResponse(BaseModel):
    variant_id: int
    owned: int
    allocations: list[AllocationResponse]


class SplitConflictResponse(BaseModel):
    """409 `split_changed`: the stored split (and owned) the PUT found."""

    detail: str
    variant_id: int
    owned: int
    allocations: list[AllocationResponse]


class MoveItem(BaseModel):
    variant_id: int
    quantity: int = Field(ge=1, le=999)


class MoveRequest(BaseModel):
    """Body of a stash return / restore: one entry per printing."""

    items: list[MoveItem] = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def _unique_variants(cls, value: list[MoveItem]):
        ids = [i.variant_id for i in value]
        if len(ids) != len(set(ids)):
            raise ValueError("a printing may appear only once in items")
        return value


class RemainingItem(BaseModel):
    variant_id: int
    quantity: int


class MoveResponse(BaseModel):
    stash_id: int
    copies: int
    items: list[RemainingItem]
