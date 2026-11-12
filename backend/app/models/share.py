from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Share(Base):
    """A secret-link share of tenant data (App Spec §19.1). `token`
    is the viewer's sole credential; `name` (owner-chosen, <=30 chars) is
    the viewer's header label and the only owner identity ever exposed.
    `scope` carries the full enum; 'inventory' (the vault link) and 'stash'
    (one stash's link, migration 0034) are implemented, 'wanted' and 'list'
    are reserved. `target_id` is the stash id for a stash share (NULL for
    inventory). Revocation is soft (revoked_at)
    so a once-issued token can never be silently re-activated; the
    one-active-share-per-target cardinality is the partial unique index
    declared below (mirrors migration 0030, so `alembic check` is clean)."""

    __tablename__ = "shares"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('inventory', 'wanted', 'list', 'stash')",
            name="ck_shares_scope",
        ),
        Index("uq_shares_token", "token", unique=True),
        Index(
            "uq_shares_one_active_per_target",
            "tenant_id",
            "scope",
            text("COALESCE(target_id, 0)"),
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="inventory")
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
