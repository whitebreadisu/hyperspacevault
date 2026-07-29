from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class BaseCard(Base):
    """One row per root printing (variant_of_uuid: null) per base set —
    the standard-bearing identity a card's full variant long tail anchors
    to. See SWU_Standard_Variant_Mapping_Spec.md and
    SWU_Catalog_Redesign_Spec.md §4.2."""

    __tablename__ = "base_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    set_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sets.id"), nullable=False, index=True
    )
    base_card_number: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(200), nullable=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    type2: Mapped[str | None] = mapped_column(String(20), nullable=True)
    double_sided: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    rarity: Mapped[str] = mapped_column(String(20), nullable=False)
    cost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    power: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Valid values: Ground, Space
    arena: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_unique: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    front_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    back_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    epic_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    artist: Mapped[str | None] = mapped_column(String(200), nullable=True)
    swuapi_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    # Standard-anchor exception (mapping spec §6): nullable because a root's
    # own variant_type can be non-Standard (currently 15 known cases).
    standard_variant_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("card_variants.id"), nullable=True
    )
    is_token: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    set: Mapped["CardSet"] = relationship(
        "CardSet", back_populates="base_cards", foreign_keys=[set_id]
    )
    variants: Mapped[list["CardVariant"]] = relationship(
        "CardVariant",
        back_populates="base_card",
        foreign_keys="CardVariant.base_card_id",
    )
    standard_variant: Mapped["CardVariant | None"] = relationship(
        "CardVariant", foreign_keys=[standard_variant_id], post_update=True
    )
    aspects: Mapped[list["CardAspect"]] = relationship(
        "CardAspect", back_populates="base_card"
    )
    keywords: Mapped[list["CardKeyword"]] = relationship(
        "CardKeyword", back_populates="base_card"
    )
    traits: Mapped[list["CardTrait"]] = relationship(
        "CardTrait", back_populates="base_card"
    )
