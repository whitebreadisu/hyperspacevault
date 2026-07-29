"""
BL-87: permanent account deletion -- DELETE /api/account.

Integration tests -- require DATABASE_URL and APP_DATABASE_URL (standard
inside the backend container). Deliberately never touches tenant #1 (the
shared fixture tenant every other test module assumes stays intact) --
each test provisions its own throwaway tenant, mirroring
test_tenant_isolation.py's tenant_two/tenant_three fixtures, because this
module's whole point is to actually delete tenant rows via the endpoint
under test.
"""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture(autouse=True)
def _bypass_recent_auth():
    """BL-88: every purge/grant test in this module authenticates through
    make_client's get_current_identity override, never a real Authorization
    header -- but require_recent_auth (wired onto DELETE /api/account
    alongside get_db) independently re-decodes the raw header itself, so
    without this it would 401 with "Missing or invalid Authorization
    header" before any of those tests' route bodies ever ran. Bypasses the
    gate here the same way make_client already bypasses get_current_
    identity's real Firebase decode, so this module keeps testing purge
    behavior, not the recency gate. The TestRequireRecentAuth* classes
    below pop this override for the handful of tests that exercise the
    gate itself."""
    from app.auth import require_recent_auth
    from app.main import app

    app.dependency_overrides[require_recent_auth] = lambda: None
    yield
    app.dependency_overrides.pop(require_recent_auth, None)


def _make_tenant(db, name: str, uid: str, email: str) -> int:
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"), {"name": name}
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {"uid": uid, "tenant_id": tenant_id, "email": email},
    )
    db.commit()
    return tenant_id


def _seed_inventory(db, tenant_id: int) -> None:
    """One real inventory row for the throwaway tenant, reusing a variant
    from the shared fixture catalog (inventory is tenant-scoped; the
    catalog underneath it is not)."""
    variant_id = db.execute(
        text(
            """
            SELECT cv.id FROM card_variants cv
            JOIN base_cards bc ON bc.id = cv.base_card_id
            WHERE bc.type NOT IN ('Leader', 'Base')
            ORDER BY cv.id
            LIMIT 1
            """
        )
    ).scalar()
    db.execute(
        text(
            "INSERT INTO inventory (tenant_id, variant_id, quantity) VALUES (:tid, :vid, 2)"
        ),
        {"tid": tenant_id, "vid": variant_id},
    )
    db.commit()


def _cleanup_tenant(db, tenant_id: int, uid: str) -> None:
    """Idempotent teardown -- safe even when the test itself already
    deleted everything via DELETE /api/account (each statement here then
    matches zero rows)."""
    db.rollback()
    db.execute(text("DELETE FROM inventory WHERE tenant_id = :tid"), {"tid": tenant_id})
    db.execute(
        text("DELETE FROM tenant_card_limits WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    db.execute(
        text("DELETE FROM tenant_settings WHERE tenant_id = :tid"), {"tid": tenant_id}
    )
    # BL-126: consented feedback rows carry this tenant's id (see
    # test_purge_deletes_consented_feedback_but_preserves_anonymous below).
    db.execute(text("DELETE FROM feedback WHERE tenant_id = :tid"), {"tid": tenant_id})
    db.execute(text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid})
    db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tenant_id})
    db.commit()


@pytest.fixture
def tenant_a(db):
    uid, email = "test-bl87-tenant-a", "bl87-a@example.com"
    tenant_id = _make_tenant(db, "BL-87 Tenant A", uid, email)
    _seed_inventory(db, tenant_id)
    try:
        yield {"tenant_id": tenant_id, "uid": uid, "email": email}
    finally:
        _cleanup_tenant(db, tenant_id, uid)


@pytest.fixture
def tenant_b(db):
    uid, email = "test-bl87-tenant-b", "bl87-b@example.com"
    tenant_id = _make_tenant(db, "BL-87 Tenant B", uid, email)
    _seed_inventory(db, tenant_id)
    try:
        yield {"tenant_id": tenant_id, "uid": uid, "email": email}
    finally:
        _cleanup_tenant(db, tenant_id, uid)


# ── purge behavior ──────────────────────────────────────────────────────


def test_purge_deletes_inventory_user_and_tenant_rows(make_client, db, tenant_a):
    client = make_client(tenant_a["uid"], tenant_a["email"])
    response = client.delete("/api/account")
    assert response.status_code == 204
    assert response.content == b""

    db.rollback()
    inv_count = db.execute(
        text("SELECT COUNT(*) FROM inventory WHERE tenant_id = :tid"),
        {"tid": tenant_a["tenant_id"]},
    ).scalar()
    user_count = db.execute(
        text("SELECT COUNT(*) FROM users WHERE firebase_uid = :uid"),
        {"uid": tenant_a["uid"]},
    ).scalar()
    tenant_count = db.execute(
        text("SELECT COUNT(*) FROM tenants WHERE id = :tid"),
        {"tid": tenant_a["tenant_id"]},
    ).scalar()

    assert inv_count == 0
    assert user_count == 0
    assert tenant_count == 0


def test_cross_tenant_isolation_after_deletion(make_client, db, tenant_a, tenant_b):
    """The critical test: deleting tenant A's account leaves tenant B's
    inventory, user, and tenant rows completely untouched -- proven both
    at the row-count level and through tenant B's own live API call."""
    client_a = make_client(tenant_a["uid"], tenant_a["email"])
    response = client_a.delete("/api/account")
    assert response.status_code == 204

    db.rollback()
    b_inv = db.execute(
        text("SELECT COUNT(*) FROM inventory WHERE tenant_id = :tid"),
        {"tid": tenant_b["tenant_id"]},
    ).scalar()
    b_user = db.execute(
        text("SELECT COUNT(*) FROM users WHERE firebase_uid = :uid"),
        {"uid": tenant_b["uid"]},
    ).scalar()
    b_tenant = db.execute(
        text("SELECT COUNT(*) FROM tenants WHERE id = :tid"),
        {"tid": tenant_b["tenant_id"]},
    ).scalar()

    assert b_inv == 1
    assert b_user == 1
    assert b_tenant == 1

    client_b = make_client(tenant_b["uid"], tenant_b["email"])
    quantities = client_b.get("/api/inventory/quantities").json()
    assert any(r["quantity"] == 2 for r in quantities)


def test_delete_account_purges_limits_and_settings(make_client, db, tenant_a):
    """BL-24/BL-35 regression (found live in dev, 2026-07-13): a tenant
    with tenant_card_limits and/or tenant_settings rows could not delete
    their account -- purge_tenant didn't know about the new tables, so
    their un-cascaded FKs blocked the tenants DELETE and the endpoint
    500'd. This test configures both (an override row and a cap_mode row)
    through the real settings endpoint, then proves DELETE /api/account
    succeeds and leaves zero rows in every tenant-owned table."""
    client = make_client(tenant_a["uid"], tenant_a["email"])

    put = client.put(
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
    assert put.status_code == 200

    response = client.delete("/api/account")
    assert response.status_code == 204

    db.rollback()
    for table in ("inventory", "tenant_card_limits", "tenant_settings", "users"):
        column = "firebase_uid" if table == "users" else "tenant_id"
        value = tenant_a["uid"] if table == "users" else tenant_a["tenant_id"]
        count = db.execute(
            text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :v"),  # noqa: S608
            {"v": value},
        ).scalar()
        assert count == 0, f"{table} still has rows after account deletion"
    tenant_count = db.execute(
        text("SELECT COUNT(*) FROM tenants WHERE id = :tid"),
        {"tid": tenant_a["tenant_id"]},
    ).scalar()
    assert tenant_count == 0


def test_purge_deletes_consented_feedback_but_preserves_anonymous(
    make_client, db, tenant_a
):
    """BL-126 (#244 purge_tenant rule, extending the same regression this
    module already covers for tenant_card_limits/tenant_settings): a
    feedback row consented by this tenant's signed-in submitter carries
    tenant_id and must be purged with the rest of the account; a
    genuinely anonymous feedback row (contact declined, tenant_id NULL --
    owner decision #3) must survive ANY tenant's purge, since it was never
    linked to one in the first place. Seeds one of each and confirms their
    fates diverge across the same DELETE /api/account call."""
    client = make_client(tenant_a["uid"], tenant_a["email"])

    consented = client.post(
        "/api/feedback",
        json={
            "message": "BL-126 purge test: consented row",
            "contact_ok": True,
            "contact_email": tenant_a["email"],
        },
    )
    assert consented.status_code == 201

    from app.main import app as fastapi_app

    anon = TestClient(fastapi_app).post(
        "/api/feedback",
        json={"message": "BL-126 purge test: anonymous row", "contact_ok": False},
    )
    assert anon.status_code == 201

    db.rollback()
    consented_id = db.execute(
        text(
            "SELECT id FROM feedback WHERE message = 'BL-126 purge test: consented row'"
        )
    ).scalar()
    anon_id = db.execute(
        text(
            "SELECT id FROM feedback WHERE message = 'BL-126 purge test: anonymous row'"
        )
    ).scalar()
    assert consented_id is not None
    assert anon_id is not None

    try:
        response = client.delete("/api/account")
        assert response.status_code == 204

        db.rollback()
        consented_count = db.execute(
            text("SELECT COUNT(*) FROM feedback WHERE id = :id"), {"id": consented_id}
        ).scalar()
        anon_count = db.execute(
            text("SELECT COUNT(*) FROM feedback WHERE id = :id"), {"id": anon_id}
        ).scalar()
        assert consented_count == 0, (
            "consented feedback row must be purged with its tenant"
        )
        assert anon_count == 1, "anonymous feedback row must survive the purge"
    finally:
        # The anonymous row has no tenant linkage for _cleanup_tenant to
        # find -- remove it directly so it doesn't leak into other tests.
        db.rollback()
        db.execute(text("DELETE FROM feedback WHERE id = :id"), {"id": anon_id})
        db.commit()


def test_second_delete_is_idempotent(make_client, db, tenant_a):
    """Same firebase_uid calling DELETE /api/account a second time: its
    users row is already gone from the first call, so get_db
    auto-provisions a brand-new (empty) tenant before the route body ever
    runs -- exactly as it would for any first-ever request from this uid.
    The purge then deletes that brand-new tenant's zero inventory rows.
    Still a clean 204, never a 500 or a partial failure -- and nothing is
    left behind for this uid afterward."""
    client = make_client(tenant_a["uid"], tenant_a["email"])

    first = client.delete("/api/account")
    assert first.status_code == 204

    second = client.delete("/api/account")
    assert second.status_code == 204
    assert second.content == b""

    db.rollback()
    leftover_users = db.execute(
        text("SELECT COUNT(*) FROM users WHERE firebase_uid = :uid"),
        {"uid": tenant_a["uid"]},
    ).scalar()
    assert leftover_users == 0


def test_delete_without_auth_returns_401():
    """No dependency override -- exercises the real get_current_identity
    dependency with no Authorization header at all, matching the pattern
    test_logging.py and test_catalog_anonymous_reads.py already use for
    this same assertion on other routes."""
    from app.main import app

    response = TestClient(app).delete("/api/account")
    assert response.status_code == 401


# ── BL-88: server-side recent-auth enforcement ──────────────────────────


class TestRequireRecentAuthUnit:
    """No DB, no FastAPI wiring -- exercises require_recent_auth directly,
    mirroring test_email_verification.py's
    TestVerifyFirebaseTokenEmailVerifiedClaim/TestRequireVerifiedEmailUnit
    pattern: monkeypatch firebase_admin.auth.verify_id_token so a decoded
    token (and its auth_time claim) can be constructed by hand, without a
    real Firebase Admin app or a real ID token."""

    def _patch_decoded_token(self, monkeypatch, decoded: dict):
        import app.auth as auth_module

        monkeypatch.setattr(auth_module, "_get_firebase_app", lambda: object())
        monkeypatch.setattr(
            auth_module.auth,
            "verify_id_token",
            lambda token, app=None: decoded,
        )

    def test_fresh_auth_time_passes_silently(self, monkeypatch):
        import time

        from app.auth import require_recent_auth

        self._patch_decoded_token(monkeypatch, {"uid": "u1", "auth_time": time.time()})
        assert require_recent_auth("Bearer faketoken") is None

    def test_auth_time_just_inside_window_passes(self, monkeypatch):
        import time

        from app.auth import require_recent_auth

        self._patch_decoded_token(
            monkeypatch, {"uid": "u1", "auth_time": time.time() - 299}
        )
        assert require_recent_auth("Bearer faketoken") is None

    def test_stale_auth_time_raises_401_with_code(self, monkeypatch):
        import time

        from fastapi import HTTPException

        from app.auth import require_recent_auth

        self._patch_decoded_token(
            monkeypatch, {"uid": "u1", "auth_time": time.time() - 301}
        )
        with pytest.raises(HTTPException) as exc_info:
            require_recent_auth("Bearer faketoken")
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == {"code": "recent-auth-required"}

    def test_missing_auth_time_claim_treated_as_stale(self, monkeypatch):
        """The BL-88 default-safe behavior mirrors BL-16's missing
        email_verified handling: a decoded token with no auth_time claim at
        all must never be treated as fresh."""
        from fastapi import HTTPException

        from app.auth import require_recent_auth

        self._patch_decoded_token(monkeypatch, {"uid": "u1"})
        with pytest.raises(HTTPException) as exc_info:
            require_recent_auth("Bearer faketoken")
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == {"code": "recent-auth-required"}

    def test_missing_authorization_header_raises_401(self):
        from fastapi import HTTPException

        from app.auth import require_recent_auth

        with pytest.raises(HTTPException) as exc_info:
            require_recent_auth(None)
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Missing or invalid Authorization header"


class TestRequireRecentAuthIntegration:
    """DELETE /api/account, end to end -- pops this module's autouse
    require_recent_auth bypass for each test here so the route's real
    dependency wiring runs, then monkeypatches firebase_admin.auth.
    verify_id_token (same technique as the unit tests above) so a real
    'Authorization: Bearer ...' header round-trips through it."""

    def _patch_decoded_token(self, monkeypatch, decoded: dict):
        import app.auth as auth_module

        monkeypatch.setattr(auth_module, "_get_firebase_app", lambda: object())
        monkeypatch.setattr(
            auth_module.auth,
            "verify_id_token",
            lambda token, app=None: decoded,
        )

    def _unbypass(self):
        from app.auth import require_recent_auth
        from app.main import app

        app.dependency_overrides.pop(require_recent_auth, None)

    def test_fresh_auth_time_allows_deletion(
        self, monkeypatch, make_client, db, tenant_a
    ):
        import time

        self._patch_decoded_token(
            monkeypatch,
            {
                "uid": tenant_a["uid"],
                "email": tenant_a["email"],
                "email_verified": True,
                "auth_time": time.time(),
            },
        )
        self._unbypass()
        client = make_client(tenant_a["uid"], tenant_a["email"])

        response = client.delete(
            "/api/account", headers={"Authorization": "Bearer faketoken"}
        )
        assert response.status_code == 204

        db.rollback()
        user_count = db.execute(
            text("SELECT COUNT(*) FROM users WHERE firebase_uid = :uid"),
            {"uid": tenant_a["uid"]},
        ).scalar()
        assert user_count == 0

    def test_stale_auth_time_returns_401_with_code(
        self, monkeypatch, make_client, tenant_a
    ):
        import time

        self._patch_decoded_token(
            monkeypatch,
            {
                "uid": tenant_a["uid"],
                "email": tenant_a["email"],
                "email_verified": True,
                "auth_time": time.time() - 600,
            },
        )
        self._unbypass()
        client = make_client(tenant_a["uid"], tenant_a["email"])

        response = client.delete(
            "/api/account", headers={"Authorization": "Bearer faketoken"}
        )
        assert response.status_code == 401
        assert response.json()["detail"] == {"code": "recent-auth-required"}

    def test_missing_auth_time_claim_returns_401_with_code(
        self, monkeypatch, make_client, tenant_a
    ):
        self._patch_decoded_token(
            monkeypatch,
            {
                "uid": tenant_a["uid"],
                "email": tenant_a["email"],
                "email_verified": True,
            },
        )
        self._unbypass()
        client = make_client(tenant_a["uid"], tenant_a["email"])

        response = client.delete(
            "/api/account", headers={"Authorization": "Bearer faketoken"}
        )
        assert response.status_code == 401
        assert response.json()["detail"] == {"code": "recent-auth-required"}


# ── grants (migration 0024) ─────────────────────────────────────────────


@pytest.fixture
def app_db():
    """Raw swu_app connection -- the role migration 0024's grants target."""
    engine = create_engine(os.environ["APP_DATABASE_URL"])
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_swu_app_has_delete_grant_on_purge_tables(db):
    rows = db.execute(
        text(
            "SELECT table_name FROM information_schema.role_table_grants "
            "WHERE grantee = 'swu_app' AND privilege_type = 'DELETE' "
            "AND table_name IN ('users', 'tenants', 'inventory', "
            "'tenant_card_limits', 'tenant_settings')"
        )
    ).all()
    assert {r[0] for r in rows} == {
        "users",
        "tenants",
        "inventory",
        "tenant_card_limits",
        "tenant_settings",
    }


def test_swu_app_can_delete_from_users(app_db, db):
    """Confirms migration 0024's GRANT DELETE ON users actually works --
    deletes a disposable row through swu_app (never committed on that
    connection, so this test has zero effect on the real table; cleanup
    below removes it via the admin connection either way)."""
    uid, tenant_name = "test-bl87-grant-check-user", "BL-87 Grant Check User"
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"),
        {"name": tenant_name},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tid, 'grant-check@example.com')"
        ),
        {"uid": uid, "tid": tenant_id},
    )
    db.commit()

    try:
        app_db.execute(
            text("SELECT set_config('app.current_firebase_uid', :uid, false)"),
            {"uid": uid},
        )
        result = app_db.execute(
            text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid}
        )
        assert result.rowcount == 1
    finally:
        app_db.rollback()
        db.rollback()
        db.execute(text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tenant_id})
        db.commit()


def test_swu_app_can_delete_from_tenants(app_db, db):
    """Confirms migration 0024's GRANT DELETE ON tenants works, and that
    the explicit `WHERE id = :tenant_id` filter is sufficient on its own
    -- tenants carries no RLS policy at all (by design; see the
    migration's docstring)."""
    tenant_id = db.execute(
        text(
            "INSERT INTO tenants (name) VALUES ('BL-87 Grant Check Tenant') RETURNING id"
        )
    ).scalar()
    db.commit()

    try:
        result = app_db.execute(
            text("DELETE FROM tenants WHERE id = :tid"), {"tid": tenant_id}
        )
        assert result.rowcount == 1
    finally:
        app_db.rollback()
        db.rollback()
        db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tenant_id})
        db.commit()
