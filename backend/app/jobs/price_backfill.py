"""BL-136 P3: one-time (restartable) history backfill job
(Definition_Pricing_2026-07-16.md §3).

Downloads tcgcsv's daily archive (`prices-YYYY-MM-DD.ppmd.7z`,
spike_TCGCSV_Pricing_2026-07-16.md §3 -- 7z/PPMd-compressed, one archive
per calendar day covering EVERY TCGplayer category), extracts only the
`{date}/79/{groupId}/prices` entries for the 10 root sets P1 maps
(app.ingestion.tcgcsv_client.ROOT_SET_GROUP_IDS), and inserts a
variant_prices row per resolved (variant_id, date) -- ON CONFLICT DO
NOTHING, since a historical day, once inserted, never changes (unlike the
daily sync job's DO UPDATE for a still-moving "today").

Restartable: `pricing_sync_state` (key='backfill') tracks the last fully-
completed date. Re-running with no --start resumes the day after the
watermark; an explicit --start always starts there regardless of the
watermark (useful for a targeted re-run), but never rewinds the watermark
itself if the new run's end date is earlier.

The brief explicitly says NOT to run the full ~860-day backfill from this
build session -- this job is verified against a small (2-3 day) sample
only; the full run is a deliberately separate, one-time operation for the
orchestrator to schedule (see PR follow-ups).

Usage:
    python -m app.jobs.price_backfill --start 2024-03-08 --end 2024-03-10
    python -m app.jobs.price_backfill --end 2024-04-01   # resumes from watermark+1
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import tempfile
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import httpx
import py7zr
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.ingestion.tcgcsv_client import ROOT_SET_GROUP_IDS, USER_AGENT
from app.jobs.price_sync import load_product_index, upsert_prices

logger = logging.getLogger(__name__)

ARCHIVE_URL_TEMPLATE = "https://tcgcsv.com/archive/tcgplayer/prices-{date}.ppmd.7z"
MIN_ARCHIVE_INTERVAL_SECONDS = 1.0  # ">=1s between archive downloads" per the brief
WATERMARK_KEY = "backfill"
DOWNLOAD_TIMEOUT_SECONDS = 60.0


def get_backfill_watermark(db: Session) -> date | None:
    value = db.execute(
        text("SELECT value FROM pricing_sync_state WHERE key = :key"),
        {"key": WATERMARK_KEY},
    ).scalar()
    return date.fromisoformat(value) if value else None


def set_backfill_watermark(db: Session, value: date) -> None:
    db.execute(
        text(
            "INSERT INTO pricing_sync_state (key, value, updated_at) "
            "VALUES (:key, :value, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
            "updated_at = NOW()"
        ),
        {"key": WATERMARK_KEY, "value": value.isoformat()},
    )


def download_archive(client: httpx.Client, target_date: date) -> bytes | None:
    """Returns the raw 7z bytes, or None if tcgcsv has no archive for this
    date (404 -- happens for dates the maintainer's pipeline skipped;
    not expected for dates in SWU's release window, but handled instead
    of crashing a multi-day backfill run over one gap)."""
    url = ARCHIVE_URL_TEMPLATE.format(date=target_date.isoformat())
    response = client.get(url)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.content


def extract_day_prices(
    archive_bytes: bytes, target_date: date, group_ids: dict[str, int]
) -> dict[str, list[dict]]:
    """Extracts the {date}/79/{groupId}/prices entry for each root set out
    of one day's archive. Returns {set_code: price_rows}; a set with no
    entry in this day's archive (e.g. a set that didn't exist yet) is
    simply absent from the returned dict, not an error."""
    date_str = target_date.isoformat()
    targets = {
        f"{date_str}/79/{group_id}/prices": set_code
        for set_code, group_id in group_ids.items()
    }

    results: dict[str, list[dict]] = {}
    with py7zr.SevenZipFile(io.BytesIO(archive_bytes), mode="r") as archive:
        present = [name for name in archive.getnames() if name in targets]
        if not present:
            return results
        with tempfile.TemporaryDirectory() as tmpdir:
            archive.extract(path=tmpdir, targets=present)
            for entry_name in present:
                set_code = targets[entry_name]
                file_path = Path(tmpdir) / entry_name
                if not file_path.exists():
                    continue
                payload = json.loads(file_path.read_text(encoding="utf-8"))
                results[set_code] = payload.get("results", [])
    return results


@dataclass
class BackfillReport:
    dates_processed: list[date] = field(default_factory=list)
    dates_skipped_no_archive: list[date] = field(default_factory=list)
    rows_inserted: int = 0
    unmapped_price_rows: int = 0


def run_backfill(
    db: Session,
    start: date,
    end: date,
    group_ids: dict[str, int] | None = None,
    http_client: httpx.Client | None = None,
    sleep_seconds: float = MIN_ARCHIVE_INTERVAL_SECONDS,
) -> BackfillReport:
    """Processes [start, end] inclusive, ascending, one archive download
    per day with sleep_seconds between them. Commits (and advances the
    watermark) after each day -- a crash mid-run loses at most the day in
    progress, not the whole range."""
    groups = group_ids or ROOT_SET_GROUP_IDS
    owns_client = http_client is None
    client = http_client or httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=DOWNLOAD_TIMEOUT_SECONDS
    )
    report = BackfillReport()

    try:
        product_index = load_product_index(db)
        current = start
        first = True
        while current <= end:
            if not first:
                time.sleep(sleep_seconds)
            first = False

            archive_bytes = download_archive(client, current)
            if archive_bytes is None:
                logger.warning("no tcgcsv archive for %s, skipping", current)
                report.dates_skipped_no_archive.append(current)
                set_backfill_watermark(db, current)
                db.commit()
                current += timedelta(days=1)
                continue

            day_prices = extract_day_prices(archive_bytes, current, groups)
            day_inserted = 0
            day_unmapped = 0
            for set_code, prices in day_prices.items():
                inserted, unmapped = upsert_prices(db, prices, product_index, current)
                day_inserted += inserted
                day_unmapped += unmapped

            set_backfill_watermark(db, current)
            db.commit()

            report.dates_processed.append(current)
            report.rows_inserted += day_inserted
            report.unmapped_price_rows += day_unmapped
            logger.info(
                "backfill %s: %d rows inserted across %d sets, %d unmapped",
                current,
                day_inserted,
                len(day_prices),
                day_unmapped,
            )
            current += timedelta(days=1)
    finally:
        if owns_client:
            client.close()

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="BL-136 P3 price history backfill")
    parser.add_argument("--start", type=date.fromisoformat, default=None)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    parser.add_argument(
        "--sleep",
        type=float,
        default=MIN_ARCHIVE_INTERVAL_SECONDS,
        help="seconds between archive downloads (default 1.0, the tcgcsv minimum)",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        start = args.start
        if start is None:
            watermark = get_backfill_watermark(db)
            start = (watermark + timedelta(days=1)) if watermark else args.end
        if start > args.end:
            print(f"Nothing to do: start {start} is after end {args.end}")
            return

        report = run_backfill(db, start, args.end, sleep_seconds=args.sleep)
    finally:
        db.close()

    print(
        f"Backfilled {len(report.dates_processed)} days "
        f"({report.rows_inserted} rows inserted, "
        f"{len(report.dates_skipped_no_archive)} days skipped -- no archive, "
        f"{report.unmapped_price_rows} unmapped price rows)"
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    main()
