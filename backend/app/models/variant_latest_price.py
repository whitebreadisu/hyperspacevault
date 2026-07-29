from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VariantLatestPrice(Base):
    """BL-146: one row per PRICED variant (~9k rows forever), maintained by
    the writers (app.jobs.price_sync / app.jobs.price_backfill, via
    app.repositories.pricing.upsert_latest_price) and read by every latest-
    price lookup (app.repositories.pricing.get_latest_prices).

    Exists because the naive read path -- `SELECT DISTINCT ON (variant_id)
    ... FROM variant_prices ORDER BY variant_id, as_of DESC` -- scans the
    ENTIRE price-history table on every call. At ~80k rows (87 days) that
    measured 15-19ms; at 2,827,106 rows (dev, 2026-07-21) it took minutes,
    requests stacked (16 concurrent copies observed), and every API
    endpoint 503'd. This table makes the latest-price read O(priced
    variants), never O(history depth) -- see issue #368 / BL-146.

    Global catalog data like variant_prices/tcgplayer_products -- no
    tenant_id, no RLS, same posture as migration 0028's pricing tables
    (prices are the same for every tenant). No explicit GRANT needed either,
    for the same reason 0028 needed none: migration 0019's `ALTER DEFAULT
    PRIVILEGES FOR ROLE swu_user ... GRANT SELECT ON TABLES TO swu_app`
    already covers every table swu_user creates from here on.

    The price-HISTORY endpoint (GET .../price-history) is deliberately NOT
    rewired to this table -- it's already variant_id-scoped and uses the
    (variant_id, as_of DESC) index from 0028, so its cost never depended on
    total history depth in the first place."""

    __tablename__ = "variant_latest_prices"

    variant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("card_variants.id"), primary_key=True
    )
    market: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    low: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
