from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import Row, select, text
from sqlalchemy.orm import Session

from app.models.card_variant import CardVariant
from app.models.variant_latest_price import VariantLatestPrice
from app.models.variant_price import VariantPrice

# GET .../price-history?range= values -> lookback window. "all" needs no
# WHERE clause at all (handled separately by the caller).
RANGE_LOOKBACK_DAYS = {"30d": 30, "90d": 90, "1y": 365}


def get_latest_prices(
    db: Session, variant_ids: list[int] | None = None
) -> dict[int, Row]:
    """variant_id -> its latest (market, low, as_of) row, read from the
    BL-146 `variant_latest_prices` snapshot table -- one row per priced
    variant (~9k rows forever), maintained by upsert_latest_price below.
    variant_ids=None fetches every priced variant (the list endpoint's
    case); a detail/deck-check caller passes the specific ids it needs.

    BL-146: this used to be `SELECT DISTINCT ON (variant_id) ... FROM
    variant_prices ORDER BY variant_id, as_of DESC`, which scans the
    ENTIRE price-history table on every call -- fine at ~26k rows, but at
    2.8M rows (issue #368) it took minutes and 503'd every API endpoint
    that embeds a price. Reading the snapshot table instead makes this
    query's cost O(priced variants), independent of history depth."""
    vlp = VariantLatestPrice.__table__.c
    query = select(vlp.variant_id, vlp.market, vlp.low, vlp.as_of)
    if variant_ids is not None:
        query = query.where(vlp.variant_id.in_(variant_ids))
    return {row.variant_id: row for row in db.execute(query).all()}


def upsert_latest_price(
    db: Session,
    variant_id: int,
    market: Decimal | float | None,
    low: Decimal | float | None,
    as_of: date,
) -> None:
    """BL-146: upserts one variant's variant_latest_prices row -- called by
    both writers (app.jobs.price_sync.upsert_prices, shared by the daily
    sync job and the history backfill job) in the same transaction as
    their variant_prices write.

    Guarded by `WHERE EXCLUDED.as_of >= variant_latest_prices.as_of` so an
    OLDER as_of never regresses the snapshot: the daily sync job always
    writes "today" (>= trivially satisfied), but the backfill job walks
    historical days -- possibly out of order, possibly re-running an
    already-covered range -- and a historical day must never overwrite a
    more-current snapshot row that a later sync/backfill run already
    established. No existing row simply inserts (first price ever seen for
    this variant)."""
    db.execute(
        text(
            "INSERT INTO variant_latest_prices (variant_id, market, low, as_of) "
            "VALUES (:variant_id, :market, :low, :as_of) "
            "ON CONFLICT (variant_id) DO UPDATE SET "
            "market = EXCLUDED.market, low = EXCLUDED.low, as_of = EXCLUDED.as_of "
            "WHERE EXCLUDED.as_of >= variant_latest_prices.as_of"
        ),
        {"variant_id": variant_id, "market": market, "low": low, "as_of": as_of},
    )


def variant_belongs_to_base_card(
    db: Session, variant_id: int, base_card_id: int
) -> bool:
    """Guards GET .../price-history?variant_id=... against a variant_id
    that exists but belongs to a different base card -- a 404 for that
    combination, not a silently-wrong series."""
    cv = CardVariant.__table__.c
    return (
        db.execute(
            select(cv.id).where(cv.id == variant_id, cv.base_card_id == base_card_id)
        ).first()
        is not None
    )


def get_price_history(db: Session, variant_id: int, range_: str) -> list[Row]:
    """Ascending (as_of, market) series for one variant. range_="all" (or
    any value outside RANGE_LOOKBACK_DAYS) returns the full history --
    router-level validation is what actually constrains range_ to the
    documented enum; this function degrades safely regardless."""
    vp = VariantPrice.__table__.c
    query = select(vp.as_of, vp.market).where(vp.variant_id == variant_id)
    lookback = RANGE_LOOKBACK_DAYS.get(range_)
    if lookback is not None:
        cutoff = date.today() - timedelta(days=lookback)
        query = query.where(vp.as_of >= cutoff)
    query = query.order_by(vp.as_of)
    return db.execute(query).all()
