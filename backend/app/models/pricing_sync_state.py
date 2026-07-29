from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PricingSyncState(Base):
    """BL-136: tiny watermark table shared by the P2 daily-sync job
    (key='daily_sync', value=tcgcsv's last-updated.txt timestamp, so a
    same-day re-run/redeploy skips re-fetching once the day's prices are
    already in) and the P3 backfill job (key='backfill', value=the last
    successfully-inserted archive date, so a restarted backfill resumes
    instead of re-downloading everything). One row per key -- upserted via
    ON CONFLICT, never grows."""

    __tablename__ = "pricing_sync_state"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
