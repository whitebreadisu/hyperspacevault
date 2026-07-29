"""
P7 Stage 3: row-level security on users and tenants.

test_row_level_security.py covers inventory's tenant_isolation policy
(migration 0018). This file covers the users.user_self_access policy and
the tenants grants from migration 0021 -- the other half of P5's RLS
surface, exercised here for the first time.

Integration tests -- require DATABASE_URL and APP_DATABASE_URL (standard
inside the backend container).
"""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import sessionmaker

from .conftest import DEFAULT_TEST_UID

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture
def app_db():
    """SQLAlchemy session connected as swu_app -- the role both policies
    under test apply to. Function-scoped (unlike test_row_level_security.py's
    module-scoped app_db) because SET (without LOCAL) on app.current_firebase_uid
    persists for the life of the connection, and tests below set conflicting
    values -- each test needs its own connection."""
    engine = create_engine(os.environ["APP_DATABASE_URL"])
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_rls_enabled_and_forced(db):
    row = db.execute(
        text(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'users'"
        )
    ).first()
    assert row[0] is True, "users does not have RLS enabled"
    assert row[1] is True, (
        "users does not have RLS forced (required since swu_user owns it)"
    )


def test_user_self_access_policy_exists(db):
    row = db.execute(
        text(
            "SELECT qual FROM pg_policies "
            "WHERE tablename = 'users' AND policyname = 'user_self_access'"
        )
    ).first()
    assert row is not None, "user_self_access policy not found on users"
    assert "firebase_uid" in row[0]
    assert "current_firebase_uid" in row[0]


def test_swu_app_sees_no_rows_without_current_firebase_uid(app_db):
    """Unlike inventory's tenant_isolation policy, user_self_access has no
    COALESCE fallback -- current_setting(..., true) returns NULL when unset,
    and firebase_uid = NULL is never true, so an unscoped session sees
    nothing."""
    count = app_db.execute(text("SELECT COUNT(*) FROM users")).scalar()
    assert count == 0
    app_db.rollback()


def test_swu_app_sees_no_rows_for_explicitly_empty_firebase_uid(app_db):
    """BL-56 (migration 0023 analysis): the tenant-less catalog session
    (get_catalog_db / get_optional_db) explicitly clears
    app.current_firebase_uid to '' rather than just leaving it unset (to
    close a pooled-connection leak -- see the tenant_isolation migration's
    docstring). Unlike tenant_isolation, user_self_access needed no code
    change for this: it's a text equality with no cast, and no real
    firebase_uid is ever the empty string, so '' fails the same as NULL.
    This test is the regression guard for that "no change needed"
    conclusion."""
    app_db.execute(text("SELECT set_config('app.current_firebase_uid', '', false)"))
    count = app_db.execute(text("SELECT COUNT(*) FROM users")).scalar()
    assert count == 0
    app_db.rollback()


def test_swu_app_sees_only_its_own_row(app_db):
    app_db.execute(
        text("SELECT set_config('app.current_firebase_uid', :uid, false)"),
        {"uid": DEFAULT_TEST_UID},
    )
    rows = app_db.execute(text("SELECT firebase_uid, tenant_id FROM users")).all()
    app_db.rollback()

    assert len(rows) == 1
    assert rows[0].firebase_uid == DEFAULT_TEST_UID
    assert rows[0].tenant_id == 1


def test_swu_app_cannot_see_another_identitys_row(app_db, db):
    """A second identity's users row, queried by the default test identity's
    session, never appears -- even though both rows exist in the table."""
    other_uid = "test-rls-other-user"
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES ('RLS Other Tenant') RETURNING id")
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) VALUES (:uid, :tid, :email)"
        ),
        {"uid": other_uid, "tid": tenant_id, "email": "rls-other@example.com"},
    )
    db.commit()

    try:
        app_db.execute(
            text("SELECT set_config('app.current_firebase_uid', :uid, false)"),
            {"uid": DEFAULT_TEST_UID},
        )
        rows = app_db.execute(text("SELECT firebase_uid FROM users")).all()
        app_db.rollback()

        assert {r.firebase_uid for r in rows} == {DEFAULT_TEST_UID}
    finally:
        db.rollback()
        db.execute(
            text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": other_uid}
        )
        db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tenant_id})
        db.commit()


def test_swu_user_bypasses_users_rls(db):
    """swu_user is a superuser and is never subject to RLS, regardless of
    FORCE or the session variable -- mirrors
    test_row_level_security.test_swu_user_bypasses_rls for inventory."""
    db.execute(text("SET LOCAL app.current_firebase_uid = 'nobody'"))
    count = db.execute(text("SELECT COUNT(*) FROM users")).scalar()
    assert count > 0
    db.rollback()


def test_swu_app_cannot_select_tenant_names(app_db):
    """Migration 0021 revokes swu_app's blanket SELECT on tenants -- once
    tenants.name holds human-readable, email-derived values, no session
    should be able to read other tenants' names."""
    with pytest.raises(ProgrammingError, match="permission denied"):
        app_db.execute(text("SELECT name FROM tenants")).all()
    app_db.rollback()


def test_swu_app_can_select_tenant_ids(app_db):
    """The auto-provisioning INSERT ... RETURNING id (app/database.py's
    get_db) needs column-level SELECT on tenants.id even though the blanket
    SELECT above is revoked."""
    ids = app_db.execute(text("SELECT id FROM tenants")).all()
    app_db.rollback()
    assert len(ids) > 0
