from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class CardVariant(Base):
    """One row per printing (every variant_of_uuid value, root and non-root
    alike). Finish (variant_type) and provenance (source_set_code) are
    independent axes — see SWU_Catalog_Redesign_Spec.md §3.2/§4.3. The
    variant_type vocabulary is intentionally open (no enum/check constraint)
    pending BL-27's census."""

    __tablename__ = "card_variants"

    id: Mapped[int] = mapped_column(primary_key=True)
    base_card_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("base_cards.id"), nullable=False, index=True
    )
    variant_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_set_code: Mapped[str] = mapped_column(
        String(4), ForeignKey("sets.code"), nullable=False, index=True
    )
    card_number: Mapped[str] = mapped_column(String(10), nullable=False)
    front_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    back_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    swuapi_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    # Consolidation key for stamp-only tournament-tier variants (BL-31/32).
    stamp_group: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    base_card: Mapped["BaseCard"] = relationship(
        "BaseCard", back_populates="variants", foreign_keys=[base_card_id]
    )
    source_set: Mapped["CardSet"] = relationship(
        "CardSet", foreign_keys=[source_set_code]
    )
    inventory: Mapped["Inventory"] = relationship(
        "Inventory", back_populates="variant", uselist=False
    )
