from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ShareNameRequest(BaseModel):
    """Owner-side rename payload (vault shares only). `name` is the viewer's
    header label (App Spec §19.1): plain text, 1-30 chars after trimming.
    Control characters are rejected rather than stripped -- a name that
    needs sanitizing is a name we don't want."""

    name: str = Field(min_length=1, max_length=30)

    @field_validator("name")
    @classmethod
    def _trim_and_reject_control(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        if any(ord(c) < 32 or ord(c) == 127 for c in v):
            raise ValueError("name must not contain control characters")
        return v


class ShareCreateRequest(ShareNameRequest):
    """Owner-side create payload. Without `stash_id` it creates the vault
    share; with it, that stash's share (its name is fixed from then on)."""

    stash_id: int | None = Field(default=None, ge=1)


class ShareResponse(BaseModel):
    """Owner-side view of a share -- includes the token (the owner made
    it; they need it to build the link). Never returned on any
    viewer-facing route."""

    id: int
    name: str
    scope: str
    token: str
    created_at: datetime
    revoked: bool
    # Stash shares only (NULL on the vault share): the stash id and its
    # current name, for the owner's "Your links" list and the rail marks.
    target_id: int | None = None
    stash_name: str | None = None

    model_config = {"from_attributes": False}


class SharedResolveResponse(BaseModel):
    """Viewer-side resolve: everything an anonymous holder of a valid
    token learns about the share -- the header label and what kind of
    thing it is. Deliberately no tenant id, no owner identity, no dates."""

    name: str
    scope: str


class SharedStashInfo(BaseModel):
    name: str
    description: str | None


class SharedStashRow(BaseModel):
    """One printing in a shared stash: the owner's stash-item row minus the
    stash id, plus the unit prices the stash value uses (the printing's own
    Market / Low, else its card's Standard printing's, else null)."""

    variant_id: int
    quantity: int
    stashed_at: datetime
    market: float | None
    low: float | None


class SharedStashTotals(BaseModel):
    printings: int
    copies: int
    value_market: float
    value_low: float


class SharedStashResponse(BaseModel):
    """Viewer-side read of a stash share: the stash and nothing else -- no
    owner id, no stash id, no other stash, no vault data."""

    share_name: str
    stash: SharedStashInfo
    rows: list[SharedStashRow]
    totals: SharedStashTotals
