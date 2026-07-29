"""BL-136 P2: daily price sync job (Definition_Pricing_2026-07-16.md §3).

1. GET tcgcsv.com/last-updated.txt; skip the run entirely if it matches the
   value already recorded from the last successful sync (idempotent --
   re-running the same day, or a redeploy that re-triggers the scheduler,
   is a no-op past this check; self-correcting if tcgcsv's own daily build
   is running late, since the watermark just won't have moved yet).
2. Fetch prices for every priced set's tcgcsv group (the sets P1's mapping
   builder has coverage for -- app.ingestion.tcgcsv_client.ALL_PRICED_GROUP_IDS,
   the 10 root sets plus, since BL-174, the 8 Weekly Play container-set
   groups -- the SAME map the mapping builder defaults to, so this job's
   fetch scope can never silently drift from what's actually mapped),
   sequential + throttled + UA-identified via TcgcsvClient (same compliance
   posture as the mapping builder).
3. Look each (productId, subTypeName) price row up in `tcgplayer_products`
   (P1's mapping, read-only here -- this job never re-runs the join) and
   upsert today's `variant_prices` row for the matched variant_id.
4. Record the new last-updated watermark in `pricing_sync_state` only after
   every group's prices are upserted -- a mid-run failure leaves the old
   watermark in place, so a retry re-does the whole day's sync rather than
   silently treating a partial run as complete.

Usage:
    python -m app.jobs.price_sync
    python -m app.jobs.price_sync --force   # ignore the watermark, sync anyway
"""

from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.ingestion.tcgcsv_client import ALL_PRICED_GROUP_IDS, TcgcsvClient, throttle
from app.repositories.pricing import upsert_latest_price

logger = logging.getLogger(__name__)

WATERMARK_KEY = "daily_sync"


@dataclass
class SyncReport:
    ran: bool
    skipped_reason: str | None = None
    as_of: date | None = None
    tcgcsv_last_updated: str | None = None
    groups_synced: int = 0
    rows_upserted: int = 0
    unmapped_price_rows: int = 0  # price rows with no tcgplayer_products match


def get_watermark(db: Session) -> str | None:
    return db.execute(
        text("SELECT value FROM pricing_sync_state WHERE key = :key"),
        {"key": WATERMARK_KEY},
    ).scalar()


def set_watermark(db: Session, value: str) -> None:
    db.execute(
        text(
            "INSERT INTO pricing_sync_state (key, value, updated_at) "
            "VALUES (:key, :value, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
            "updated_at = NOW()"
        ),
        {"key": WATERMARK_KEY, "value": value},
    )


def load_product_index(db: Session) -> dict[tuple[int, str], list[int]]:
    """(tcg_product_id, sub_type) -> [variant_ids], for every P1-mapped
    variant. Loaded once per run -- ~9k rows is trivial to hold in memory
    and avoids a per-price-row query.

    One-to-MANY (BL-159): several variants can legitimately share one
    tcgplayer product+subType (38 known shared-key groups, e.g. the IBH
    3-variant products), so each price row must fan out to every mapped
    variant. A plain one-to-one dict here silently kept only the last
    writer, leaving the other variants of each group with no price row
    at all."""
    rows = db.execute(
        text("SELECT tcg_product_id, sub_type, variant_id FROM tcgplayer_products")
    ).all()
    index: dict[tuple[int, str], list[int]] = {}
    for r in rows:
        index.setdefault((r.tcg_product_id, r.sub_type), []).append(r.variant_id)
    return index


def upsert_prices(
    db: Session,
    prices: list[dict],
    product_index: dict[tuple[int, str], list[int]],
    as_of: date,
) -> tuple[int, int]:
    """Upserts one variant_prices row per price row that resolves through
    product_index, and -- BL-146 -- maintains that variant's
    variant_latest_prices snapshot row in the SAME transaction (guarded by
    upsert_latest_price so an out-of-order/historical `as_of` never
    regresses the snapshot; see app.repositories.pricing.upsert_latest_price
    for the guard). Shared by both writers: the daily sync job calls this
    directly, and app.jobs.price_backfill imports this same function, so
    the backfill's historical writes go through the identical guarded
    upsert -- no separate snapshot-maintenance code path to keep in sync.
    A shared-key price row (BL-159) fans out to one variant_prices row per
    mapped variant, and rows_upserted counts variant rows written, not
    source price rows resolved.
    Returns (rows_upserted, unmapped_count)."""
    upserted = 0
    unmapped = 0
    for row in prices:
        key = (row["productId"], row.get("subTypeName", "Normal"))
        variant_ids = product_index.get(key)
        if not variant_ids:
            unmapped += 1
            continue
        market = row.get("marketPrice")
        low = row.get("lowPrice")
        for variant_id in variant_ids:
            db.execute(
                text(
                    "INSERT INTO variant_prices "
                    "(variant_id, as_of, market, low, mid, high, currency) "
                    "VALUES (:variant_id, :as_of, :market, :low, :mid, :high, 'USD') "
                    "ON CONFLICT (variant_id, as_of) DO UPDATE SET "
                    "market = EXCLUDED.market, low = EXCLUDED.low, "
                    "mid = EXCLUDED.mid, high = EXCLUDED.high"
                ),
                {
                    "variant_id": variant_id,
                    "as_of": as_of,
                    "market": market,
                    "low": low,
                    "mid": row.get("midPrice"),
                    "high": row.get("highPrice"),
                },
            )
            upsert_latest_price(db, variant_id, market, low, as_of)
            upserted += 1
    return upserted, unmapped


def run_sync(
    db: Session,
    client: TcgcsvClient,
    force: bool = False,
    as_of: date | None = None,
    group_ids: dict[str, int] | None = None,
) -> SyncReport:
    groups = group_ids or ALL_PRICED_GROUP_IDS
    last_updated = client.last_updated()
    watermark = get_watermark(db)

    if not force and watermark == last_updated:
        return SyncReport(
            ran=False,
            skipped_reason=f"already synced tcgcsv build {last_updated}",
            tcgcsv_last_updated=last_updated,
        )

    sync_date = as_of or datetime.now(timezone.utc).date()
    product_index = load_product_index(db)

    total_upserted = 0
    total_unmapped = 0
    for i, (set_code, group_id) in enumerate(groups.items()):
        if i > 0:
            throttle()
        prices = client.prices(group_id)
        upserted, unmapped = upsert_prices(db, prices, product_index, sync_date)
        total_upserted += upserted
        total_unmapped += unmapped
        logger.info(
            "price_sync %s: %d rows upserted, %d unmapped (no tcgplayer_products match)",
            set_code,
            upserted,
            unmapped,
        )

    set_watermark(db, last_updated)

    return SyncReport(
        ran=True,
        as_of=sync_date,
        tcgcsv_last_updated=last_updated,
        groups_synced=len(groups),
        rows_upserted=total_upserted,
        unmapped_price_rows=total_unmapped,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="BL-136 P2 daily price sync")
    parser.add_argument(
        "--force",
        action="store_true",
        help="sync even if the watermark shows today's build already ran",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        with TcgcsvClient() as client:
            report = run_sync(db, client, force=args.force)
        if report.ran:
            db.commit()
        else:
            db.rollback()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    if not report.ran:
        logger.info("price_sync skipped: %s", report.skipped_reason)
        print(f"Skipped: {report.skipped_reason}")
        return

    logger.info(
        "price_sync complete: as_of=%s tcgcsv_build=%s groups=%d rows_upserted=%d "
        "unmapped=%d",
        report.as_of,
        report.tcgcsv_last_updated,
        report.groups_synced,
        report.rows_upserted,
        report.unmapped_price_rows,
    )
    print(
        f"Synced {report.rows_upserted} rows across {report.groups_synced} groups "
        f"(as_of {report.as_of}, tcgcsv build {report.tcgcsv_last_updated}, "
        f"{report.unmapped_price_rows} unmapped price rows)"
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    main()
