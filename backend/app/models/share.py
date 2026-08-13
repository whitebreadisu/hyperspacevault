from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Share(Base):
    """BL-205 (App Spec §19.1): a secret-link share of tenant data. `token`
    is the viewer's sole credential; `name` (owner-chosen, <=30 chars) is
    the viewer's header label and the only owner identity ever exposed.
    `scope` carries the full enum from day one; only 'inventory' is
    implemented in BL-205. `target_id` is the future list-scope binder
    reference (NULL for inventory/wanted). Revocation is soft (revoked_at)
    so a once-issued token can never be silently re-activated; the
    one-active-share-per-target cardinality lives in the migration's
    partial unique index, not here."""

    __tablename__ = "shares"
    __table_args__ = (CheckConstraint("scope IN ('inventory', 'wanted', 'list')"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="inventory")
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
