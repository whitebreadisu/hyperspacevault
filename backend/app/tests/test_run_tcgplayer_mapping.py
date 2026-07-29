"""DB integration tests for app/ingestion/run_tcgplayer_mapping.py's upsert
layer -- isolated synthetic set code (PT1, "pt-" swuapi_ids) so this
doesn't touch the real catalog's rows or the pytest fixture catalog other
tests assume (mirrors test_swuapi_ingestion_db.py's isolation pattern).
Uses a FakeTcgcsvClient (no live HTTP) with a small fixture products/prices
payload.

Requires DATABASE_URL -- run inside the backend container / against the
shared dev DB.
"""

import os

import pytest
from sqlalchemy import text

from app.ingestion.run_tcgplayer_mapping import fetch_catalog_variants, run

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "PT1"
GROUP_ID = 900001
WP_SET_CODE = "PT1P"
WP_GROUP_ID = 900004


class FakeTcgcsvClient:
    def __init__(self, products: list[dict], prices: list[dict]):
        self._products = products
        self._prices = prices

    def products(self, group_id: int) -> list[dict]:
        return self._products

    def prices(self, group_id: int) -> list[dict]:
        return self._prices


@pytest.fixture
def pricing_test_set(db):
    """A tiny isolated catalog: one set, two base cards (one core-tier
    variant each), cleaned up after."""
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (:code, 'Pricing Test Set', true) "
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
            "VALUES (:set_id, '1', 'Pricing Test Card', 'Unit', 'Common', "
            "'pt-base-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": set_id},
    ).scalar()

    variant_id = db.execute(
        text(
            "INSERT INTO card_variants "
            "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
            "VALUES (:base_card_id, 'Standard', :set_code, '1', 'pt-variant-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
            "RETURNING id"
        ),
        {"base_card_id": base_card_id, "set_code": SET_CODE},
    ).scalar()
    db.commit()

    yield {"variant_id": variant_id, "base_card_id": base_card_id}

    db.execute(
        text("DELETE FROM tcgplayer_products WHERE variant_id = :vid"),
        {"vid": variant_id},
    )
    db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": variant_id})
    db.execute(text("DELETE FROM base_cards WHERE id = :bid"), {"bid": base_card_id})
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.commit()


@pytest.fixture
def weekly_play_test_set(db):
    """BL-174 Part B: an isolated WP-coded set (source_set_code ending
    "P", mirroring the real SORP/LOFP/... convention) with one card
    carrying both Weekly Play and Weekly Play Foil variants."""
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (:code, 'Weekly Play Test Set', false) "
            "ON CONFLICT (code) DO NOTHING"
        ),
        {"code": WP_SET_CODE},
    )
    set_id = db.execute(
        text("SELECT id FROM sets WHERE code = :code"), {"code": WP_SET_CODE}
    ).scalar()

    base_card_id = db.execute(
        text(
            "INSERT INTO base_cards "
            "(set_id, base_card_number, name, type, rarity, swuapi_id) "
            "VALUES (:set_id, '1', 'Weekly Play Test Card', 'Unit', 'Common', "
            "'ptwp-base-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": set_id},
    ).scalar()

    variant_ids = {}
    for suffix, variant_type in [
        ("normal", "Weekly Play"),
        ("foil", "Weekly Play Foil"),
    ]:
        variant_ids[variant_type] = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, :set_code, '1', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET "
                "card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "variant_type": variant_type,
                "set_code": WP_SET_CODE,
                "swuapi_id": f"ptwp-variant-{suffix}",
            },
        ).scalar()
    db.commit()

    yield variant_ids

    for vid in variant_ids.values():
        db.execute(
            text("DELETE FROM tcgplayer_products WHERE variant_id = :vid"),
            {"vid": vid},
        )
        db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": vid})
    db.execute(text("DELETE FROM base_cards WHERE id = :bid"), {"bid": base_card_id})
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": WP_SET_CODE})
    db.commit()


def _fake_client() -> FakeTcgcsvClient:
    products = [{"productId": 55555, "name": "Pricing Test Card"}]
    prices = [
        {
            "productId": 55555,
            "subTypeName": "Normal",
            "lowPrice": 1.0,
            "midPrice": 1.5,
            "highPrice": 3.0,
            "marketPrice": 1.25,
        }
    ]
    return FakeTcgcsvClient(products, prices)


def test_fetch_catalog_variants_excludes_pytest_fixture_prefix(db, pricing_test_set):
    """SOR's shared fixture catalog (conftest's 'test-' swuapi_ids) must not
    leak into a real set's match-rate stats."""
    variants = fetch_catalog_variants(db, "SOR")
    names = {v.base_card_name for v in variants}
    assert "Test Leader Alpha" not in names


def test_run_upserts_a_new_mapping_row(db, pricing_test_set):
    client = _fake_client()
    report = run(db, client, set_codes=[SET_CODE], set_group_ids={SET_CODE: GROUP_ID})
    db.commit()

    assert report.results[SET_CODE].stats.matched == 1
    row = db.execute(
        text(
            "SELECT tcg_product_id, sub_type, match_method FROM tcgplayer_products "
            "WHERE variant_id = :vid"
        ),
        {"vid": pricing_test_set["variant_id"]},
    ).first()
    assert row.tcg_product_id == 55555
    assert row.sub_type == "Normal"
    assert row.match_method == "name_tier_exact"


def test_run_is_idempotent_on_rerun(db, pricing_test_set):
    client = _fake_client()
    run(db, client, set_codes=[SET_CODE], set_group_ids={SET_CODE: GROUP_ID})
    db.commit()
    run(db, _fake_client(), set_codes=[SET_CODE], set_group_ids={SET_CODE: GROUP_ID})
    db.commit()

    count = db.execute(
        text("SELECT count(*) FROM tcgplayer_products WHERE variant_id = :vid"),
        {"vid": pricing_test_set["variant_id"]},
    ).scalar()
    assert count == 1


def _fake_wp_client() -> FakeTcgcsvClient:
    """A WP-shaped fixture payload (SOR-era style: one productId, both
    subTypeName rows, no name suffix)."""
    products = [{"productId": 66666, "name": "Weekly Play Test Card"}]
    prices = [
        {
            "productId": 66666,
            "subTypeName": "Normal",
            "lowPrice": 0.5,
            "midPrice": 0.75,
            "highPrice": 1.5,
            "marketPrice": 0.6,
        },
        {
            "productId": 66666,
            "subTypeName": "Foil",
            "lowPrice": 1.0,
            "midPrice": 1.5,
            "highPrice": 3.0,
            "marketPrice": 1.2,
        },
    ]
    return FakeTcgcsvClient(products, prices)


def test_run_maps_weekly_play_groups_via_the_wp_resolver(db, weekly_play_test_set):
    """BL-174 Part B end-to-end: a set_code passed through
    weekly_play_set_codes takes the resolve_weekly_play_variant_type/
    WEEKLY_PLAY_VARIANT_TYPES path and correctly matches BOTH Weekly Play
    and Weekly Play Foil to the same shared productId, split by
    subTypeName."""
    client = _fake_wp_client()
    report = run(
        db,
        client,
        set_codes=[WP_SET_CODE],
        set_group_ids={WP_SET_CODE: WP_GROUP_ID},
        weekly_play_set_codes={WP_SET_CODE},
    )
    db.commit()

    assert report.results[WP_SET_CODE].stats.matched == 2
    assert report.results[WP_SET_CODE].exceptions == []

    rows = db.execute(
        text(
            "SELECT variant_id, tcg_product_id, sub_type FROM tcgplayer_products "
            "WHERE variant_id = ANY(:vids)"
        ),
        {"vids": list(weekly_play_test_set.values())},
    ).all()
    by_variant = {r.variant_id: r for r in rows}
    assert by_variant[weekly_play_test_set["Weekly Play"]].sub_type == "Normal"
    assert by_variant[weekly_play_test_set["Weekly Play Foil"]].sub_type == "Foil"
    assert all(r.tcg_product_id == 66666 for r in rows)


def test_run_defaults_weekly_play_set_codes_to_the_real_wp_map(db, pricing_test_set):
    """When weekly_play_set_codes isn't passed, run() falls back to the
    real tcgcsv_client.WEEKLY_PLAY_GROUP_IDS keys -- PT1 (a plain root-set-
    shaped code, not "P"-suffixed) must NOT be treated as a WP set even
    though this call omits the parameter, proving the default doesn't
    accidentally widen to every set."""
    client = _fake_client()
    report = run(db, client, set_codes=[SET_CODE], set_group_ids={SET_CODE: GROUP_ID})
    db.commit()

    # Standard-tier fixture data resolves via the default (core) path --
    # if the WP resolver had been picked instead, subTypeName "Normal"
    # would still match, but the finish would silently be misclassified.
    assert report.results[SET_CODE].stats.matched == 1
    row = db.execute(
        text(
            "SELECT sub_type, match_method FROM tcgplayer_products "
            "WHERE variant_id = :vid"
        ),
        {"vid": pricing_test_set["variant_id"]},
    ).first()
    assert row.match_method == "name_tier_exact"
    assert row.sub_type == "Normal"
