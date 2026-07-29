"""Integration tests for GET /api/inventory, GET /api/inventory/quantities
(BL-101), POST /api/inventory/{id}/increment, and POST
/api/inventory/{id}/decrement endpoints.

Ported to base_cards/card_variants (BL-33 step 1): "card_id" is now
"variant_id" in increment/decrement responses, and the fixture catalog
(conftest's seed_minimal_catalog) replaces the old bulk CSV-seeded one.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_inventory_api.py -v
"""

import os

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL — run inside the backend container",
)


# BL-102 disposition: TestListInventory RETIRED with GET /api/inventory
# (runtime-dead since BL-56; superseded by BL-101's /quantities). Its
# intents live on: response shape + seeded-quantity correctness in
# TestListQuantities below; the "quantity 0 renders correctly" concern is
# now a client-side merge property (missing variant_id -> 0), covered by
# the frontend CardsPage tests.


class TestListQuantities:
    """GET /api/inventory/quantities -- BL-101, the per-tenant half of the
    catalog/quantity split. Carries the intent of the retired/replaced
    list-endpoint quantity tests (test_base_cards_api.py,
    test_catalog_anonymous_reads.py): seeded-quantity correctness, RLS
    tenant isolation, and auth semantics now live here, against the
    endpoint that actually serves the data."""

    def test_returns_sparse_variant_quantity_rows(self, client, db):
        """REPLACES the list endpoint's quantity assertion: conftest seeds
        tenant #1 with Standard Foil (test-v0008) at quantity 1 -- that row
        must appear here, as a lean {variant_id, quantity} record."""
        foil_id = db.execute(
            text("SELECT id FROM card_variants WHERE swuapi_id = 'test-v0008'")
        ).scalar()
        rows = client.get("/api/inventory/quantities").json()
        assert all(set(r.keys()) == {"variant_id", "quantity"} for r in rows)
        by_variant = {r["variant_id"]: r["quantity"] for r in rows}
        assert by_variant[foil_id] == 1

    def test_requires_auth(self):
        """Unlike the now-public catalog list, quantities are per-tenant --
        an anonymous request must 401, not degrade to an empty list."""
        from fastapi.testclient import TestClient

        from app.main import app

        response = TestClient(app).get("/api/inventory/quantities")
        assert response.status_code == 401

    def test_quantities_are_tenant_scoped(self, make_client, db):
        """REPLACES test_base_cards_api.py::TestListBaseCardsTenantIsolation
        (BL-101): a second tenant sees none of tenant #1's rows here, and
        tenant #1 still sees its own seeded Standard Foil row."""
        tenant_id = db.execute(
            text(
                "INSERT INTO tenants (name) VALUES ('Quantities Isolation Tenant') RETURNING id"
            )
        ).scalar()
        uid = "test-quantities-isolation-user"
        email = "quantities-isolation@example.com"
        db.execute(
            text(
                "INSERT INTO users (firebase_uid, tenant_id, email) "
                "VALUES (:uid, :tenant_id, :email)"
            ),
            {"uid": uid, "tenant_id": tenant_id, "email": email},
        )
        db.commit()
        try:
            other_rows = make_client(uid, email).get("/api/inventory/quantities").json()
            assert other_rows == []

            foil_id = db.execute(
                text("SELECT id FROM card_variants WHERE swuapi_id = 'test-v0008'")
            ).scalar()
            tenant_one_rows = make_client().get("/api/inventory/quantities").json()
            by_variant = {r["variant_id"]: r["quantity"] for r in tenant_one_rows}
            assert by_variant[foil_id] == 1
        finally:
            db.rollback()
            db.execute(
                text("DELETE FROM inventory WHERE tenant_id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            db.execute(
                text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid}
            )
            db.execute(
                text("DELETE FROM tenants WHERE id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            db.commit()


class TestIncrementCard:
    SINGLETON_TYPES = {"Leader", "Base"}

    # BL-102: both finders PORTED from GET /api/inventory (retired) to
    # conftest.merged_inventory (catalog + quantities, client-side merge).

    def _find_solo_zero_card(self, client, *, exclude_types: set | None = None):
        """Return a non-Leader/Base variant card that is the sole variant for its
        base card and has quantity 0, so the base-card total starts at 0."""
        from collections import Counter

        from .conftest import merged_inventory

        records = merged_inventory(client)
        exclude = exclude_types or self.SINGLETON_TYPES
        base_counts = Counter(r["base_card_id"] for r in records)
        return next(
            (
                r
                for r in records
                if r["quantity"] == 0
                and r["type"] not in exclude
                and base_counts[r["base_card_id"]] == 1
            ),
            None,
        )

    def _find_zero_singleton(self, client):
        """Return a Leader or Base variant card with quantity 0."""
        from .conftest import merged_inventory

        records = merged_inventory(client)
        return next(
            (
                r
                for r in records
                if r["quantity"] == 0 and r["type"] in self.SINGLETON_TYPES
            ),
            None,
        )

    def test_increment_happy_path_returns_updated_quantity(self, client):
        solo = self._find_solo_zero_card(client)
        assert solo is not None, "fixture should include an isolated zero-qty card"

        variant_id = solo["id"]
        response = client.post(f"/api/inventory/{variant_id}/increment")
        assert response.status_code == 200
        body = response.json()
        assert body["variant_id"] == variant_id
        assert body["quantity"] == 1
        assert body["blocked"] is False

        # Restore
        client.post(f"/api/inventory/{variant_id}/decrement")

    def test_increment_to_playset_returns_playset_complete(self, client):
        solo = self._find_solo_zero_card(client)
        assert solo is not None, "fixture should include an isolated zero-qty card"

        variant_id = solo["id"]
        client.post(f"/api/inventory/{variant_id}/increment")
        client.post(f"/api/inventory/{variant_id}/increment")
        response = client.post(f"/api/inventory/{variant_id}/increment")
        assert response.status_code == 200
        body = response.json()
        assert body["playset_complete"] is True
        assert body["quantity"] == 3

        # Restore
        for _ in range(3):
            client.post(f"/api/inventory/{variant_id}/decrement")

    def test_increment_beyond_playset_returns_blocked(self, client):
        solo = self._find_solo_zero_card(client)
        assert solo is not None, "fixture should include an isolated zero-qty card"

        variant_id = solo["id"]
        for _ in range(3):
            client.post(f"/api/inventory/{variant_id}/increment")

        response = client.post(f"/api/inventory/{variant_id}/increment")
        assert response.status_code == 200
        body = response.json()
        assert body["blocked"] is True
        assert body["reason"] == "trade_sell"
        assert body["quantity"] == 3

        # Restore
        for _ in range(3):
            client.post(f"/api/inventory/{variant_id}/decrement")

    def test_singleton_increment_returns_playset_complete_at_1(self, client):
        singleton = self._find_zero_singleton(client)
        assert singleton is not None, "fixture should include a zero-qty Leader/Base"

        variant_id = singleton["id"]
        response = client.post(f"/api/inventory/{variant_id}/increment")
        assert response.status_code == 200
        body = response.json()
        assert body["quantity"] == 1
        assert body["playset_complete"] is True
        assert body["blocked"] is False

        # Restore
        client.post(f"/api/inventory/{variant_id}/decrement")

    def test_singleton_increment_blocked_at_1(self, client):
        singleton = self._find_zero_singleton(client)
        assert singleton is not None, "fixture should include a zero-qty Leader/Base"

        variant_id = singleton["id"]
        client.post(f"/api/inventory/{variant_id}/increment")

        response = client.post(f"/api/inventory/{variant_id}/increment")
        assert response.status_code == 200
        body = response.json()
        assert body["blocked"] is True
        assert body["reason"] == "trade_sell"
        assert body["quantity"] == 1

        # Restore
        client.post(f"/api/inventory/{variant_id}/decrement")

    def test_increment_unknown_card_returns_404(self, client):
        response = client.post("/api/inventory/99999999/increment")
        assert response.status_code == 404


class TestDecrementCard:
    def test_decrement_happy_path_reduces_quantity(self, client):
        from .conftest import merged_inventory

        records = merged_inventory(client)
        zero_card = next((r for r in records if r["quantity"] == 0), None)
        assert zero_card is not None, "fixture should include a zero-qty card"

        variant_id = zero_card["id"]
        client.post(f"/api/inventory/{variant_id}/increment")

        response = client.post(f"/api/inventory/{variant_id}/decrement")
        assert response.status_code == 200
        body = response.json()
        assert body["variant_id"] == variant_id
        assert body["quantity"] == 0

    def test_decrement_at_zero_stays_at_zero(self, client):
        from .conftest import merged_inventory

        records = merged_inventory(client)
        zero_card = next((r for r in records if r["quantity"] == 0), None)
        assert zero_card is not None, "fixture should include a zero-qty card"

        variant_id = zero_card["id"]
        response = client.post(f"/api/inventory/{variant_id}/decrement")
        assert response.status_code == 200
        body = response.json()
        assert body["quantity"] == 0

    def test_decrement_unknown_card_returns_404(self, client):
        response = client.post("/api/inventory/99999999/decrement")
        assert response.status_code == 404
