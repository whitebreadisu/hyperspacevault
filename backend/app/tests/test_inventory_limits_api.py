"""Integration tests for BL-24: per-tenant, per-variant inventory limit
overrides.

Covers the new enforcement in services/inventory.py's increment_card
(per-variant independence, override resolution, the singleton override
path, unlimited buckets, the technical ceiling, and completion
decoupling) plus the new GET/PUT /api/settings/limits endpoints.

BL-35 extends this file with the hard/soft cap_mode enforcement toggle --
TestCapModeSettings (GET/PUT round-trip, validation) and TestSoftCapMode
(the over-limit-commits-and-flags behavior, "no limit"/ceiling
interactions). Both reuse the bl24_tenant fixture and fixture catalog
below; see their class docstrings for the specific scenarios.

Every test here runs under a dedicated, throwaway tenant (see the
bl24_tenant fixture) rather than the shared tenant #1 every other test
file assumes a specific seeded state for -- BL-24 tests mutate
tenant_card_limits overrides and drive inventory quantities well past
what tenant #1's fixture expects, so isolating onto disposable tenants
means this file can never corrupt another file's assumptions (and vice
versa), without needing any changes to conftest.py's shared fixture.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_inventory_limits_api.py -v
"""

import os
import uuid

import pytest
from sqlalchemy import text

from app.ingestion.swuapi_classify import ALL_LIMIT_BUCKETS
from app.services.inventory import COMPLETION_PLAYSET_SIZE, QUANTITY_CEILING
from app.services.limits import CAP_MODE_HARD, CAP_MODE_SOFT, DEFAULT_LIMITS

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL — run inside the backend container",
)


@pytest.fixture(scope="module", autouse=True)
def bl24_catalog(db):
    """A standalone base_card + variant with variant_type "Hyperspace" --
    conftest's seed_minimal_catalog fixture has no Hyperspace variant (its
    Foil/PQ-tier variants exercise other buckets), and BL-24's override
    tests need a real bucket=Hyperspace variant. Idempotent via
    ON CONFLICT DO NOTHING/DO UPDATE, scoped to this module's own
    swuapi_id prefix ("bl24-") so it can't collide with or affect any
    other test file's fixture data."""
    sor_id = db.execute(text("SELECT id FROM sets WHERE code = 'SOR'")).scalar()
    base_card_id = db.execute(
        text(
            "INSERT INTO base_cards "
            "(set_id, base_card_number, name, type, rarity, swuapi_id) "
            "VALUES (:set_id, '9301', 'Test Hyperspace Trooper', 'Unit', "
            "'Common', 'bl24-0001') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": sor_id},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO card_variants "
            "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
            "VALUES (:base_card_id, 'Hyperspace', 'SOR', '9301', 'bl24-v0001') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET "
            "card_number = EXCLUDED.card_number "
        ),
        {"base_card_id": base_card_id},
    )
    db.commit()


def _variant_id(db, swuapi_id: str) -> int:
    return db.execute(
        text("SELECT id FROM card_variants WHERE swuapi_id = :id"),
        {"id": swuapi_id},
    ).scalar()


def _set_quantity(db, tenant_id: int, variant_id: int, quantity: int) -> None:
    """Directly set (tenant_id, variant_id)'s inventory row -- used for the
    ceiling test so it doesn't need 999 real API calls."""
    db.execute(
        text(
            "INSERT INTO inventory (tenant_id, variant_id, quantity) "
            "VALUES (:tenant_id, :variant_id, :quantity) "
            "ON CONFLICT (tenant_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity"
        ),
        {"tenant_id": tenant_id, "variant_id": variant_id, "quantity": quantity},
    )
    db.commit()


def _create_tenant_rows(db) -> tuple[int, str, str]:
    """Just the tenant+user rows -- no client. Split out from
    _provision_tenant so a test needing TWO independent identities can
    create both tenants' rows up front, then call make_client(uid, email)
    immediately before each request (see test_overrides_are_tenant_scoped):
    make_client's override lives on the shared `app.dependency_overrides`
    dict, so calling it twice and *holding onto* both returned clients
    would have the second call silently override the first client's
    identity too -- only the most recently constructed client's identity
    is ever actually active, regardless of which TestClient instance
    issues the request."""
    suffix = uuid.uuid4().hex[:12]
    uid = f"test-bl24-{suffix}"
    email = f"bl24-{suffix}@example.com"
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"),
        {"name": f"BL-24 Test Tenant {suffix}"},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {"uid": uid, "tenant_id": tenant_id, "email": email},
    )
    db.commit()
    return tenant_id, uid, email


def _provision_tenant(db, make_client):
    tenant_id, uid, email = _create_tenant_rows(db)
    return make_client(uid, email), tenant_id, uid


def _teardown_tenant(db, tenant_id: int, uid: str) -> None:
    """FK-safe cleanup (inventory/tenant_card_limits/tenant_settings ->
    users -> tenants) -- mirrors conftest.delete_provisioned_identity, plus
    the BL-24/BL-35 tables."""
    db.rollback()
    db.execute(text("DELETE FROM inventory WHERE tenant_id = :t"), {"t": tenant_id})
    db.execute(
        text("DELETE FROM tenant_card_limits WHERE tenant_id = :t"),
        {"t": tenant_id},
    )
    db.execute(
        text("DELETE FROM tenant_settings WHERE tenant_id = :t"),
        {"t": tenant_id},
    )
    db.execute(text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid})
    db.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
    db.commit()


@pytest.fixture
def bl24_tenant(db, make_client):
    """A throwaway, fully isolated (tenant, authenticated client) pair for
    a single test. See module docstring for why every BL-24 test uses its
    own tenant instead of the shared tenant #1."""
    client, tenant_id, uid = _provision_tenant(db, make_client)
    try:
        yield client, tenant_id
    finally:
        _teardown_tenant(db, tenant_id, uid)


class TestPerVariantIndependence:
    """BL-24's core behavior change: each variant's keep-limit is checked
    against its OWN quantity, not a base-card-wide shared pool."""

    def test_two_variants_of_same_base_card_each_reach_three(self, db, bl24_tenant):
        """test-v0004 (Standard) and test-v0005 (Foil) are both variants of
        "Test Trooper Beta" (base_card test-0004). Under pre-BL-24 shared-
        pool logic, the base card's combined total was capped at 3 -- the
        very first increment on the second variant would have been
        blocked (the first variant already holds the whole pool). BL-24's
        per-variant independence means each variant reaches 3 on its own,
        for a combined total of 6."""
        client, _ = bl24_tenant
        standard_id = _variant_id(db, "test-v0004")
        foil_id = _variant_id(db, "test-v0005")

        for _ in range(3):
            resp = client.post(f"/api/inventory/{standard_id}/increment")
            assert resp.status_code == 200
            assert resp.json()["blocked"] is False

        # Old shared-pool code would block here: base-card total is
        # already 3. Per-variant independence allows it.
        for _ in range(3):
            resp = client.post(f"/api/inventory/{foil_id}/increment")
            assert resp.status_code == 200
            assert resp.json()["blocked"] is False
        assert resp.json()["quantity"] == 3

        # Each variant is independently at its own cap now.
        blocked_standard = client.post(f"/api/inventory/{standard_id}/increment")
        assert blocked_standard.json()["blocked"] is True
        assert blocked_standard.json()["reason"] == "trade_sell"
        blocked_foil = client.post(f"/api/inventory/{foil_id}/increment")
        assert blocked_foil.json()["blocked"] is True
        assert blocked_foil.json()["reason"] == "trade_sell"


class TestOverrideResolution:
    def test_raised_standard_override_allows_past_default(self, db, bl24_tenant):
        """standard/Hyperspace overridden to 5: the 4th and 5th increments
        (past the code default of 3) are allowed; the 6th is blocked."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "bl24-v0001")

        put_resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": 5,
                    }
                ]
            },
        )
        assert put_resp.status_code == 200

        responses = [
            client.post(f"/api/inventory/{variant_id}/increment") for _ in range(5)
        ]
        assert all(r.status_code == 200 for r in responses)
        assert all(r.json()["blocked"] is False for r in responses)
        assert responses[3].json()["quantity"] == 4  # 4th increment
        assert responses[4].json()["quantity"] == 5  # 5th increment

        sixth = client.post(f"/api/inventory/{variant_id}/increment")
        assert sixth.json()["blocked"] is True
        assert sixth.json()["reason"] == "trade_sell"
        assert sixth.json()["quantity"] == 5


class TestSingletonOverride:
    def test_singleton_override_allows_second_copy(self, db, bl24_tenant):
        """test-v0001 is a Leader (Standard finish -> bucket "Standard",
        category singleton, code default 1). Overriding singleton/Standard
        to 2 allows a 2nd copy; playset_complete only fires on the first
        (unchanged "first copy acquired" semantics), not the second."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0001")

        put_resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "singleton",
                        "limit_bucket": "Standard",
                        "max_quantity": 2,
                    }
                ]
            },
        )
        assert put_resp.status_code == 200

        first = client.post(f"/api/inventory/{variant_id}/increment")
        assert first.json()["blocked"] is False
        assert first.json()["quantity"] == 1
        assert first.json()["playset_complete"] is True

        second = client.post(f"/api/inventory/{variant_id}/increment")
        assert second.json()["blocked"] is False
        assert second.json()["quantity"] == 2
        assert second.json()["playset_complete"] is False

        third = client.post(f"/api/inventory/{variant_id}/increment")
        assert third.json()["blocked"] is True
        assert third.json()["reason"] == "trade_sell"
        assert third.json()["quantity"] == 2


class TestUnlimitedOverride:
    def test_null_override_never_blocks(self, db, bl24_tenant):
        """standard/Retail overridden to null (explicit "no limit"): many
        increments past the code default of 3 all succeed, blocked is
        never true, and reason is never set."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0005")  # Foil -> bucket Retail

        put_resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Retail",
                        "max_quantity": None,
                    }
                ]
            },
        )
        assert put_resp.status_code == 200

        for expected_qty in range(1, 11):
            resp = client.post(f"/api/inventory/{variant_id}/increment")
            assert resp.status_code == 200
            body = resp.json()
            assert body["blocked"] is False
            assert body["reason"] is None
            assert body["quantity"] == expected_qty


class TestCeiling:
    def test_ceiling_blocks_even_when_bucket_is_unlimited(self, db, bl24_tenant):
        """The technical ceiling (999) always wins, even against an
        explicitly unlimited bucket override -- set up directly via the DB
        rather than 999 real increments."""
        client, tenant_id = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")  # Trooper Alpha, Standard

        put_resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Standard",
                        "max_quantity": None,
                    }
                ]
            },
        )
        assert put_resp.status_code == 200

        _set_quantity(db, tenant_id, variant_id, QUANTITY_CEILING)

        resp = client.post(f"/api/inventory/{variant_id}/increment")
        assert resp.status_code == 200
        body = resp.json()
        assert body["blocked"] is True
        assert body["reason"] == "ceiling"
        assert body["quantity"] == QUANTITY_CEILING


class TestCompletionDecoupling:
    def test_playset_complete_fires_once_at_three_and_not_again(self, db, bl24_tenant):
        """With a raised limit (standard/Standard = 5), playset_complete
        still fires exactly at 3 total copies (test-v0003 is a solo
        variant, so its own quantity is the base card's total) and does
        not re-fire, or regress, past it."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")

        put_resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Standard",
                        "max_quantity": 5,
                    }
                ]
            },
        )
        assert put_resp.status_code == 200

        expected_completion = {1: False, 2: False, 3: True, 4: False, 5: False}
        for qty, should_complete in expected_completion.items():
            resp = client.post(f"/api/inventory/{variant_id}/increment")
            body = resp.json()
            assert body["blocked"] is False
            assert body["quantity"] == qty
            assert body["playset_complete"] is should_complete, (
                f"quantity {qty}: expected playset_complete={should_complete}, "
                f"got {body['playset_complete']}"
            )
        assert COMPLETION_PLAYSET_SIZE == 3  # sanity: the threshold itself


class TestSettingsEndpoints:
    def test_get_returns_full_matrix_with_defaults(self, bl24_tenant):
        client, _ = bl24_tenant
        resp = client.get("/api/settings/limits")
        assert resp.status_code == 200
        body = resp.json()

        expected_cell_count = 2 * len(ALL_LIMIT_BUCKETS)
        assert len(body["limits"]) == expected_cell_count

        for cell in body["limits"]:
            assert cell["is_default"] is True
            assert cell["max_quantity"] == DEFAULT_LIMITS[cell["type_category"]]
            assert cell["limit_bucket"] in ALL_LIMIT_BUCKETS

    def test_put_round_trip(self, bl24_tenant):
        client, _ = bl24_tenant
        put_resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": 5,
                    },
                    {
                        "type_category": "singleton",
                        "limit_bucket": "Standard",
                        "max_quantity": 2,
                    },
                ]
            },
        )
        assert put_resp.status_code == 200
        put_by_key = {
            (c["type_category"], c["limit_bucket"]): c
            for c in put_resp.json()["limits"]
        }
        assert put_by_key[("standard", "Hyperspace")]["max_quantity"] == 5
        assert put_by_key[("standard", "Hyperspace")]["is_default"] is False
        assert put_by_key[("singleton", "Standard")]["max_quantity"] == 2
        assert put_by_key[("singleton", "Standard")]["is_default"] is False
        # Untouched cells still show the code default.
        assert put_by_key[("standard", "Retail")]["max_quantity"] == 3
        assert put_by_key[("standard", "Retail")]["is_default"] is True

        get_resp = client.get("/api/settings/limits")
        get_by_key = {
            (c["type_category"], c["limit_bucket"]): c
            for c in get_resp.json()["limits"]
        }
        assert get_by_key[("standard", "Hyperspace")]["max_quantity"] == 5
        assert get_by_key[("singleton", "Standard")]["max_quantity"] == 2

    def test_put_replaces_rather_than_patches(self, bl24_tenant):
        """A second PUT with a different override set drops the first
        PUT's overrides entirely -- full replacement, not a merge."""
        client, _ = bl24_tenant
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": 5,
                    }
                ]
            },
        )
        second = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Retail",
                        "max_quantity": 7,
                    }
                ]
            },
        )
        by_key = {
            (c["type_category"], c["limit_bucket"]): c for c in second.json()["limits"]
        }
        assert by_key[("standard", "Retail")]["max_quantity"] == 7
        # The Hyperspace override from the first PUT is gone.
        assert by_key[("standard", "Hyperspace")]["is_default"] is True
        assert by_key[("standard", "Hyperspace")]["max_quantity"] == 3

    def test_put_rejects_out_of_range_max_quantity(self, bl24_tenant):
        client, _ = bl24_tenant
        resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Retail",
                        "max_quantity": 1000,
                    }
                ]
            },
        )
        assert resp.status_code == 422

    def test_put_rejects_unknown_bucket(self, bl24_tenant):
        client, _ = bl24_tenant
        resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Bogus Bucket",
                        "max_quantity": 5,
                    }
                ]
            },
        )
        assert resp.status_code == 422

    def test_put_rejects_unknown_category(self, bl24_tenant):
        client, _ = bl24_tenant
        resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "bogus",
                        "limit_bucket": "Retail",
                        "max_quantity": 5,
                    }
                ]
            },
        )
        assert resp.status_code == 422

    def test_get_requires_auth(self):
        from fastapi.testclient import TestClient

        from app.main import app

        response = TestClient(app).get("/api/settings/limits")
        assert response.status_code == 401

    def test_overrides_are_tenant_scoped(self, db, make_client):
        """A second, independent tenant's override must never leak into
        another tenant's effective matrix (mirrors
        test_inventory_api.py::TestListQuantities.test_quantities_are_tenant_scoped).
        Both tenants' rows are created up front, but make_client(...) is
        called immediately before each request -- see _create_tenant_rows'
        docstring for why holding two pre-built clients would be unsafe."""
        tenant_a, uid_a, email_a = _create_tenant_rows(db)
        tenant_b, uid_b, email_b = _create_tenant_rows(db)
        try:
            make_client(uid_a, email_a).put(
                "/api/settings/limits",
                json={
                    "limits": [
                        {
                            "type_category": "standard",
                            "limit_bucket": "Hyperspace",
                            "max_quantity": 9,
                        }
                    ]
                },
            )
            b_matrix = {
                (c["type_category"], c["limit_bucket"]): c
                for c in make_client(uid_b, email_b)
                .get("/api/settings/limits")
                .json()["limits"]
            }
            assert b_matrix[("standard", "Hyperspace")]["is_default"] is True
            assert b_matrix[("standard", "Hyperspace")]["max_quantity"] == 3
        finally:
            _teardown_tenant(db, tenant_a, uid_a)
            _teardown_tenant(db, tenant_b, uid_b)


class TestCapModeSettings:
    """BL-35: GET/PUT /api/settings/limits' new cap_mode field -- default,
    round-trip, absent-leaves-unchanged, and validation. Increment-side
    behavior (what cap_mode actually changes about enforcement) lives in
    TestSoftCapMode below."""

    def test_get_defaults_to_hard(self, bl24_tenant):
        """A brand new tenant has no tenant_settings row at all (rows are
        created lazily) -- GET must still resolve cap_mode to "hard"."""
        client, _ = bl24_tenant
        resp = client.get("/api/settings/limits")
        assert resp.status_code == 200
        assert resp.json()["cap_mode"] == CAP_MODE_HARD

    def test_put_cap_mode_round_trip(self, bl24_tenant):
        client, _ = bl24_tenant
        put_resp = client.put(
            "/api/settings/limits", json={"limits": [], "cap_mode": "soft"}
        )
        assert put_resp.status_code == 200
        assert put_resp.json()["cap_mode"] == CAP_MODE_SOFT

        get_resp = client.get("/api/settings/limits")
        assert get_resp.json()["cap_mode"] == CAP_MODE_SOFT

    def test_put_absent_cap_mode_leaves_unchanged(self, bl24_tenant):
        """A PUT that omits cap_mode entirely (only touching the limits
        matrix) must not reset it back to the default -- absent means
        "leave whatever it currently is"."""
        client, _ = bl24_tenant
        client.put("/api/settings/limits", json={"limits": [], "cap_mode": "soft"})

        second = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Retail",
                        "max_quantity": 7,
                    }
                ]
                # cap_mode deliberately omitted.
            },
        )
        assert second.status_code == 200
        assert second.json()["cap_mode"] == CAP_MODE_SOFT

    def test_put_rejects_invalid_cap_mode(self, bl24_tenant):
        client, _ = bl24_tenant
        resp = client.put(
            "/api/settings/limits", json={"limits": [], "cap_mode": "bogus"}
        )
        assert resp.status_code == 422

    def test_put_can_switch_back_to_hard(self, bl24_tenant):
        """Not a one-way door -- a tenant can flip soft back to hard."""
        client, _ = bl24_tenant
        client.put("/api/settings/limits", json={"limits": [], "cap_mode": "soft"})
        back = client.put(
            "/api/settings/limits", json={"limits": [], "cap_mode": "hard"}
        )
        assert back.json()["cap_mode"] == CAP_MODE_HARD


class TestSoftCapMode:
    """BL-35: the increment-side effect of cap_mode="soft" -- an at/over-
    limit increment commits (blocked False) and flags over_limit True,
    instead of hard mode's block. The 999 ceiling and "no limit" buckets
    are unaffected by cap_mode (see each test's docstring)."""

    def test_below_limit_increment_is_unflagged_in_soft_mode(self, db, bl24_tenant):
        """test-v0006 (Officer Alpha, Standard finish -> bucket "Standard",
        category standard, code default 3): the first three increments stay
        strictly below the limit (quantities 1, 2, 3 against a limit of 3
        only reaches it on the 3rd) -- over_limit must be False throughout,
        same as hard mode, since cap_mode only changes behavior AT/OVER the
        limit."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0006")

        client.put("/api/settings/limits", json={"limits": [], "cap_mode": "soft"})

        for expected_qty in (1, 2, 3):
            resp = client.post(f"/api/inventory/{variant_id}/increment")
            assert resp.status_code == 200
            body = resp.json()
            assert body["blocked"] is False
            assert body["over_limit"] is False
            assert body["quantity"] == expected_qty

    def test_over_limit_increment_commits_and_flags(self, db, bl24_tenant):
        """Continuing past the limit (the 4th increment, quantity already
        at 3 == the effective limit) in soft mode: NOT blocked, quantity
        actually increments to 4, and over_limit is True. Hard mode would
        block this exact increment with reason "trade_sell" (see
        TestPerVariantIndependence for that unchanged behavior)."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0006")

        client.put("/api/settings/limits", json={"limits": [], "cap_mode": "soft"})
        for _ in range(3):
            client.post(f"/api/inventory/{variant_id}/increment")

        fourth = client.post(f"/api/inventory/{variant_id}/increment")
        assert fourth.status_code == 200
        body = fourth.json()
        assert body["blocked"] is False
        assert body["reason"] is None
        assert body["over_limit"] is True
        assert body["quantity"] == 4

        # A user can raise then lower a limit, so quantities can sit well
        # past limit+1 -- over_limit must still be True far beyond it, not
        # just at the boundary.
        fifth = client.post(f"/api/inventory/{variant_id}/increment")
        assert fifth.json()["blocked"] is False
        assert fifth.json()["over_limit"] is True
        assert fifth.json()["quantity"] == 5

    def test_no_limit_bucket_never_flags_in_soft_mode(self, db, bl24_tenant):
        """standard/Retail overridden to null ("no limit") plus soft mode:
        many increments past the code default of 3 all succeed, and
        over_limit is never True -- an unlimited bucket has no boundary to
        be "over"."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0005")  # Foil -> bucket Retail

        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Retail",
                        "max_quantity": None,
                    }
                ],
                "cap_mode": "soft",
            },
        )

        for expected_qty in range(1, 8):
            resp = client.post(f"/api/inventory/{variant_id}/increment")
            body = resp.json()
            assert body["blocked"] is False
            assert body["over_limit"] is False
            assert body["quantity"] == expected_qty

    def test_ceiling_still_blocks_in_soft_mode(self, db, bl24_tenant):
        """The 999 technical ceiling is unconditional -- soft mode does not
        exempt it, even against an explicitly unlimited bucket override.
        Mirrors TestCeiling's hard-mode version of this same scenario."""
        client, tenant_id = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")  # Trooper Alpha, Standard

        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Standard",
                        "max_quantity": None,
                    }
                ],
                "cap_mode": "soft",
            },
        )

        _set_quantity(db, tenant_id, variant_id, QUANTITY_CEILING)

        resp = client.post(f"/api/inventory/{variant_id}/increment")
        assert resp.status_code == 200
        body = resp.json()
        assert body["blocked"] is True
        assert body["reason"] == "ceiling"
        assert body["over_limit"] is False
        assert body["quantity"] == QUANTITY_CEILING

    def test_hard_mode_default_still_blocks_at_limit(self, db, bl24_tenant):
        """Sanity check that the default (no PUT at all, cap_mode
        unfetched/absent) is still hard: the 4th increment on a default-
        limit-3 bucket blocks, exactly as it did before BL-35."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0006")

        for _ in range(3):
            resp = client.post(f"/api/inventory/{variant_id}/increment")
            assert resp.json()["blocked"] is False

        fourth = client.post(f"/api/inventory/{variant_id}/increment")
        body = fourth.json()
        assert body["blocked"] is True
        assert body["reason"] == "trade_sell"
        assert body["over_limit"] is False
        assert body["quantity"] == 3


class TestAdjustDelta:
    """BL-219 (issue #127): POST /api/inventory/{id}/adjust -- the stepper's
    debounced-batch endpoint. Reuses bl24_tenant's isolated tenant/catalog so
    these scenarios can freely drive cap_mode and limit overrides without
    disturbing test_inventory_api.py's shared-tenant assumptions, same
    posture as the rest of this file. increment_card/decrement_card
    themselves are untouched -- see test_inventory_api.py, still green."""

    def test_hard_mode_partial_apply(self, db, bl24_tenant):
        """standard/Standard default limit 3: starting at 1, requesting +5
        only has room for 2 -- applied=2, quantity lands at the limit (3),
        not blocked (something committed), reason still names the cause."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        client.post(f"/api/inventory/{variant_id}/increment")  # -> quantity 1

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 5})
        assert resp.status_code == 200
        body = resp.json()
        assert body["requested"] == 5
        assert body["applied"] == 2
        assert body["quantity"] == 3
        assert body["blocked"] is False
        assert body["reason"] == "trade_sell"
        assert body["over_limit"] is False

    def test_hard_mode_zero_apply_at_cap(self, db, bl24_tenant):
        """Already sitting at the effective limit (3): a +N adjust applies
        nothing, mirroring increment_card's existing at-limit block."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        for _ in range(3):
            client.post(f"/api/inventory/{variant_id}/increment")

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 4})
        assert resp.status_code == 200
        body = resp.json()
        assert body["applied"] == 0
        assert body["quantity"] == 3
        assert body["blocked"] is True
        assert body["reason"] == "trade_sell"
        assert body["over_limit"] is False
        assert body["playset_complete"] is False

    def test_soft_mode_full_apply_and_over_limit_flag(self, db, bl24_tenant):
        """Soft mode never clamps to the effective limit -- a +5 from
        quantity 3 (== the limit) applies in full and flags over_limit."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0006")
        client.put("/api/settings/limits", json={"limits": [], "cap_mode": "soft"})
        for _ in range(3):
            client.post(f"/api/inventory/{variant_id}/increment")

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 5})
        assert resp.status_code == 200
        body = resp.json()
        assert body["requested"] == 5
        assert body["applied"] == 5
        assert body["quantity"] == 8
        assert body["blocked"] is False
        assert body["reason"] is None
        assert body["over_limit"] is True

    def test_lowered_limit_stranding_hard_mode_blocks(self, db, bl24_tenant):
        """Standard/Hyperspace raised to 5, quantity built up to 5, then the
        override is lowered back to 3 -- hard mode: the strand is a full
        block (applied=0), same as any other at/over-limit increment."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "bl24-v0001")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": 5,
                    }
                ]
            },
        )
        for _ in range(5):
            client.post(f"/api/inventory/{variant_id}/increment")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": 3,
                    }
                ]
            },
        )

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 1})
        body = resp.json()
        assert body["applied"] == 0
        assert body["quantity"] == 5
        assert body["blocked"] is True
        assert body["reason"] == "trade_sell"

    def test_lowered_limit_stranding_soft_mode_applies_and_flags(self, db, bl24_tenant):
        """Same strand, but soft mode: the adjust still applies in full and
        stays flagged over_limit far past the boundary, not just at it."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "bl24-v0001")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": 5,
                    }
                ],
                "cap_mode": "soft",
            },
        )
        for _ in range(5):
            client.post(f"/api/inventory/{variant_id}/increment")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": 3,
                    }
                ],
                "cap_mode": "soft",
            },
        )

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 2})
        body = resp.json()
        assert body["applied"] == 2
        assert body["quantity"] == 7
        assert body["blocked"] is False
        assert body["over_limit"] is True

    def test_ceiling_clamp_partial_apply(self, db, bl24_tenant):
        """The 999 ceiling always wins, even against an explicit "no limit"
        override -- a request that would cross it applies only up to 999,
        not blocked (something committed), reason names the ceiling."""
        client, tenant_id = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Standard",
                        "max_quantity": None,
                    }
                ]
            },
        )
        _set_quantity(db, tenant_id, variant_id, QUANTITY_CEILING - 2)

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 10})
        body = resp.json()
        assert body["applied"] == 2
        assert body["quantity"] == QUANTITY_CEILING
        assert body["blocked"] is False
        assert body["reason"] == "ceiling"

    def test_ceiling_full_block(self, db, bl24_tenant):
        """Already AT the ceiling -- fully blocked, mirrors TestCeiling's
        single-increment version exactly."""
        client, tenant_id = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Standard",
                        "max_quantity": None,
                    }
                ]
            },
        )
        _set_quantity(db, tenant_id, variant_id, QUANTITY_CEILING)

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 3})
        body = resp.json()
        assert body["applied"] == 0
        assert body["quantity"] == QUANTITY_CEILING
        assert body["blocked"] is True
        assert body["reason"] == "ceiling"

    def test_floor_clamp_on_negative_delta(self, db, bl24_tenant):
        """A negative delta always applies down to the floor (0), never
        blocks -- requesting -5 from quantity 2 lands at 0, applied=-2."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        client.post(f"/api/inventory/{variant_id}/increment")
        client.post(f"/api/inventory/{variant_id}/increment")

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": -5})
        body = resp.json()
        assert body["requested"] == -5
        assert body["applied"] == -2
        assert body["quantity"] == 0
        assert body["blocked"] is False
        assert body["reason"] is None

    def test_no_limit_bucket_only_floor_and_ceiling_apply(self, db, bl24_tenant):
        """standard/Retail overridden to null: a large positive delta
        applies in full, never blocks, never flags over_limit -- there is
        no boundary to be over."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0005")  # Foil -> bucket Retail
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Retail",
                        "max_quantity": None,
                    }
                ]
            },
        )

        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 20})
        body = resp.json()
        assert body["applied"] == 20
        assert body["quantity"] == 20
        assert body["blocked"] is False
        assert body["reason"] is None
        assert body["over_limit"] is False

    def test_delta_zero_rejected_422(self, db, bl24_tenant):
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 0})
        assert resp.status_code == 422

    def test_delta_out_of_range_rejected_422(self, db, bl24_tenant):
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        resp = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 1000})
        assert resp.status_code == 422
        resp2 = client.post(
            f"/api/inventory/{variant_id}/adjust", json={"delta": -1000}
        )
        assert resp2.status_code == 422

    def test_playset_complete_crossing_at_three(self, db, bl24_tenant):
        """+1 from quantity 2 (a solo variant, so its own quantity is the
        base card's total) crosses to 3 and reports playset_complete;
        neither the step before nor after does. Limit raised to 5 first so
        the "past 3" step isn't itself blocked by the default hard cap of
        3 -- this test is about the completion threshold, not the cap."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0003")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Standard",
                        "max_quantity": 5,
                    }
                ]
            },
        )
        client.post(f"/api/inventory/{variant_id}/increment")
        client.post(f"/api/inventory/{variant_id}/increment")

        at_two = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": -1})
        assert at_two.json()["quantity"] == 1
        assert at_two.json()["playset_complete"] is False

        crossing = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 2})
        assert crossing.json()["quantity"] == 3
        assert crossing.json()["playset_complete"] is True

        past = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 1})
        assert past.json()["quantity"] == 4
        assert past.json()["playset_complete"] is False

    def test_singleton_playset_complete_on_first_copy_only(self, db, bl24_tenant):
        """test-v0001 is a Leader (singleton, default cap 1) -- an adjust
        from 0 reports playset_complete regardless of the delta's size (a
        raised override lets it land above 1 in one call); a later adjust
        that doesn't start from 0 never does."""
        client, _ = bl24_tenant
        variant_id = _variant_id(db, "test-v0001")
        client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "singleton",
                        "limit_bucket": "Standard",
                        "max_quantity": 3,
                    }
                ]
            },
        )

        first = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 2})
        assert first.json()["quantity"] == 2
        assert first.json()["applied"] == 2
        assert first.json()["playset_complete"] is True

        second = client.post(f"/api/inventory/{variant_id}/adjust", json={"delta": 1})
        assert second.json()["quantity"] == 3
        assert second.json()["playset_complete"] is False

    def test_unknown_variant_returns_404(self, bl24_tenant):
        client, _ = bl24_tenant
        resp = client.post("/api/inventory/99999999/adjust", json={"delta": 1})
        assert resp.status_code == 404

    def test_requires_verified_email(self, db):
        """Same gate as increment/decrement (require_verified_email) --
        smoke-checked here via a plain unauthenticated client, mirroring
        TestSettingsEndpoints.test_get_requires_auth's shape."""
        from fastapi.testclient import TestClient

        from app.main import app

        variant_id = _variant_id(db, "test-v0003")
        response = TestClient(app).post(
            f"/api/inventory/{variant_id}/adjust", json={"delta": 1}
        )
        assert response.status_code == 401
