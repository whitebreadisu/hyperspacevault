"""BL-54 S1 (§6/§7.4): GET /api/catalog/reference.csv -- public, tenant-less
catalog reference download (ADR-0008 exposure class).

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_catalog_reference_api.py -v
"""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture
def anon_client():
    return TestClient(app)


@pytest.fixture
def reference_fixture_variant_ids(db):
    """BL-54 S1's own fixture rows -- CI's trimmed catalog has no guarantee
    of a particular real card, so the test creates what it needs. Two
    variants of one base card, deliberately with card_number values that
    sort adjacently (9501/9502) to pin the deterministic-order assertion."""
    set_id = db.execute(text("SELECT id FROM sets WHERE code = 'SOR'")).scalar()

    base_card_id = db.execute(
        text(
            "INSERT INTO base_cards "
            "(set_id, base_card_number, name, subtitle, type, rarity, swuapi_id) "
            "VALUES (:set_id, '9501', 'Reference Trooper Gamma', 'The Steadfast', "
            "'Unit', 'Common', 'test-reference-0001') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": set_id},
    ).scalar()

    variant_ids = {}
    for swuapi_id, card_number, variant_type in (
        ("test-reference-v0001", "9501", "Standard"),
        ("test-reference-v0002", "9601", "Standard Foil"),
    ):
        row = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, 'SOR', :card_number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "variant_type": variant_type,
                "card_number": card_number,
                "swuapi_id": swuapi_id,
            },
        ).first()
        variant_ids[swuapi_id] = row.id
    db.commit()

    yield variant_ids


@pytest.fixture
def ordering_fixture_variant_ids(db, reference_fixture_variant_ids):
    """Owner dev-review 2026-07-23: variants spread across the curated set
    groups (base SOR, TS26, Weekly Play SORP, long-tail J24) plus a 5-digit
    SOR card_number, pinning the Vault-matching group order and the numeric
    card-number comparison. Container sets aren't part of CI's minimal
    seed, so this creates them (idempotently) first."""
    for code, name in (
        ("TS26", "2026 Twin Suns"),
        ("SORP", "Spark of Rebellion Weekly Play"),
        ("J24", "2024 Judge Program"),
    ):
        db.execute(
            text(
                "INSERT INTO sets (code, name, is_base_set) "
                "VALUES (:code, :name, false) ON CONFLICT (code) DO NOTHING"
            ),
            {"code": code, "name": name},
        )

    base_card_id = db.execute(
        text("SELECT id FROM base_cards WHERE swuapi_id = 'test-reference-0001'")
    ).scalar()

    variant_ids = {}
    for swuapi_id, source_set_code, card_number in (
        ("test-reference-ord-sor-9602", "SOR", "9602"),
        ("test-reference-ord-sor-10000", "SOR", "10000"),
        ("test-reference-ord-ts26", "TS26", "1"),
        ("test-reference-ord-sorp", "SORP", "1"),
        ("test-reference-ord-j24", "J24", "1"),
    ):
        row = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, 'Standard', :source_set_code, :card_number, "
                ":swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "source_set_code": source_set_code,
                "card_number": card_number,
                "swuapi_id": swuapi_id,
            },
        ).first()
        variant_ids[swuapi_id] = row.id
    db.commit()

    yield variant_ids


class TestReferenceCsvPublicAccess:
    def test_anonymous_returns_200(self, anon_client):
        response = anon_client.get("/api/catalog/reference.csv")
        assert response.status_code == 200

    def test_content_type_and_disposition(self, anon_client):
        response = anon_client.get("/api/catalog/reference.csv")
        assert response.headers["content-type"].startswith("text/csv")
        assert response.headers["cache-control"] == "public, max-age=300, s-maxage=3600"
        from datetime import datetime, timezone

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert (
            response.headers["content-disposition"]
            == f'attachment; filename="hyperspacevault-catalog-reference_{today}.csv"'
        )

    def test_ignores_invalid_token(self, anon_client):
        """§6: fully public -- a garbage Authorization header is ignored,
        not 401'd, same posture as the other tenant-less catalog reads
        (get_catalog_db)."""
        response = anon_client.get(
            "/api/catalog/reference.csv",
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert response.status_code == 200

    def test_header_row(self, anon_client):
        """Owner dev-review 2026-07-23 (REPLACE): the header gained a
        `quantity` column, in the export's position (inventory_io.
        CSV_COLUMNS), so the reference is directly importable once
        quantities are filled in."""
        lines = anon_client.get("/api/catalog/reference.csv").text.splitlines()
        assert (
            lines[0]
            == "swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle"
        )
        # No meta line -- this is a reference table, not an inventory
        # export (§6 vs §3.2); the header alone is import-recognizable.
        assert not lines[0].startswith("#")


class TestReferenceCsvContent:
    def test_one_row_per_variant_deterministic_order(
        self, anon_client, reference_fixture_variant_ids
    ):
        """Owner dev-review 2026-07-23 (REPLACE): rows carry the prefilled
        `quantity` 0 between variant_type and name."""
        lines = anon_client.get("/api/catalog/reference.csv").text.splitlines()
        fixture_lines = [line for line in lines if "test-reference-v0" in line]
        assert fixture_lines == [
            "test-reference-v0001,SOR,9501,Standard,0,Reference Trooper Gamma,The Steadfast",
            "test-reference-v0002,SOR,9601,Standard Foil,0,Reference Trooper Gamma,The Steadfast",
        ]

    def test_vault_matching_set_group_order_and_numeric_card_numbers(
        self, anon_client, ordering_fixture_variant_ids
    ):
        """Owner dev-review 2026-07-23 (CREATE): the file order matches the
        Vault -- base sets first (TS26 last among them), then Weekly Play,
        then the long-tail containers -- with card_number compared
        numerically ("10000" after "9602", which lexicographic order would
        invert)."""
        lines = anon_client.get("/api/catalog/reference.csv").text.splitlines()
        fixture_lines = [line for line in lines if "test-reference-ord" in line]
        assert [line.split(",")[0] for line in fixture_lines] == [
            "test-reference-ord-sor-9602",
            "test-reference-ord-sor-10000",
            "test-reference-ord-ts26",
            "test-reference-ord-sorp",
            "test-reference-ord-j24",
        ]

    def test_authenticated_and_anonymous_responses_are_identical(
        self, anon_client, make_client, reference_fixture_variant_ids
    ):
        """The reference is catalog data, no per-tenant variation possible
        -- pin identity-independence directly, same pattern as the
        base-cards list's public-cache proof."""
        anon_body = anon_client.get("/api/catalog/reference.csv").text
        authed_body = make_client().get("/api/catalog/reference.csv").text
        assert anon_body == authed_body
