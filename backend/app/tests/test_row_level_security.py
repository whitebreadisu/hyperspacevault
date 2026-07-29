"""
P4 Stage 2: row-level security on inventory.

Integration tests -- require DATABASE_URL and APP_DATABASE_URL (standard
inside the backend container).
"""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture(scope="module")
def app_db():
    """SQLAlchemy session connected as swu_app -- the role tenant_isolation actually applies to."""
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
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'inventory'"
        )
    ).first()
    assert row[0] is True, "inventory does not have RLS enabled"
    assert row[1] is True, (
        "inventory does not have RLS forced (required since swu_user owns it)"
    )


def test_tenant_isolation_policy_exists(db):
    row = db.execute(
        text(
            "SELECT qual FROM pg_policies "
            "WHERE tablename = 'inventory' AND policyname = 'tenant_isolation'"
        )
    ).first()
    assert row is not None, "tenant_isolation policy not found on inventory"
    assert "tenant_id" in row[0]
    assert "current_tenant_id" in row[0]


def test_swu_app_sees_zero_rows_by_default(app_db):
    """BL-56 / migration 0023 (REPLACES the old "COALESCE bridge treats the
    session as tenant #1" behavior this test used to assert): with no
    session variable set, a swu_app session must see zero inventory rows,
    not tenant #1's -- this is the RLS fail-safe the tenant-less catalog
    session (get_catalog_db / get_optional_db, ADR-0008) depends on."""
    count = app_db.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
    assert count == 0
    app_db.rollback()


def test_swu_app_sees_zero_rows_for_explicitly_empty_tenant(app_db):
    """The tenant-less catalog session doesn't just leave the GUC unset --
    it explicitly clears it to '' (app/database.py's _open_catalog_session)
    to close the pooled-connection leak where a prior authenticated request
    left a real tenant_id set on this same connection. NULLIF(..., '') must
    treat that '' identically to "never set": zero rows, no cast error."""
    app_db.execute(text("SELECT set_config('app.current_tenant_id', '', false)"))
    count = app_db.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
    assert count == 0
    app_db.rollback()


def test_swu_app_blocks_unknown_tenant(app_db):
    app_db.execute(text("SET LOCAL app.current_tenant_id = '999'"))
    count = app_db.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
    assert count == 0, "swu_app should see no rows for a tenant that doesn't exist"
    app_db.rollback()


def test_swu_app_sees_tenant_one_explicitly(app_db):
    app_db.execute(text("SET LOCAL app.current_tenant_id = '1'"))
    count = app_db.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
    assert count > 0
    app_db.rollback()


def test_swu_user_bypasses_rls(db):
    """swu_user is a superuser and is never subject to RLS, regardless of
    FORCE or the session variable -- this is why swu_app exists."""
    db.execute(text("SET LOCAL app.current_tenant_id = '999'"))
    count = db.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
    assert count > 0
    db.rollback()
