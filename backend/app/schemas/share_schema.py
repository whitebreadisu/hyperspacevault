from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ShareCreateRequest(BaseModel):
    """Owner-side create/rename payload. `name` is the viewer's header
    label (App Spec §19.1): plain text, 1-30 chars after trimming. Control
    characters are rejected rather than stripped -- a name that needs
    sanitizing is a name we don't want."""

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

    model_config = {"from_attributes": False}


class SharedResolveResponse(BaseModel):
    """Viewer-side resolve: everything an anonymous holder of a valid
    token learns about the share -- the header label and what kind of
    thing it is. Deliberately no tenant id, no owner identity, no dates."""

    name: str
    scope: str
