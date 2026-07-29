from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TenantSettings(Base):
    """BL-35: one row per tenant for tenant-wide (non-limits) settings --
    currently just cap_mode, the hard/soft keep-limit enforcement toggle.
    "hard" (default) blocks an increment at/over a variant's effective
    keep-limit (app/services/inventory.py's pre-BL-35 behavior, unchanged);
    "soft" commits the increment and flags the response over_limit=True
    instead. Rows are created LAZILY -- there is no provisioning step
    alongside tenant creation; absence of a row means "hard" (see
    app/services/limits.py's effective_cap_mode / repositories/
    tenant_settings.py's get_cap_mode). Distinct from tenant_card_limits
    (BL-24, one row per (tenant, category, bucket) override cell) -- this
    table is one row per tenant, full stop.
    """

    __tablename__ = "tenant_settings"
    __table_args__ = (
        CheckConstraint(
            "cap_mode IN ('hard', 'soft')", name="ck_tenant_settings_cap_mode"
        ),
    )

    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), primary_key=True
    )
    cap_mode: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default="hard"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
