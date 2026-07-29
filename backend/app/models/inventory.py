from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "variant_id", name="uq_inventory_tenant_id_variant_id"
        ),
        CheckConstraint("quantity >= 0", name="ck_inventory_quantity_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False, server_default="1"
    )
    variant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("card_variants.id"), nullable=False, index=True
    )
    quantity: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    variant: Mapped["CardVariant"] = relationship(
        "CardVariant", back_populates="inventory"
    )
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="inventory")
