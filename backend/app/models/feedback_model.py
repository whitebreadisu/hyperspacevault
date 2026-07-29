from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Feedback(Base):
    """BL-126: one row per feedback submission. Tenant-OPTIONAL by design
    (issue #289) -- tenant_id is populated only when contact_ok is true AND
    the submitter was authenticated; a signed-in submitter who declines
    contact stores no uid/tenant/email at all, matching the "genuinely
    anonymous" consent semantics. See migration 0027 for the RLS policies
    that enforce the insert/purge shape of that rule at the database
    layer."""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    contact_ok: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    contact_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    tenant_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=True
    )
    commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Registered here for the same reason every other table in this
    # codebase has a model (app/models/__init__.py), even though the write
    # path (app/repositories/feedback.py's insert_feedback) deliberately
    # uses a plain text() INSERT with no RETURNING instead of this class --
    # an ORM insert always appends RETURNING, and migration 0027's
    # feedback_select_own_tenant SELECT policy never covers an anonymous
    # row (tenant_id NULL), so RETURNING would fail for exactly the
    # submissions this table exists to accept anonymously. See that
    # repository function's docstring.
