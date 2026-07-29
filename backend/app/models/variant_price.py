from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VariantPrice(Base):
    """BL-136: one row per variant per day (Definition_Pricing_2026-07-16.md
    §2). Composite PK (variant_id, as_of) is the natural idempotency key for
    both the daily sync job (ON CONFLICT DO UPDATE -- a same-day re-run is a
    no-op past the first write) and the backfill job (ON CONFLICT DO NOTHING
    -- a historical day, once inserted, never changes). The current price
    for a variant is simply the row with the max as_of; the same table
    serves the price-history endpoint's whole series.

    Global catalog data like tcgplayer_products -- no tenant_id, no RLS.
    market/low/mid/high are all nullable because tcgcsv price rows
    occasionally omit a tier (e.g. no listings in that band that day); the
    decided policy is "the price still ships with its as_of, never blanks"
    at the API layer, which is a null-per-field concern, not a
    null-the-whole-row concern."""

    __tablename__ = "variant_prices"

    variant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("card_variants.id"), primary_key=True
    )
    as_of: Mapped[date] = mapped_column(Date, primary_key=True)
    market: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    low: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    mid: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    high: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default="USD"
    )
