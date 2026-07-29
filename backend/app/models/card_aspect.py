from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class CardAspect(Base):
    __tablename__ = "card_aspects"

    base_card_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("base_cards.id"), primary_key=True
    )
    # Valid values: Heroism, Villainy, Cunning, Aggression, Command, Vigilance
    aspect: Mapped[str] = mapped_column(String(20), primary_key=True)

    base_card: Mapped["BaseCard"] = relationship("BaseCard", back_populates="aspects")
