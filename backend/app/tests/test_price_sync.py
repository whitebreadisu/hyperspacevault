"""BL-136 P2: tests for the daily price sync job (app/jobs/price_sync.py).
Isolated synthetic set/variant (mirrors test_run_tcgplayer_mapping.py's
pattern) with a directly-inserted tcgplayer_products row (P1's output,
faked here rather than re-running the mapping builder) and a FakeTcgcsv
Client -- no live HTTP, no dependency on the real catalog's mapping.
"""

import os
from datetime import date

import pytest
from sqlalchemy import text

from app.ingestion.tcgcsv_client import ALL_PRICED_GROUP_IDS, WEEKLY_PLAY_GROUP_IDS
from app.jobs.price_sync import WATERMARK_KEY, get_watermark, run_sync

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "PS1"
GROUP_ID = 900002
LAST_UPDATED = "2026-07-16T20:05:27+0000"


class FakeTcgcsvClient:
    def __init__(self, prices: list[dict], last_updated: str = LAST_UPDATED):
        self._prices = prices
        self._last_updated = last_updated

    def last_updated(self) -> str:
        return self._last_updated

    def prices(self, group_id: int) -> list[dict]:
        return self._prices


@pytest.fixture
def priced_variant(db):
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (:code, 'Price Sync Test Set', true) "
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
            "VALUES (:set_id, '1', 'Price Sync Test Card', 'Unit', 'Common', "
            "'ps-base-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": set_id},
    ).scalar()
    variant_id = db.execute(
        text(
            "INSERT INTO card_variants "
            "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
            "VALUES (:base_card_id, 'Standard', :set_code, '1', 'ps-variant-1') "
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
            "VALUES (:variant_id, 66666, :group_id, 'Normal', 'name_tier_exact', "
            "'Price Sync Test Card') "
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


SHARED_TCG_PRODUCT_ID = 77777


@pytest.fixture
def shared_key_variants(db):
    """Three variants of one base card all mapped to the SAME
    (tcg_product_id, sub_type) -- the real shape of BL-159's 38 shared-key
    groups (e.g. the IBH 3-variant products, where tcgplayer sells one
    product covering multiple catalog variants)."""
    set_id = (
        db.execute(
            text(
                "INSERT INTO sets (code, name, is_base_set) "
                "VALUES (:code, 'Price Sync Test Set', true) "
                "ON CONFLICT (code) DO NOTHING RETURNING id"
            ),
            {"code": SET_CODE},
        ).scalar()
        or db.execute(
            text("SELECT id FROM sets WHERE code = :code"), {"code": SET_CODE}
        ).scalar()
    )
    base_card_id = db.execute(
        text(
            "INSERT INTO base_cards "
            "(set_id, base_card_number, name, type, rarity, swuapi_id) "
            "VALUES (:set_id, '2', 'Shared Key Test Card', 'Unit', 'Common', "
            "'ps-base-shared') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": set_id},
    ).scalar()
    variant_ids = []
    for i, variant_type in enumerate(["Standard", "Foil", "Hyperspace"], start=1):
        variant_id = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, "
                "swuapi_id) "
                "VALUES (:base_card_id, :variant_type, :set_code, '2', "
                ":swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET "
                "card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "variant_type": variant_type,
                "set_code": SET_CODE,
                "swuapi_id": f"ps-variant-shared-{i}",
            },
        ).scalar()
        db.execute(
            text(
                "INSERT INTO tcgplayer_products "
                "(variant_id, tcg_product_id, tcg_group_id, sub_type, "
                "match_method, matched_name) "
                "VALUES (:variant_id, :product_id, :group_id, 'Normal', "
                "'name_tier_exact', 'Shared Key Test Card') "
                "ON CONFLICT (variant_id) DO UPDATE SET "
                "tcg_product_id = EXCLUDED.tcg_product_id"
            ),
            {
                "variant_id": variant_id,
                "product_id": SHARED_TCG_PRODUCT_ID,
                "group_id": GROUP_ID,
            },
        )
        variant_ids.append(variant_id)
    db.commit()

    yield variant_ids

    for vid in variant_ids:
        db.execute(
            text("DELETE FROM variant_prices WHERE variant_id = :vid"), {"vid": vid}
        )
        db.execute(
            text("DELETE FROM variant_latest_prices WHERE variant_id = :vid"),
            {"vid": vid},
        )
        db.execute(
            text("DELETE FROM tcgplayer_products WHERE variant_id = :vid"),
            {"vid": vid},
        )
        db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": vid})
    db.execute(text("DELETE FROM base_cards WHERE id = :bid"), {"bid": base_card_id})
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.execute(
        text("DELETE FROM pricing_sync_state WHERE key = :key"), {"key": WATERMARK_KEY}
    )
    db.commit()


def _price_row(market=1.25, low=1.0):
    return {
        "productId": 66666,
        "subTypeName": "Normal",
        "lowPrice": low,
        "midPrice": 1.5,
        "highPrice": 3.0,
        "marketPrice": market,
    }


def test_run_sync_upserts_a_price_row(db, priced_variant):
    client = FakeTcgcsvClient([_price_row()])
    report = run_sync(
        db, client, as_of=date(2026, 7, 16), group_ids={SET_CODE: GROUP_ID}
    )
    db.commit()

    assert report.ran is True
    assert report.rows_upserted == 1
    assert report.unmapped_price_rows == 0
    row = db.execute(
        text("SELECT market, low, as_of FROM variant_prices WHERE variant_id = :vid"),
        {"vid": priced_variant},
    ).first()
    assert float(row.market) == 1.25
    assert float(row.low) == 1.0
    assert row.as_of == date(2026, 7, 16)
    assert get_watermark(db) == LAST_UPDATED


def test_run_sync_skips_when_watermark_already_current(db, priced_variant):
    client = FakeTcgcsvClient([_price_row()])
    run_sync(db, client, as_of=date(2026, 7, 16), group_ids={SET_CODE: GROUP_ID})
    db.commit()

    second_report = run_sync(
        db,
        FakeTcgcsvClient([_price_row(market=99.99)]),
        as_of=date(2026, 7, 16),
        group_ids={SET_CODE: GROUP_ID},
    )
    db.rollback()  # skipped run made no writes; rollback is a no-op here

    assert second_report.ran is False
    row = db.execute(
        text("SELECT market FROM variant_prices WHERE variant_id = :vid"),
        {"vid": priced_variant},
    ).first()
    assert float(row.market) == 1.25  # untouched by the skipped run


def test_run_sync_forced_rerun_same_day_produces_no_duplicate_rows(db, priced_variant):
    client = FakeTcgcsvClient([_price_row()])
    run_sync(db, client, as_of=date(2026, 7, 16), group_ids={SET_CODE: GROUP_ID})
    db.commit()

    run_sync(
        db,
        FakeTcgcsvClient([_price_row(market=1.30)]),
        force=True,
        as_of=date(2026, 7, 16),
        group_ids={SET_CODE: GROUP_ID},
    )
    db.commit()

    rows = db.execute(
        text("SELECT market FROM variant_prices WHERE variant_id = :vid"),
        {"vid": priced_variant},
    ).all()
    assert len(rows) == 1  # ON CONFLICT updated in place, not a second row
    assert float(rows[0].market) == 1.30


def test_run_sync_maintains_variant_latest_prices_snapshot(db, priced_variant):
    """BL-146: upsert_prices (shared by price_sync and price_backfill) must
    keep variant_latest_prices current in the SAME transaction as its
    variant_prices write -- the whole point of the snapshot table is that
    readers never again need to scan variant_prices for "what's the latest
    price"."""
    client = FakeTcgcsvClient([_price_row()])
    run_sync(db, client, as_of=date(2026, 7, 16), group_ids={SET_CODE: GROUP_ID})
    db.commit()

    row = db.execute(
        text(
            "SELECT market, low, as_of FROM variant_latest_prices "
            "WHERE variant_id = :vid"
        ),
        {"vid": priced_variant},
    ).first()
    assert row is not None
    assert float(row.market) == 1.25
    assert float(row.low) == 1.0
    assert row.as_of == date(2026, 7, 16)


def test_run_sync_snapshot_advances_on_a_later_day(db, priced_variant):
    """A later day's sync must move the snapshot forward -- the ordinary
    "today always wins" case (as opposed to the out-of-order historical
    guard, covered in test_price_backfill.py). Each call needs a DISTINCT
    tcgcsv last_updated value -- otherwise run_sync's watermark check
    (same posture as test_run_sync_skips_when_watermark_already_current)
    treats the second call as "already synced" and skips it entirely,
    which is exactly what broke this test the first time it was written."""
    run_sync(
        db,
        FakeTcgcsvClient([_price_row(market=1.25)], last_updated="build-1"),
        as_of=date(2026, 7, 16),
        group_ids={SET_CODE: GROUP_ID},
    )
    db.commit()

    second_report = run_sync(
        db,
        FakeTcgcsvClient([_price_row(market=1.50)], last_updated="build-2"),
        as_of=date(2026, 7, 17),
        group_ids={SET_CODE: GROUP_ID},
    )
    db.commit()
    assert second_report.ran is True

    row = db.execute(
        text("SELECT market, as_of FROM variant_latest_prices WHERE variant_id = :vid"),
        {"vid": priced_variant},
    ).first()
    assert float(row.market) == 1.50
    assert row.as_of == date(2026, 7, 17)


def test_run_sync_fans_out_shared_key_groups_to_every_variant(db, shared_key_variants):
    """BL-159 regression: one tcgcsv price row whose (productId, subTypeName)
    maps to SEVERAL variants must write a variant_prices row (and snapshot
    row) for EVERY one of them. The pre-fix one-to-one index kept only the
    last-loaded variant per key, so the other variants of each shared-key
    group silently got no price at all -- 53 variants/day on prod."""
    price = _price_row()
    price["productId"] = SHARED_TCG_PRODUCT_ID
    client = FakeTcgcsvClient([price])
    report = run_sync(
        db, client, as_of=date(2026, 7, 16), group_ids={SET_CODE: GROUP_ID}
    )
    db.commit()

    assert report.ran is True
    assert report.rows_upserted == 3  # one variant row per mapped variant
    assert report.unmapped_price_rows == 0
    for vid in shared_key_variants:
        row = db.execute(
            text(
                "SELECT market, low, as_of FROM variant_prices WHERE variant_id = :vid"
            ),
            {"vid": vid},
        ).first()
        assert row is not None, f"variant {vid} got no price row (BL-159 collapse)"
        assert float(row.market) == 1.25
        assert row.as_of == date(2026, 7, 16)
        snapshot = db.execute(
            text(
                "SELECT market, as_of FROM variant_latest_prices "
                "WHERE variant_id = :vid"
            ),
            {"vid": vid},
        ).first()
        assert snapshot is not None
        assert float(snapshot.market) == 1.25


def test_run_sync_counts_unmapped_price_rows(db, priced_variant):
    unmapped_row = _price_row()
    unmapped_row["productId"] = 12345  # not in tcgplayer_products
    client = FakeTcgcsvClient([unmapped_row])
    report = run_sync(
        db, client, as_of=date(2026, 7, 16), group_ids={SET_CODE: GROUP_ID}
    )
    db.commit()

    assert report.rows_upserted == 0
    assert report.unmapped_price_rows == 1
    count = db.execute(
        text("SELECT count(*) FROM variant_prices WHERE variant_id = :vid"),
        {"vid": priced_variant},
    ).scalar()
    assert count == 0


def test_run_sync_defaults_to_all_priced_group_ids(db):
    """BL-174: run_sync's default fetch scope (no group_ids override) must
    be the SAME ALL_PRICED_GROUP_IDS map the mapping builder defaults to
    (root sets + Weekly Play groups) -- the single-source-of-truth
    requirement (Pricing_Coverage_NonCore_Finishes_2026-07-27.md). A
    recording FakeTcgcsvClient captures which group_ids .prices() was
    called for and asserts the set matches exactly, including at least
    one real Weekly Play group id."""

    class RecordingClient:
        def __init__(self):
            self.requested_group_ids: list[int] = []

        def last_updated(self) -> str:
            return "bl174-default-scope-check"

        def prices(self, group_id: int) -> list[dict]:
            self.requested_group_ids.append(group_id)
            return []

    client = RecordingClient()
    report = run_sync(db, client, as_of=date(2026, 7, 27))
    db.rollback()  # never committed -- discards the watermark write too

    assert report.ran is True
    assert report.groups_synced == len(ALL_PRICED_GROUP_IDS)
    assert set(client.requested_group_ids) == set(ALL_PRICED_GROUP_IDS.values())
    assert WEEKLY_PLAY_GROUP_IDS["SORP"] in client.requested_group_ids


def test_tcgcsv_client_sends_required_user_agent_and_throttles(monkeypatch):
    """Compliance check (BL-136 brief): every tcgcsv request carries the
    identifiable User-Agent, and throttle() actually sleeps >=100ms between
    sequential requests -- both mandatory per tcgcsv.com's fair-use
    guidance (spike §2)."""
    from app.ingestion import tcgcsv_client

    assert tcgcsv_client.USER_AGENT == "SWUInventoryManager/1.0"
    assert tcgcsv_client.MIN_REQUEST_INTERVAL_SECONDS >= 0.1

    client = tcgcsv_client.TcgcsvClient()
    try:
        assert client._client.headers["User-Agent"] == "SWUInventoryManager/1.0"
    finally:
        client.close()

    slept: list[float] = []
    monkeypatch.setattr(tcgcsv_client.time, "sleep", lambda s: slept.append(s))
    tcgcsv_client.throttle()
    assert slept == [tcgcsv_client.MIN_REQUEST_INTERVAL_SECONDS]
