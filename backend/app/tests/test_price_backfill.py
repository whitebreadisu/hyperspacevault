"""BL-136 P3: tests for the history backfill job (app/jobs/price_backfill.py).
Synthetic 7z fixtures built in-process with py7zr's write mode (no live
tcgcsv.com archive downloads) -- isolated set/variant fixture like
test_price_sync.py's.
"""

import io
import json
import os
from datetime import date

import py7zr
import pytest
from sqlalchemy import text

from app.jobs.price_backfill import (
    WATERMARK_KEY,
    extract_day_prices,
    get_backfill_watermark,
    run_backfill,
)
from app.jobs.price_sync import load_product_index
from app.jobs.price_sync import upsert_prices as sync_upsert_prices

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "PB1"
GROUP_ID = 900003


def build_archive(day: date, group_id: int, price_rows: list[dict]) -> bytes:
    """A minimal synthetic 7z archive matching tcgcsv's real internal
    layout ({date}/{categoryId}/{groupId}/prices, live-verified against a
    real 2024-03-08 archive during this build) -- just the one entry this
    test needs, not a full multi-category day."""
    payload = json.dumps({"success": True, "errors": [], "results": price_rows}).encode(
        "utf-8"
    )
    buf = io.BytesIO()
    with py7zr.SevenZipFile(buf, "w") as archive:
        archive.writestr(payload, f"{day.isoformat()}/79/{group_id}/prices")
    return buf.getvalue()


def _price_row(product_id=77777, market=2.5, low=2.0):
    return {
        "productId": product_id,
        "subTypeName": "Normal",
        "lowPrice": low,
        "midPrice": market,
        "highPrice": market * 2,
        "marketPrice": market,
    }


def test_extract_day_prices_reads_the_right_group_entry():
    day = date(2024, 3, 8)
    archive_bytes = build_archive(day, GROUP_ID, [_price_row()])
    result = extract_day_prices(archive_bytes, day, {SET_CODE: GROUP_ID})

    assert SET_CODE in result
    assert result[SET_CODE][0]["productId"] == 77777


def test_extract_day_prices_absent_set_is_simply_missing():
    day = date(2024, 3, 8)
    archive_bytes = build_archive(day, GROUP_ID, [_price_row()])
    result = extract_day_prices(archive_bytes, day, {"OTHER": 123456})

    assert result == {}


@pytest.fixture
def backfill_variant(db):
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (:code, 'Backfill Test Set', true) "
            "ON CONFLICT (code) DO NOTHING"
        ),
        {"code": SET_CODE},
    )
    set_id = db.execute(
        text("SELECT id FROM sets WHERE code = :code"), {"code": SET_CODE}
    ).scalar()
    base_card_id = db.execute(
        text(
            "INSERT INTO base_cards "
            "(set_id, base_card_number, name, type, rarity, swuapi_id) "
            "VALUES (:set_id, '1', 'Backfill Test Card', 'Unit', 'Common', "
            "'pb-base-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": set_id},
    ).scalar()
    variant_id = db.execute(
        text(
            "INSERT INTO card_variants "
            "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
            "VALUES (:base_card_id, 'Standard', :set_code, '1', 'pb-variant-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
            "RETURNING id"
        ),
        {"base_card_id": base_card_id, "set_code": SET_CODE},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO tcgplayer_products "
            "(variant_id, tcg_product_id, tcg_group_id, sub_type, match_method, "
            "matched_name) "
            "VALUES (:variant_id, 77777, :group_id, 'Normal', 'name_tier_exact', "
            "'Backfill Test Card') "
            "ON CONFLICT (variant_id) DO UPDATE SET tcg_product_id = EXCLUDED.tcg_product_id"
        ),
        {"variant_id": variant_id, "group_id": GROUP_ID},
    )
    db.commit()

    yield variant_id

    db.execute(
        text("DELETE FROM variant_prices WHERE variant_id = :vid"), {"vid": variant_id}
    )
    db.execute(
        text("DELETE FROM variant_latest_prices WHERE variant_id = :vid"),
        {"vid": variant_id},
    )
    db.execute(
        text("DELETE FROM tcgplayer_products WHERE variant_id = :vid"),
        {"vid": variant_id},
    )
    db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": variant_id})
    db.execute(text("DELETE FROM base_cards WHERE id = :bid"), {"bid": base_card_id})
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.execute(
        text("DELETE FROM pricing_sync_state WHERE key = :key"), {"key": WATERMARK_KEY}
    )
    db.commit()


def test_run_backfill_inserts_rows_across_a_date_range(
    db, backfill_variant, monkeypatch
):
    archives = {
        date(2024, 3, 8): build_archive(
            date(2024, 3, 8), GROUP_ID, [_price_row(market=1.0)]
        ),
        date(2024, 3, 9): build_archive(
            date(2024, 3, 9), GROUP_ID, [_price_row(market=2.0)]
        ),
    }
    monkeypatch.setattr(
        "app.jobs.price_backfill.download_archive",
        lambda client, d: archives.get(d),
    )

    report = run_backfill(
        db,
        date(2024, 3, 8),
        date(2024, 3, 9),
        group_ids={SET_CODE: GROUP_ID},
        sleep_seconds=0,
    )

    assert report.rows_inserted == 2
    assert len(report.dates_processed) == 2
    rows = db.execute(
        text(
            "SELECT as_of, market FROM variant_prices WHERE variant_id = :vid "
            "ORDER BY as_of"
        ),
        {"vid": backfill_variant},
    ).all()
    assert [r.as_of for r in rows] == [date(2024, 3, 8), date(2024, 3, 9)]
    assert get_backfill_watermark(db) == date(2024, 3, 9)


def test_run_backfill_is_restartable_no_duplicate_rows(
    db, backfill_variant, monkeypatch
):
    archive = build_archive(date(2024, 3, 8), GROUP_ID, [_price_row(market=1.0)])
    monkeypatch.setattr(
        "app.jobs.price_backfill.download_archive",
        lambda client, d: archive if d == date(2024, 3, 8) else None,
    )

    run_backfill(
        db,
        date(2024, 3, 8),
        date(2024, 3, 8),
        group_ids={SET_CODE: GROUP_ID},
        sleep_seconds=0,
    )
    # "Restart" -- re-run the same day. ON CONFLICT DO NOTHING means the
    # historical row is untouched (not updated, not duplicated).
    run_backfill(
        db,
        date(2024, 3, 8),
        date(2024, 3, 8),
        group_ids={SET_CODE: GROUP_ID},
        sleep_seconds=0,
    )

    rows = db.execute(
        text("SELECT market FROM variant_prices WHERE variant_id = :vid"),
        {"vid": backfill_variant},
    ).all()
    assert len(rows) == 1
    assert float(rows[0].market) == 1.0


def test_run_backfill_populates_variant_latest_prices_snapshot(
    db, backfill_variant, monkeypatch
):
    """BL-146: run_backfill shares upsert_prices with the daily sync job, so
    a backfill of days that are all NEWER than anything in the snapshot
    must land the snapshot on the final (most recent) day's price -- the
    ordinary forward-walking case."""
    archives = {
        date(2024, 3, 8): build_archive(
            date(2024, 3, 8), GROUP_ID, [_price_row(market=1.0)]
        ),
        date(2024, 3, 9): build_archive(
            date(2024, 3, 9), GROUP_ID, [_price_row(market=2.0)]
        ),
    }
    monkeypatch.setattr(
        "app.jobs.price_backfill.download_archive",
        lambda client, d: archives.get(d),
    )

    run_backfill(
        db,
        date(2024, 3, 8),
        date(2024, 3, 9),
        group_ids={SET_CODE: GROUP_ID},
        sleep_seconds=0,
    )

    row = db.execute(
        text("SELECT market, as_of FROM variant_latest_prices WHERE variant_id = :vid"),
        {"vid": backfill_variant},
    ).first()
    assert row is not None
    assert float(row.market) == 2.0
    assert row.as_of == date(2024, 3, 9)


def test_backfill_out_of_order_historical_write_does_not_regress_snapshot(
    db, backfill_variant, monkeypatch
):
    """BL-146's core safety property: a daily-sync-shaped write establishes
    a "current" snapshot (2026-07-16), then a backfill run processes an
    OLDER historical day (2024-03-08, the brief's "backfill processes
    historical days" scenario) -- the snapshot must still show the
    2026-07-16 price/as_of afterward, never the stale historical value.
    Without upsert_latest_price's `WHERE EXCLUDED.as_of >= ...` guard, a
    plain ON CONFLICT DO UPDATE would let this historical write clobber the
    current snapshot with a year-and-a-half-old price.

    Uses price_sync.upsert_prices directly (not the full run_sync) to avoid
    entangling this test with the daily_sync watermark row that run_sync
    manages -- that watermark is shared global state across every test
    module that exercises the sync job, and this test only needs
    upsert_prices' write behavior, not the skip-if-already-synced logic."""
    product_index = load_product_index(db)
    sync_upsert_prices(db, [_price_row(market=99.99)], product_index, date(2026, 7, 16))
    db.commit()
    current_snapshot = db.execute(
        text("SELECT market, as_of FROM variant_latest_prices WHERE variant_id = :vid"),
        {"vid": backfill_variant},
    ).first()
    assert current_snapshot.as_of == date(2026, 7, 16)
    assert float(current_snapshot.market) == 99.99

    archive = build_archive(date(2024, 3, 8), GROUP_ID, [_price_row(market=1.0)])
    monkeypatch.setattr(
        "app.jobs.price_backfill.download_archive",
        lambda client, d: archive if d == date(2024, 3, 8) else None,
    )
    run_backfill(
        db,
        date(2024, 3, 8),
        date(2024, 3, 8),
        group_ids={SET_CODE: GROUP_ID},
        sleep_seconds=0,
    )

    # The historical variant_prices row DID insert (history is unaffected --
    # every day's row still lands in the history table)...
    history_row = db.execute(
        text(
            "SELECT market FROM variant_prices "
            "WHERE variant_id = :vid AND as_of = :as_of"
        ),
        {"vid": backfill_variant, "as_of": date(2024, 3, 8)},
    ).first()
    assert float(history_row.market) == 1.0

    # ...but the snapshot must still reflect the SYNC's newer 2026-07-16
    # price, untouched by the older backfill write.
    snapshot_after = db.execute(
        text("SELECT market, as_of FROM variant_latest_prices WHERE variant_id = :vid"),
        {"vid": backfill_variant},
    ).first()
    assert snapshot_after.as_of == date(2026, 7, 16)
    assert float(snapshot_after.market) == 99.99


def test_run_backfill_missing_archive_day_advances_watermark_without_rows(
    db, backfill_variant, monkeypatch
):
    monkeypatch.setattr(
        "app.jobs.price_backfill.download_archive", lambda client, d: None
    )

    report = run_backfill(
        db,
        date(2024, 3, 8),
        date(2024, 3, 8),
        group_ids={SET_CODE: GROUP_ID},
        sleep_seconds=0,
    )

    assert report.dates_skipped_no_archive == [date(2024, 3, 8)]
    assert report.rows_inserted == 0
    assert get_backfill_watermark(db) == date(2024, 3, 8)


def test_run_backfill_default_scope_includes_weekly_play_groups(db, monkeypatch):
    """BL-183/BL-175 step 1: with no explicit group_ids, run_backfill's
    archive walk covers ALL_PRICED_GROUP_IDS -- a day's archive carrying a
    real Weekly Play group entry (SORP's 23451) is extracted and processed
    (the deliberately-unmapped productId lands in unmapped_price_rows,
    proving the file was read rather than skipped as out-of-scope)."""
    day = date(2024, 3, 8)
    wp_group_id = 23451  # SORP -- Spark of Rebellion Weekly Play Promos
    archive_bytes = build_archive(
        day, wp_group_id, [_price_row(product_id=999999901)]
    )
    monkeypatch.setattr(
        "app.jobs.price_backfill.download_archive",
        lambda client, d: archive_bytes,
    )

    try:
        report = run_backfill(db, day, day, group_ids=None, sleep_seconds=0)
        assert report.unmapped_price_rows == 1
        assert report.dates_processed == [day]
    finally:
        db.execute(
            text("DELETE FROM pricing_sync_state WHERE key = :key"),
            {"key": WATERMARK_KEY},
        )
        db.commit()
