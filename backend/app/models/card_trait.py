from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class CardTrait(Base):
    __tablename__ = "card_traits"

    base_card_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("base_cards.id"), primary_key=True
    )
    trait: Mapped[str] = mapped_column(String(50), primary_key=True)

    base_card: Mapped["BaseCard"] = relationship("BaseCard", back_populates="traits")
