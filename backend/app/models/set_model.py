from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class CardSet(Base):
    """All swuapi sets — base (SOR, SHD, ...) and long-tail container sets
    (Weekly Play, Judge Program, Promo, Convention Exclusive, ...) alike.
    is_base_set is curated, not derived, because the derived rule ("contains
    >=1 root") misfires on C26 (mostly a container, but holds the lone Zam
    Wesell orphan root). See SWU_Catalog_Redesign_Spec.md §4.1."""

    __tablename__ = "sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(4), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_base_set: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    total_cards: Mapped[int | None] = mapped_column(nullable=True)
    swuapi_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    base_cards: Mapped[list["BaseCard"]] = relationship(
        "BaseCard", back_populates="set", foreign_keys="BaseCard.set_id"
    )
