"""BL-139: tests for the dev->prod price-history transfer script
(app/ingestion/transfer_variant_prices.py). Same isolated set/variant
fixture pattern as test_price_sync.py; the same database plays both source
and target (export then re-import is a no-op by design -- the idempotency
the real prod import relies on).

Export preflight's contiguity/staleness rules are covered through the pure
helper (find_missing_days) plus the --force path; DB-backed tests always
pass force=True so ambient rows left by other test modules can't make the
global-window preflight flaky.
"""

import csv
import os
from datetime import date, timedelta
from decimal import Decimal

import psycopg2
import pytest

from app.ingestion.transfer_variant_prices import (
    STAGING_TABLE,
    export_prices,
    find_missing_days,
    import_prices,
    verify_transfer,
)

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "PT1"
GROUP_ID = 900004
PRODUCT_ID = 77401
CSV_HEADER = [
    "tcg_product_id",
    "sub_type",
    "as_of",
    "market",
    "low",
    "mid",
    "high",
    "currency",
]

YESTERDAY = date.today() - timedelta(days=1)
DAYS = [YESTERDAY - timedelta(days=2), YESTERDAY - timedelta(days=1), YESTERDAY]


def test_find_missing_days_contiguous():
    days = [date(2026, 7, 1) + timedelta(days=i) for i in range(5)]
    assert find_missing_days(days, days[0], days[-1]) == []


def test_find_missing_days_reports_gap():
    days = [date(2026, 7, 1), date(2026, 7, 2), date(2026, 7, 5)]
    assert find_missing_days(days, days[0], days[-1]) == [
        date(2026, 7, 3),
        date(2026, 7, 4),
    ]


@pytest.fixture
def conn():
    c = psycopg2.connect(os.environ["DATABASE_URL"])
    yield c
    c.close()


@pytest.fixture
def priced_pair(conn):
    """Two variants of one card mapped to the SAME tcg productId under
    different subtypes (Normal/Foil -- tcgcsv's real shape), each with a
    3-day contiguous history ending yesterday, snapshot rows current."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (%s, 'Transfer Test Set', true) ON CONFLICT (code) DO NOTHING",
            (SET_CODE,),
        )
        cur.execute("SELECT id FROM sets WHERE code = %s", (SET_CODE,))
        set_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO base_cards "
            "(set_id, base_card_number, name, type, rarity, swuapi_id) "
            "VALUES (%s, '1', 'Transfer Test Card', 'Unit', 'Common', 'pt-base-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name RETURNING id",
            (set_id,),
        )
        base_card_id = cur.fetchone()[0]
        variant_ids = {}
        for swuapi_id, variant_type, sub_type in [
            ("pt-variant-1", "Standard", "Normal"),
            ("pt-variant-2", "Standard Foil", "Foil"),
        ]:
            cur.execute(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (%s, %s, %s, '1', %s) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id",
                (base_card_id, variant_type, SET_CODE, swuapi_id),
            )
            vid = cur.fetchone()[0]
            variant_ids[sub_type] = vid
            cur.execute(
                "INSERT INTO tcgplayer_products "
                "(variant_id, tcg_product_id, tcg_group_id, sub_type, match_method, "
                "matched_name) "
                "VALUES (%s, %s, %s, %s, 'name_tier_exact', 'Transfer Test Card') "
                "ON CONFLICT (variant_id) DO UPDATE SET "
                "tcg_product_id = EXCLUDED.tcg_product_id, sub_type = EXCLUDED.sub_type",
                (vid, PRODUCT_ID, GROUP_ID, sub_type),
            )
            for i, day in enumerate(DAYS):
                cur.execute(
                    "INSERT INTO variant_prices "
                    "(variant_id, as_of, market, low, mid, high, currency) "
                    "VALUES (%s, %s, %s, %s, %s, %s, 'USD') "
                    "ON CONFLICT (variant_id, as_of) DO NOTHING",
                    (vid, day, 10 + i, 5 + i, 8 + i, 20 + i),
                )
            cur.execute(
                "INSERT INTO variant_latest_prices (variant_id, market, low, as_of) "
                "VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (variant_id) DO UPDATE SET market = EXCLUDED.market, "
                "low = EXCLUDED.low, as_of = EXCLUDED.as_of",
                (vid, 12, 7, DAYS[-1]),
            )
    conn.commit()

    yield variant_ids

    with conn.cursor() as cur:
        cur.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
        vids = tuple(variant_ids.values())
        cur.execute("DELETE FROM variant_prices WHERE variant_id IN %s", (vids,))
        cur.execute("DELETE FROM variant_latest_prices WHERE variant_id IN %s", (vids,))
        cur.execute("DELETE FROM tcgplayer_products WHERE variant_id IN %s", (vids,))
        cur.execute("DELETE FROM card_variants WHERE id IN %s", (vids,))
        cur.execute("DELETE FROM base_cards WHERE swuapi_id = 'pt-base-1'")
        cur.execute("DELETE FROM sets WHERE code = %s", (SET_CODE,))
    conn.commit()


def _count_prices(conn, variant_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM variant_prices WHERE variant_id = %s", (variant_id,)
        )
        return cur.fetchone()[0]


def test_export_then_reimport_is_noop(conn, priced_pair, tmp_path):
    out = tmp_path / "prices.csv"
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM variant_prices")
        total = cur.fetchone()[0]

    exported = export_prices(conn, str(out), force=True)
    assert exported == total
    with open(out, newline="") as f:
        rows = list(csv.reader(f))
    assert rows[0] == CSV_HEADER
    assert len(rows) - 1 == total

    result = import_prices(conn, str(out))
    assert result["staged"] == total
    assert result["unmatched"] == 0
    assert result["inserted"] == 0  # every (variant_id, as_of) already present


def test_import_restores_deleted_history_and_snapshot(conn, priced_pair, tmp_path):
    out = tmp_path / "prices.csv"
    export_prices(conn, str(out), force=True)

    foil_id = priced_pair["Foil"]
    with conn.cursor() as cur:
        cur.execute("DELETE FROM variant_prices WHERE variant_id = %s", (foil_id,))
        cur.execute(
            "UPDATE variant_latest_prices "
            "SET market = 0.01, low = 0.01, as_of = %s WHERE variant_id = %s",
            (DAYS[0], foil_id),
        )
    conn.commit()
    assert _count_prices(conn, foil_id) == 0

    result = import_prices(conn, str(out))
    assert result["inserted"] == len(DAYS)
    assert _count_prices(conn, foil_id) == len(DAYS)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT market, low, as_of FROM variant_latest_prices "
            "WHERE variant_id = %s",
            (foil_id,),
        )
        market, low, as_of = cur.fetchone()
    assert (market, low, as_of) == (Decimal("12"), Decimal("7"), DAYS[-1])


def test_import_counts_and_skips_unmatched_keys(conn, priced_pair, tmp_path):
    csv_path = tmp_path / "partial.csv"
    new_day = DAYS[0] - timedelta(days=1)
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        writer.writerow([PRODUCT_ID, "Normal", new_day, "9.99", "4.99", "", "", "USD"])
        writer.writerow([99999999, "Normal", new_day, "1.00", "1.00", "", "", "USD"])

    result = import_prices(conn, str(csv_path))
    assert result["staged"] == 2
    assert result["unmatched"] == 1
    assert result["inserted"] == 1
    with conn.cursor() as cur:
        cur.execute(
            "SELECT market FROM variant_prices WHERE variant_id = %s AND as_of = %s",
            (priced_pair["Normal"], new_day),
        )
        assert cur.fetchone()[0] == Decimal("9.99")


def test_snapshot_guard_never_regresses_newer_row(conn, priced_pair, tmp_path):
    """The target's daily sync may write a NEWER snapshot row between export
    and import; the refresh must leave it untouched (same guard as
    app.repositories.pricing.upsert_latest_price)."""
    out = tmp_path / "prices.csv"
    export_prices(conn, str(out), force=True)

    normal_id = priced_pair["Normal"]
    newer_day = date.today()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE variant_latest_prices "
            "SET market = 99.99, low = 88.88, as_of = %s WHERE variant_id = %s",
            (newer_day, normal_id),
        )
    conn.commit()

    import_prices(conn, str(out))
    with conn.cursor() as cur:
        cur.execute(
            "SELECT market, as_of FROM variant_latest_prices WHERE variant_id = %s",
            (normal_id,),
        )
        market, as_of = cur.fetchone()
    assert (market, as_of) == (Decimal("99.99"), newer_day)


def test_verify_passes_against_self_and_catches_snapshot_drift(conn, priced_pair):
    # A database compared with itself: history checks pass trivially, and the
    # snapshot self-consistency check runs for real.
    source = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        assert verify_transfer(source, conn, samples=4) is True

        foil_id = priced_pair["Foil"]
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE variant_latest_prices SET market = 0.42 WHERE variant_id = %s",
                (foil_id,),
            )
        conn.commit()
        assert verify_transfer(source, conn, samples=4) is False
    finally:
        source.close()
