"""DB integration tests for the BL-29 ingestion upsert layer
(app/ingestion/run_swuapi_ingestion.py).

Uses a small, self-contained synthetic export (distinct "ingest-test-*"
swuapi_ids/set codes) rather than the full 8,353-card fixture, so this
doesn't pollute the shared catalog state other tests assume (test_cards_api,
test_inventory_api, etc. expect the conftest seed_minimal_catalog's small
SOR fixture and nothing more). Cleaned up explicitly in teardown, mirroring
test_inventory_concurrency.py's pattern for DB-isolated tests.

Requires DATABASE_URL -- run inside the backend container.
"""

import os

import pytest
from sqlalchemy import text

from app.ingestion.run_swuapi_ingestion import run_ingestion

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "IT1"


def _synthetic_export() -> dict:
    return {
        "sets": [{"code": SET_CODE, "name": "Ingestion Test Set"}],
        "cards": [
            {
                "uuid": "ingest-test-root-1",
                "name": "Test Card",
                "subtitle": "Sub",
                "type": "Unit",
                "type2": None,
                "rarity": "Common",
                "set_code": SET_CODE,
                "card_number": "1",
                "variant_type": "Standard",
                "variant_of_uuid": None,
                "aspects": ["Vigilance"],
                "keywords": ["Sentinel"],
                "traits": ["Trooper"],
                "front_image_url": "https://example.com/it1-1-standard.png",
                "back_image_url": None,
                "double_sided": False,
                "unique_flag": False,
                "cost": 3,
                "power": 2,
                "hp": 4,
                "arena": "Ground",
                "front_text": "Front text.",
                "back_text": None,
                "epic_action": None,
                "artist": "Test Artist",
            },
            {
                "uuid": "ingest-test-foil-1",
                "name": "Test Card",
                "subtitle": "Sub",
                "type": "Unit",
                "type2": None,
                "rarity": "Common",
                "set_code": SET_CODE,
                "card_number": "101",
                "variant_type": "Standard Foil",
                "variant_of_uuid": "ingest-test-root-1",
                "aspects": ["Vigilance"],
                "keywords": ["Sentinel"],
                "traits": ["Trooper"],
                "front_image_url": "https://example.com/it1-1-foil.png",
                "back_image_url": None,
                "double_sided": False,
                "unique_flag": False,
                "cost": 3,
                "power": 2,
                "hp": 4,
                "arena": "Ground",
                "front_text": "Front text.",
                "back_text": None,
                "epic_action": None,
                "artist": "Test Artist",
            },
            {
                "uuid": "ingest-test-token-1",
                "name": "Test Token",
                "subtitle": None,
                "type": "Token Unit",
                "type2": None,
                "rarity": "Special",
                "set_code": SET_CODE,
                "card_number": "2",
                "variant_type": "Convention Exclusive",
                "variant_of_uuid": None,
                "aspects": [],
                "keywords": [],
                "traits": [],
                "front_image_url": None,
                "back_image_url": None,
                "double_sided": False,
                "unique_flag": False,
                "cost": None,
                "power": 1,
                "hp": 1,
                "arena": "Ground",
                "front_text": None,
                "back_text": None,
                "epic_action": None,
                "artist": None,
            },
        ],
    }


@pytest.fixture
def cleanup_ingest_test_rows(db):
    yield
    db.rollback()
    db.execute(
        text(
            "DELETE FROM inventory WHERE variant_id IN "
            "(SELECT id FROM card_variants WHERE swuapi_id LIKE 'ingest-test-%')"
        )
    )
    db.execute(
        text(
            "UPDATE base_cards SET standard_variant_id = NULL "
            "WHERE swuapi_id LIKE 'ingest-test-%'"
        )
    )
    for attr_table in ("card_aspects", "card_keywords", "card_traits"):
        db.execute(
            text(
                f"DELETE FROM {attr_table} WHERE base_card_id IN "
                "(SELECT id FROM base_cards WHERE swuapi_id LIKE 'ingest-test-%')"
            )
        )
    db.execute(text("DELETE FROM card_variants WHERE swuapi_id LIKE 'ingest-test-%'"))
    db.execute(text("DELETE FROM base_cards WHERE swuapi_id LIKE 'ingest-test-%'"))
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.commit()


def test_ingestion_upserts_expected_rows(cleanup_ingest_test_rows, db):
    result = run_ingestion(_synthetic_export(), db=db)

    assert len(result.base_cards) == 2  # root + standalone token, foil collapses in
    assert len(result.card_variants) == 3

    base_card_count = db.execute(
        text("SELECT COUNT(*) FROM base_cards WHERE swuapi_id LIKE 'ingest-test-%'")
    ).scalar()
    variant_count = db.execute(
        text("SELECT COUNT(*) FROM card_variants WHERE swuapi_id LIKE 'ingest-test-%'")
    ).scalar()
    assert base_card_count == 2
    assert variant_count == 3

    standard_variant_id = db.execute(
        text(
            "SELECT standard_variant_id FROM base_cards WHERE swuapi_id = 'ingest-test-root-1'"
        )
    ).scalar()
    standard_swuapi_id = db.execute(
        text("SELECT swuapi_id FROM card_variants WHERE id = :id"),
        {"id": standard_variant_id},
    ).scalar()
    assert standard_swuapi_id == "ingest-test-root-1"

    aspect_count = db.execute(
        text(
            "SELECT COUNT(*) FROM card_aspects ca "
            "JOIN base_cards bc ON bc.id = ca.base_card_id "
            "WHERE bc.swuapi_id = 'ingest-test-root-1'"
        )
    ).scalar()
    assert aspect_count == 1


def test_ingestion_is_idempotent_on_rerun(cleanup_ingest_test_rows, db):
    run_ingestion(_synthetic_export(), db=db)
    run_ingestion(_synthetic_export(), db=db)

    base_card_count = db.execute(
        text("SELECT COUNT(*) FROM base_cards WHERE swuapi_id LIKE 'ingest-test-%'")
    ).scalar()
    variant_count = db.execute(
        text("SELECT COUNT(*) FROM card_variants WHERE swuapi_id LIKE 'ingest-test-%'")
    ).scalar()
    set_count = db.execute(
        text("SELECT COUNT(*) FROM sets WHERE code = :code"), {"code": SET_CODE}
    ).scalar()

    assert base_card_count == 2
    assert variant_count == 3
    assert set_count == 1
