"""BL-205 (App Spec §19.1): share management + anonymous token-scoped
viewer reads -- the platform's first unauthenticated tenant-data surface.

Covers the security-bearing behaviors by name: token unguessability is
assumed (secrets.token_urlsafe), everything around it is proven --
invalid/revoked indistinguishability (404 both), rotation killing the old
link, cross-tenant isolation under a share-scoped session, cardinality
(one active share per scope target, 409 + the partial unique index),
purge/account-deletion compatibility, and the per-IP rate limit's 429.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_shares_api.py -v
"""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import rate_limit
from app.main import app
from app.tests.conftest import delete_provisioned_identity

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture(autouse=True)
def _clean_tenant1_shares(db):
    """Tenant 1 is shared by every test module in the process; leave no
    share rows behind (admin connection bypasses RLS)."""
    yield
    db.rollback()
    db.execute(
        text(
            "DELETE FROM shares WHERE tenant_id = "
            "(SELECT tenant_id FROM users WHERE firebase_uid = 'test-tenant-1-user')"
        )
    )
    db.commit()


@pytest.fixture
def anon():
    """A plain TestClient sending no Authorization header. The shared
    endpoints never resolve identity, so this exercises them exactly as a
    real anonymous viewer would REGARDLESS of any identity overrides other
    fixtures installed (same posture as test_catalog_anonymous_reads'
    anon_client -- deliberately no dependency_overrides.clear(), which
    would break co-use with the authed `client` fixture)."""
    return TestClient(app)


def _create_share(client, name="My Vault"):
    resp = client.post("/api/shares", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Management (authed)
# ---------------------------------------------------------------------------


def test_create_returns_token_and_cardinality_409(client):
    share = _create_share(client)
    assert share["name"] == "My Vault"
    assert share["scope"] == "inventory"
    assert len(share["token"]) >= 40
    assert share["revoked"] is False
    # one active share per scope target (owner ruling, §19.4)
    dup = client.post("/api/shares", json={"name": "Second"})
    assert dup.status_code == 409


def test_revoke_then_recreate_is_allowed(client):
    share = _create_share(client)
    assert client.delete(f"/api/shares/{share['id']}").status_code == 204
    again = _create_share(client, name="Fresh")
    assert again["token"] != share["token"]


def test_list_shows_active_only(client):
    share = _create_share(client)
    listed = client.get("/api/shares").json()
    assert [s["id"] for s in listed] == [share["id"]]
    client.delete(f"/api/shares/{share['id']}")
    assert client.get("/api/shares").json() == []


def test_rename_and_name_validation(client):
    share = _create_share(client)
    renamed = client.patch(f"/api/shares/{share['id']}", json={"name": "Bobs big vault"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Bobs big vault"
    assert renamed.json()["token"] == share["token"]  # rename never rotates
    too_long = client.patch(f"/api/shares/{share['id']}", json={"name": "x" * 31})
    assert too_long.status_code == 422
    control = client.patch(f"/api/shares/{share['id']}", json={"name": "a\x00b"})
    assert control.status_code == 422
    blank = client.patch(f"/api/shares/{share['id']}", json={"name": "   "})
    assert blank.status_code == 422


def test_management_requires_auth():
    """No `client`/`anon` fixture here on purpose: the management surface
    must 401 for a caller with no identity, so this test needs the real
    get_current_identity path -- overrides are cleared and the clear is
    exactly the point (no authed fixture coexists with it)."""
    app.dependency_overrides.clear()
    bare = TestClient(app)
    assert bare.post("/api/shares", json={"name": "x"}).status_code == 401
    assert bare.get("/api/shares").status_code == 401


# ---------------------------------------------------------------------------
# Viewer reads (anonymous, token-scoped)
# ---------------------------------------------------------------------------


def test_viewer_resolves_and_reads_owner_data(client, db, anon):
    share = _create_share(client, name="Trade stock")

    resolved = anon.get(f"/api/shared/{share['token']}")
    assert resolved.status_code == 200
    assert resolved.json() == {"name": "Trade stock", "scope": "inventory"}
    assert resolved.headers["cache-control"] == "private, max-age=30"

    # Give tenant 1 a real quantity through the owner surface, then read
    # it back through the share -- identical rows, no share-specific path.
    variant_id = db.execute(
        text("SELECT id FROM card_variants ORDER BY id LIMIT 1")
    ).scalar()
    assert client.post(f"/api/inventory/{variant_id}/increment").status_code == 200
    try:
        shared_q = anon.get(f"/api/shared/{share['token']}/quantities")
        assert shared_q.status_code == 200
        by_variant = {r["variant_id"]: r["quantity"] for r in shared_q.json()}
        assert by_variant.get(variant_id, 0) >= 1

        owner_limits = client.get("/api/settings/limits").json()
        shared_l = anon.get(f"/api/shared/{share['token']}/limits")
        assert shared_l.status_code == 200
        assert shared_l.json() == owner_limits
    finally:
        client.post(f"/api/inventory/{variant_id}/decrement")


def test_invalid_and_revoked_tokens_are_indistinguishable(client, anon):
    share = _create_share(client)
    assert anon.get("/api/shared/not-a-real-token").status_code == 404
    assert anon.get("/api/shared/not-a-real-token/quantities").status_code == 404
    client.delete(f"/api/shares/{share['id']}")
    revoked = anon.get(f"/api/shared/{share['token']}")
    assert revoked.status_code == 404
    assert revoked.json() == anon.get("/api/shared/not-a-real-token").json()


def test_rotation_kills_the_old_link(client, anon):
    share = _create_share(client)
    rotated = client.post(f"/api/shares/{share['id']}/rotate").json()
    assert rotated["token"] != share["token"]
    assert anon.get(f"/api/shared/{share['token']}").status_code == 404
    assert anon.get(f"/api/shared/{rotated['token']}").status_code == 200


def test_share_scoped_session_is_isolated_to_owner_tenant(
    client, db, anon, make_client
):
    """A second tenant's share must show that tenant's (empty) inventory,
    never tenant 1's rows -- the RLS-rails claim of §19.1, proven.

    Ordering matters: make_client swaps the app-global identity override,
    so every tenant-1 action happens BEFORE the second client exists (the
    first draft incremented "as tenant 1" after building `other` and the
    row landed on the other tenant -- the assertion failure looked exactly
    like the leak this test hunts)."""
    variant_id = db.execute(
        text("SELECT id FROM card_variants ORDER BY id LIMIT 1")
    ).scalar()
    assert client.post(f"/api/inventory/{variant_id}/increment").status_code == 200
    try:
        other = make_client("bl205-other-uid", "bl205-other@example.com")
        try:
            other_share = _create_share(other, name="Other vault")
            rows = anon.get(f"/api/shared/{other_share['token']}/quantities").json()
            assert rows == []  # fresh tenant: zero rows, tenant 1 leaked nothing
        finally:
            delete_provisioned_identity(db, "bl205-other-uid")
    finally:
        make_client().post(f"/api/inventory/{variant_id}/decrement")


def test_account_deletion_with_active_share(db, make_client):
    """purge_tenant must clear shares before users/tenants (same
    no-cascade FK shape as inventory) -- account deletion with a live
    share must complete, and the share's token must die with it."""
    from app.auth import require_recent_auth

    doomed = make_client("bl205-doomed-uid", "bl205-doomed@example.com")
    app.dependency_overrides[require_recent_auth] = lambda: None
    try:
        share = _create_share(doomed, name="Doomed vault")
        resp = doomed.delete("/api/account")
        assert resp.status_code == 204, resp.text
        assert TestClient(app).get(f"/api/shared/{share['token']}").status_code == 404
    finally:
        delete_provisioned_identity(db, "bl205-doomed-uid")


def test_shared_reads_are_rate_limited_per_ip(client, anon, monkeypatch):
    share = _create_share(client)
    monkeypatch.setattr(
        rate_limit, "check_tenant_rate_limit", lambda *a, **k: 42
    )
    limited = anon.get(f"/api/shared/{share['token']}")
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "42"
