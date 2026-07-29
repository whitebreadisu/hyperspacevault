"""BL-54 S1 (§7.1): GET /api/inventory/export?format=json|csv -- auth gates,
tenant scoping, deterministic order, and content shape.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_inventory_export_api.py -v
"""

import os

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture
def export_fixture_variant_ids(db):
    """BL-54 S1's own small fixture catalog -- CI runs against a trimmed
    catalog (conftest.seed_minimal_catalog), not the full bootstrap set, so
    this creates the exact variants the export tests reference rather than
    assuming any particular swuapi-sourced card exists. Two base cards, one
    of them with a Standard/Standard Foil pair (a stand-in for §10 case 2's
    foil-collision distinctness, exercised here as ordering/identity, not
    resolution -- resolution is S2's job)."""
    set_id = db.execute(text("SELECT id FROM sets WHERE code = 'SOR'")).scalar()

    def _upsert_base_card(swuapi_id, number, name, subtitle=None):
        row = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, subtitle, type, rarity, swuapi_id) "
                "VALUES (:set_id, :number, :name, :subtitle, 'Unit', 'Common', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id"
            ),
            {
                "set_id": set_id,
                "number": number,
                "name": name,
                "subtitle": subtitle,
                "swuapi_id": swuapi_id,
            },
        ).first()
        return row.id

    def _upsert_variant(swuapi_id, base_card_id, card_number, variant_type):
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
        return row.id

    bc_a = _upsert_base_card("test-export-0001", "9301", "Export Trooper Alpha")
    bc_b = _upsert_base_card(
        "test-export-0002", "9302", "Export Officer Beta", "The Loyal"
    )

    v_a_standard = _upsert_variant("test-export-v0001", bc_a, "9301", "Standard")
    v_b_standard = _upsert_variant("test-export-v0002", bc_b, "9302", "Standard")
    v_b_foil = _upsert_variant("test-export-v0003", bc_b, "9402", "Standard Foil")
    db.commit()

    yield {
        "a_standard": v_a_standard,
        "b_standard": v_b_standard,
        "b_foil": v_b_foil,
    }


@pytest.fixture
def with_export_inventory(db, make_client, export_fixture_variant_ids):
    """A dedicated, freshly-provisioned tenant with exactly the three export
    fixture variants at known quantities -- isolates these tests from
    whatever conftest's shared tenant #1 fixture already has seeded (BL-54's
    own fixture rows, not tenant #1's), and from each other."""
    uid = "test-bl54-export-user"
    email = "bl54-export@example.com"
    client = make_client(uid, email, True)
    # Auto-provisions the tenant on first authenticated call.
    client.get("/api/inventory/quantities")

    ids = export_fixture_variant_ids
    tenant_id = db.execute(
        text("SELECT tenant_id FROM users WHERE firebase_uid = :uid"), {"uid": uid}
    ).scalar()
    for variant_id, quantity in (
        (ids["a_standard"], 2),
        (ids["b_standard"], 1),
        (ids["b_foil"], 3),
    ):
        db.execute(
            text(
                "INSERT INTO inventory (tenant_id, variant_id, quantity) "
                "VALUES (:tenant_id, :variant_id, :quantity) "
                "ON CONFLICT (tenant_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity"
            ),
            {"tenant_id": tenant_id, "variant_id": variant_id, "quantity": quantity},
        )
    db.commit()

    yield client, ids

    from .conftest import delete_provisioned_identity

    delete_provisioned_identity(db, uid)


class TestExportAuthGates:
    """§10 case 8: unverified -> 403 email_not_verified, anonymous -> 401."""

    def test_anonymous_returns_401(self):
        from fastapi.testclient import TestClient

        from app.main import app

        response = TestClient(app).get("/api/inventory/export")
        assert response.status_code == 401

    def test_unverified_returns_403(self, make_client, db):
        from .conftest import delete_provisioned_identity

        uid = "test-bl54-export-unverified"
        unverified = make_client(uid, "bl54-export-unverified@example.com", False)
        try:
            response = unverified.get("/api/inventory/export")
            assert response.status_code == 403
            assert response.json()["detail"] == "email_not_verified"
        finally:
            delete_provisioned_identity(db, uid)

    def test_verified_returns_200(self, client):
        response = client.get("/api/inventory/export")
        assert response.status_code == 200

    def test_invalid_format_query_param_returns_422(self, client):
        response = client.get("/api/inventory/export?format=xlsx")
        assert response.status_code == 422


class TestExportJson:
    def test_content_shape_and_order(self, with_export_inventory):
        client, ids = with_export_inventory
        response = client.get("/api/inventory/export?format=json")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert response.headers["cache-control"] == "private, no-store"
        assert (
            response.headers["content-disposition"]
            == 'attachment; filename="hyperspacevault-inventory_' + _today() + '.json"'
        )

        payload = response.json()
        assert payload["format_version"] == "swu-inv/1"
        assert "exported_at" in payload
        assert "source" in payload

        cards = payload["cards"]
        variant_ids_by_swuapi_id = {
            "test-export-v0001": ids["a_standard"],
            "test-export-v0002": ids["b_standard"],
            "test-export-v0003": ids["b_foil"],
        }
        fixture_cards = [
            c for c in cards if c["swuapi_uuid"] in variant_ids_by_swuapi_id
        ]
        assert len(fixture_cards) == 3

        # Deterministic Vault-matching order (services/set_order.py,
        # owner dev-review 2026-07-23): curated set groups, then numeric
        # card_number, then variant_type. All three fixture rows share
        # set_code SOR; 9301 sorts before 9302 numerically, and within
        # "9302" Standard sorts before "Standard Foil". Cross-set group
        # order + the numeric-vs-lexicographic distinction are pinned by
        # test_set_order.py and test_catalog_reference_api.py's ordering
        # test (same shared key).
        assert [c["swuapi_uuid"] for c in fixture_cards] == [
            "test-export-v0001",
            "test-export-v0002",
            "test-export-v0003",
        ]

        b_standard = fixture_cards[1]
        assert b_standard["set_code"] == "SOR"
        assert b_standard["card_number"] == "9302"
        assert b_standard["variant_type"] == "Standard"
        assert b_standard["quantity"] == 1
        assert b_standard["name"] == "Export Officer Beta"
        assert b_standard["subtitle"] == "The Loyal"
        assert b_standard["_derived"] == {
            "finish": "Standard",
            "channel": "Retail",
            "stamped": False,
        }

    def test_zero_quantity_rows_excluded(self, db, with_export_inventory):
        client, ids = with_export_inventory
        tenant_id = db.execute(
            text(
                "SELECT tenant_id FROM users WHERE firebase_uid = 'test-bl54-export-user'"
            )
        ).scalar()
        db.execute(
            text(
                "UPDATE inventory SET quantity = 0 WHERE tenant_id = :tenant_id "
                "AND variant_id = :variant_id"
            ),
            {"tenant_id": tenant_id, "variant_id": ids["a_standard"]},
        )
        db.commit()

        payload = client.get("/api/inventory/export?format=json").json()
        swuapi_ids = {c["swuapi_uuid"] for c in payload["cards"]}
        assert "test-export-v0001" not in swuapi_ids
        assert "test-export-v0002" in swuapi_ids

        # Restore for any later test relying on the fixture's base state.
        db.execute(
            text(
                "UPDATE inventory SET quantity = 2 WHERE tenant_id = :tenant_id "
                "AND variant_id = :variant_id"
            ),
            {"tenant_id": tenant_id, "variant_id": ids["a_standard"]},
        )
        db.commit()


class TestExportCsv:
    def test_content_shape_and_order(self, with_export_inventory):
        client, ids = with_export_inventory
        response = client.get("/api/inventory/export?format=csv")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert (
            response.headers["content-disposition"]
            == 'attachment; filename="hyperspacevault-inventory_' + _today() + '.csv"'
        )

        lines = response.text.splitlines()
        assert lines[0] == "# swu-inv-export v1"
        assert (
            lines[1]
            == "swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle"
        )
        fixture_lines = [line for line in lines[2:] if "test-export-v" in line]
        assert fixture_lines == [
            "test-export-v0001,SOR,9301,Standard,2,Export Trooper Alpha,",
            "test-export-v0002,SOR,9302,Standard,1,Export Officer Beta,The Loyal",
            "test-export-v0003,SOR,9402,Standard Foil,3,Export Officer Beta,The Loyal",
        ]


class TestExportTenantIsolation:
    def test_second_tenant_sees_none_of_first_tenants_rows(
        self, make_client, db, with_export_inventory
    ):
        _, ids = with_export_inventory
        uid = "test-bl54-export-other-tenant"
        email = "bl54-export-other@example.com"
        other = make_client(uid, email, True)
        try:
            payload = other.get("/api/inventory/export?format=json").json()
            swuapi_ids = {c["swuapi_uuid"] for c in payload["cards"]}
            assert "test-export-v0001" not in swuapi_ids
            assert "test-export-v0002" not in swuapi_ids
            assert "test-export-v0003" not in swuapi_ids
        finally:
            from .conftest import delete_provisioned_identity

            delete_provisioned_identity(db, uid)


def _today() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%d")
