from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TenantCardLimit(Base):
    """BL-24: a tenant's OVERRIDE of the code-default per-variant keep-limit
    for one (type_category, limit_bucket) cell.

    type_category is "singleton" (Leader/Base) or "standard" (everything
    else); limit_bucket is a variant's `finish` if it has one, else its
    `channel` (app/ingestion/swuapi_classify.py's limit_bucket()). Rows are
    OVERRIDES ONLY -- absence of a row means the code default
    (app/services/limits.py's DEFAULT_LIMITS) applies. A row with
    max_quantity NULL means the tenant has explicitly configured "no limit"
    for that cell -- distinct from "no row at all", which falls back to the
    numeric default instead.
    """

    __tablename__ = "tenant_card_limits"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "type_category", "limit_bucket"),
        CheckConstraint(
            "max_quantity IS NULL OR (max_quantity >= 0 AND max_quantity <= 999)",
            name="ck_tenant_card_limits_max_quantity_range",
        ),
    )

    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False
    )
    type_category: Mapped[str] = mapped_column(String(20), nullable=False)
    limit_bucket: Mapped[str] = mapped_column(String(50), nullable=False)
    max_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
