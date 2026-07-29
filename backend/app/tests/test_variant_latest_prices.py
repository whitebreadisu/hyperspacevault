"""BL-146: tests for the variant_latest_prices snapshot table (issue #368)
-- the promote-gate fix that makes the latest-price read path independent
of variant_prices' history depth.

Covers three things the writer-level tests in test_price_sync.py /
test_price_backfill.py don't already: (1) upsert_latest_price's
out-of-order guard in isolation, at the repository layer, with no job
plumbing around it; (2) the migration 0029 populate statement's DISTINCT ON
semantics, proven directly against multi-day, multi-variant history built
by this test (not just "ran once against an empty table" during `alembic
upgrade head`); (3) reader-equivalence -- app.repositories.pricing.
get_latest_prices (reading the snapshot table) returns exactly what a
manual DISTINCT ON over variant_prices computes, for the same fixture data.

Isolated synthetic set/variants (own set code, own swuapi_ids) -- mirrors
test_pricing_api.py's priced_base_card fixture pattern.
"""

import os
from datetime import date

import pytest
from sqlalchemy import text

from app.repositories.pricing import get_latest_prices, upsert_latest_price

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "VL1"

# Verbatim copy of alembic/versions/0029_variant_latest_prices.py's
# POPULATE_SNAPSHOT_SQL -- migrations in this codebase are self-contained
# snapshots-in-time and don't get imported by application/test code (see
# 0001-0028's import lists), so this is deliberately duplicated rather than
# shared, to prove the exact statement the migration runs computes the
# correct "latest per variant" result against real multi-day history.
MIGRATION_0029_POPULATE_SQL = """
    INSERT INTO variant_latest_prices (variant_id, market, low, as_of)
    SELECT DISTINCT ON (variant_id) variant_id, market, low, as_of
    FROM variant_prices
    ORDER BY variant_id, as_of DESC
    ON CONFLICT (variant_id) DO NOTHING
"""


@pytest.fixture
def two_priced_variants(db):
    """Two variants, each with THREE variant_prices rows inserted
    OUT OF ORDER (middle day first) -- proves the populate/read logic keys
    off as_of, not insertion order. Variant A's true latest is 2026-07-18
    (market=12.0); variant B's true latest is 2026-07-17 (market=40.0, an
    earlier max-date than A, so a naive "last inserted" assumption would
    also fail differently per variant)."""
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (:code, 'Variant Latest Price Test Set', true) "
            "ON CONFLICT (code) DO NOTHING"
        ),
        {"code": SET_CODE},
    )
    set_id = db.execute(
        text("SELECT id FROM sets WHERE code = :code"), {"code": SET_CODE}
    ).scalar()

    variant_ids = {}
    for suffix, number in (("a", "1"), ("b", "2")):
        base_card_id = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, type, rarity, swuapi_id) "
                "VALUES (:set_id, :number, :name, 'Unit', 'Common', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id"
            ),
            {
                "set_id": set_id,
                "number": number,
                "name": f"VL1 Test Card {suffix.upper()}",
                "swuapi_id": f"vl1-base-{suffix}",
            },
        ).scalar()
        vid = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, 'Standard', :set_code, :number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "set_code": SET_CODE,
                "number": number,
                "swuapi_id": f"vl1-variant-{suffix}",
            },
        ).scalar()
        variant_ids[suffix] = vid

    # Variant A: latest is 2026-07-18 (12.0/10.0), inserted out of order.
    for as_of, market, low in [
        (date(2026, 7, 17), 11.0, 9.0),
        (date(2026, 7, 15), 9.0, 7.0),
        (date(2026, 7, 18), 12.0, 10.0),
    ]:
        db.execute(
            text(
                "INSERT INTO variant_prices "
                "(variant_id, as_of, market, low, mid, high, currency) "
                "VALUES (:vid, :as_of, :market, :low, :market, :market, 'USD')"
            ),
            {"vid": variant_ids["a"], "as_of": as_of, "market": market, "low": low},
        )
    # Variant B: latest is 2026-07-17 (40.0/35.0), also out of order.
    for as_of, market, low in [
        (date(2026, 7, 16), 30.0, 25.0),
        (date(2026, 7, 17), 40.0, 35.0),
        (date(2026, 7, 10), 20.0, 15.0),
    ]:
        db.execute(
            text(
                "INSERT INTO variant_prices "
                "(variant_id, as_of, market, low, mid, high, currency) "
                "VALUES (:vid, :as_of, :market, :low, :market, :market, 'USD')"
            ),
            {"vid": variant_ids["b"], "as_of": as_of, "market": market, "low": low},
        )
    db.commit()

    yield variant_ids

    for vid in variant_ids.values():
        db.execute(
            text("DELETE FROM variant_prices WHERE variant_id = :vid"), {"vid": vid}
        )
        db.execute(
            text("DELETE FROM variant_latest_prices WHERE variant_id = :vid"),
            {"vid": vid},
        )
        db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": vid})
    db.execute(text("DELETE FROM base_cards WHERE set_id = :sid"), {"sid": set_id})
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.commit()


class TestMigrationPopulateQuery:
    def test_populate_sql_computes_the_max_as_of_row_per_variant(
        self, db, two_priced_variants
    ):
        """Runs the EXACT statement migration 0029 executes once, against
        real multi-day, out-of-order history for two variants -- proves the
        DISTINCT ON .. ORDER BY variant_id, as_of DESC populate logic picks
        the true latest row per variant, not the first/last-inserted one."""
        db.execute(text(MIGRATION_0029_POPULATE_SQL))
        db.commit()

        variant_ids = two_priced_variants
        row_a = db.execute(
            text(
                "SELECT market, low, as_of FROM variant_latest_prices "
                "WHERE variant_id = :vid"
            ),
            {"vid": variant_ids["a"]},
        ).first()
        row_b = db.execute(
            text(
                "SELECT market, low, as_of FROM variant_latest_prices "
                "WHERE variant_id = :vid"
            ),
            {"vid": variant_ids["b"]},
        ).first()

        assert row_a.as_of == date(2026, 7, 18)
        assert float(row_a.market) == 12.0
        assert float(row_a.low) == 10.0

        assert row_b.as_of == date(2026, 7, 17)
        assert float(row_b.market) == 40.0
        assert float(row_b.low) == 35.0

    def test_populate_sql_is_a_no_op_for_a_variant_already_snapshotted(
        self, db, two_priced_variants
    ):
        """ON CONFLICT (variant_id) DO NOTHING -- re-running the populate
        statement (e.g. a replayed migration) must never clobber a snapshot
        row a writer has already established, even if variant_prices' true
        latest has since moved on. Not the expected operational path (the
        migration runs once), but keeps the statement honestly idempotent."""
        variant_ids = two_priced_variants
        upsert_latest_price(db, variant_ids["a"], 999.0, 888.0, date(2020, 1, 1))
        db.commit()

        db.execute(text(MIGRATION_0029_POPULATE_SQL))
        db.commit()

        row_a = db.execute(
            text(
                "SELECT market, as_of FROM variant_latest_prices WHERE variant_id = :vid"
            ),
            {"vid": variant_ids["a"]},
        ).first()
        assert row_a.as_of == date(2020, 1, 1)  # untouched by the populate re-run
        assert float(row_a.market) == 999.0


class TestReaderEquivalence:
    def test_get_latest_prices_matches_a_manual_distinct_on_over_history(
        self, db, two_priced_variants
    ):
        """The whole point of BL-146: get_latest_prices (now reading
        variant_latest_prices) must return exactly what the old, unscoped
        `SELECT DISTINCT ON (variant_id) ... FROM variant_prices ORDER BY
        variant_id, as_of DESC` would have computed -- values unchanged,
        only the read path's cost profile changed."""
        variant_ids = two_priced_variants
        db.execute(text(MIGRATION_0029_POPULATE_SQL))
        db.commit()

        snapshot_result = get_latest_prices(db, list(variant_ids.values()))

        manual_distinct_on = {
            row.variant_id: row
            for row in db.execute(
                text(
                    "SELECT DISTINCT ON (variant_id) variant_id, market, low, as_of "
                    "FROM variant_prices WHERE variant_id = ANY(:vids) "
                    "ORDER BY variant_id, as_of DESC"
                ),
                {"vids": list(variant_ids.values())},
            ).all()
        }

        assert set(snapshot_result.keys()) == set(manual_distinct_on.keys())
        for vid, snap_row in snapshot_result.items():
            history_row = manual_distinct_on[vid]
            assert snap_row.as_of == history_row.as_of
            assert float(snap_row.market) == float(history_row.market)
            assert float(snap_row.low) == float(history_row.low)


class TestUpsertLatestPriceGuard:
    def test_upsert_latest_price_inserts_when_no_row_exists(self, db):
        db.execute(
            text(
                "INSERT INTO sets (code, name, is_base_set) "
                "VALUES ('VL2', 'Upsert Guard Test Set', true) "
                "ON CONFLICT (code) DO NOTHING"
            )
        )
        set_id = db.execute(text("SELECT id FROM sets WHERE code = 'VL2'")).scalar()
        base_card_id = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, type, rarity, swuapi_id) "
                "VALUES (:set_id, '1', 'Upsert Guard Test Card', 'Unit', "
                "'Common', 'vl2-base-1') "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id"
            ),
            {"set_id": set_id},
        ).scalar()
        vid = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, "
                "swuapi_id) "
                "VALUES (:base_card_id, 'Standard', 'VL2', '1', 'vl2-variant-1') "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {"base_card_id": base_card_id},
        ).scalar()
        db.commit()

        try:
            upsert_latest_price(db, vid, 5.0, 4.0, date(2026, 7, 20))
            db.commit()

            row = db.execute(
                text(
                    "SELECT market, low, as_of FROM variant_latest_prices "
                    "WHERE variant_id = :vid"
                ),
                {"vid": vid},
            ).first()
            assert float(row.market) == 5.0
            assert float(row.low) == 4.0
            assert row.as_of == date(2026, 7, 20)

            # A NEWER as_of updates in place...
            upsert_latest_price(db, vid, 6.0, 5.0, date(2026, 7, 21))
            db.commit()
            row = db.execute(
                text(
                    "SELECT market, as_of FROM variant_latest_prices "
                    "WHERE variant_id = :vid"
                ),
                {"vid": vid},
            ).first()
            assert row.as_of == date(2026, 7, 21)
            assert float(row.market) == 6.0

            # ...but an OLDER as_of (out-of-order historical write) must be
            # rejected by the guard -- this is upsert_latest_price's core
            # safety property, exercised here with no job/transaction
            # plumbing around it.
            upsert_latest_price(db, vid, 1.0, 0.5, date(2020, 1, 1))
            db.commit()
            row = db.execute(
                text(
                    "SELECT market, as_of FROM variant_latest_prices "
                    "WHERE variant_id = :vid"
                ),
                {"vid": vid},
            ).first()
            assert row.as_of == date(2026, 7, 21)  # unchanged
            assert float(row.market) == 6.0  # unchanged

            # An EQUAL as_of (same-day re-run/re-sync) still updates --
            # the guard is `>=`, not `>`.
            upsert_latest_price(db, vid, 6.5, 5.5, date(2026, 7, 21))
            db.commit()
            row = db.execute(
                text(
                    "SELECT market, as_of FROM variant_latest_prices "
                    "WHERE variant_id = :vid"
                ),
                {"vid": vid},
            ).first()
            assert row.as_of == date(2026, 7, 21)
            assert float(row.market) == 6.5
        finally:
            db.execute(
                text("DELETE FROM variant_latest_prices WHERE variant_id = :vid"),
                {"vid": vid},
            )
            db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": vid})
            db.execute(
                text("DELETE FROM base_cards WHERE id = :bid"), {"bid": base_card_id}
            )
            db.execute(text("DELETE FROM sets WHERE code = 'VL2'"))
            db.commit()
