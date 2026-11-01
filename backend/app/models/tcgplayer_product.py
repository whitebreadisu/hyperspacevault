from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TcgplayerProduct(Base):
    """The mapping layer between one card_variant and tcgcsv's
    (productId, subTypeName) price key (App Spec §16.1). Built by
    app.ingestion.run_tcgplayer_mapping (era-aware name+tier join, see
    app/ingestion/tcgplayer_mapping.py); consumed read-only by the
    daily sync (app.jobs.price_sync) and backfill (app.jobs.price_backfill)
    jobs, which never re-run the join -- they look up tcg_product_id/
    sub_type per variant_id here and fetch fresh prices for that key.

    Unmapped variants (tokens, always; ~0.5-5% of "real" cards) have no row
    here by design -- they are listed in the exceptions report that
    run_tcgplayer_mapping regenerates on every run (App Spec §16.3b)."""

    __tablename__ = "tcgplayer_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    variant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("card_variants.id"), nullable=False, unique=True
    )
    tcg_product_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    tcg_group_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # "Normal" | "Foil" -- the tcgcsv subTypeName the matched price row
    # carries. SOR/SHD-era sets share one productId across Normal/Foil for
    # a given tier (Standard, Hyperspace); JTL+-era sets use a separate
    # productId per tier+finish, disambiguated by a name suffix instead
    # -- either way, sub_type is the raw subTypeName off
    # whichever price row this mapping resolved to.
    sub_type: Mapped[str] = mapped_column(String(10), nullable=False)
    # "name_tier_exact" | "base_prefix" -- the era-aware join method the mapping builder
    # used (app/ingestion/tcgplayer_mapping.py); audit trail for the exceptions report
    # and for investigating a below-floor match rate.
    match_method: Mapped[str] = mapped_column(String(20), nullable=False)
    # The tcgcsv product name that matched, verbatim -- audit field so a
    # human can sanity-check a mapping without re-fetching tcgcsv.
    matched_name: Mapped[str] = mapped_column(String(300), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
