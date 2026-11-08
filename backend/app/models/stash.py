from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Stash(Base):
    """A named place for owned copies. The per-tenant unique name is
    case-insensitive via the lower(name) index (mirrors migration 0032, so
    `alembic check` is clean). Deleting a stash cascades its items, which
    returns the copies to the Vault -- owned never changes."""

    __tablename__ = "stashes"
    __table_args__ = (
        UniqueConstraint("id", "tenant_id", name="uq_stashes_id_tenant_id"),
        CheckConstraint(
            "char_length(name) BETWEEN 1 AND 40", name="ck_stashes_name_length"
        ),
        Index(
            "uq_stashes_tenant_lower_name",
            "tenant_id",
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str | None] = mapped_column(String(280), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class StashItem(Base):
    """The stashed part of one printing's owned copies, one row per
    (stash, variant). A quantity of 0 is stored as no row. The invariant
    SUM(quantity) <= inventory.quantity per (tenant, variant) is enforced by
    the deferred constraint triggers in migration 0032."""

    __tablename__ = "stash_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["stash_id", "tenant_id"],
            ["stashes.id", "stashes.tenant_id"],
            name="fk_stash_items_stash_id_tenant_id",
            ondelete="CASCADE",
        ),
        CheckConstraint("quantity > 0", name="ck_stash_items_quantity_positive"),
        Index("ix_stash_items_tenant_variant", "tenant_id", "variant_id"),
    )

    stash_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False
    )
    variant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("card_variants.id"), primary_key=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    # When copies last went in (row created or quantity raised; migration 0033).
    stashed_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
