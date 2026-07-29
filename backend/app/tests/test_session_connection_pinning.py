"""Regression tests for the request-session connection pinning in
app/database.py (found live in dev, 2026-07-13).

The bug class: session-scoped GUCs (app.current_tenant_id /
app.current_firebase_uid) live on a *connection*, but an engine-bound
Session releases its connection to the pool at every commit() and lazily
checks out another one for the next statement. Any mid-request repository
commit() (e.g. replace_overrides in PUT /api/settings/limits) followed by
a GUC read could therefore land on a connection last used by a tenant-less
catalog session -- whose GUCs are '' -- producing
`invalid input syntax for type integer: ""` (a 500), or worse, silently
wrong RLS scoping. Serial traffic passes by pool luck (the same connection
comes straight back); concurrent traffic interleaves and fails.

The fix binds each request's Session to one dedicated Connection for the
request's whole life. The test below deterministically reproduces the
pre-fix failure: without pinning, the catalog session opened after s1's
commit steals s1's pooled connection and zeroes its GUCs.

Integration tests -- require DATABASE_URL and APP_DATABASE_URL.
"""

import os
from types import SimpleNamespace

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL",
)

from app.database import (  # noqa: E402
    _open_authenticated_session,
    _open_catalog_session,
)
from app.tests.conftest import DEFAULT_TEST_EMAIL, DEFAULT_TEST_UID  # noqa: E402


def _fake_request():
    return SimpleNamespace(state=SimpleNamespace())


def _read_tenant_guc(db) -> str:
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id', true)")
    ).scalar()


def test_tenant_guc_survives_commit_with_catalog_interleave():
    """The exact dev failure shape: an authenticated session commits
    mid-request (as replace_overrides / set_cap_mode / upsert_increment
    do), a tenant-less catalog session opens and closes in the gap (as any
    concurrent public read does), and the authenticated session then reads
    its tenant GUC again. Pre-fix, the catalog session steals the pooled
    connection the commit released and zeroes the GUC; post-fix the
    session's dedicated connection never re-enters the pool mid-request."""
    req = _fake_request()
    s1, conn1 = _open_authenticated_session(req, DEFAULT_TEST_UID, DEFAULT_TEST_EMAIL)
    try:
        tenant_id = _read_tenant_guc(s1)
        assert tenant_id not in (None, "")

        s1.commit()  # the mid-request commit every upsert/replace repo does

        c, cconn = _open_catalog_session()
        assert _read_tenant_guc(c) == ""
        c.close()
        cconn.close()

        assert _read_tenant_guc(s1) == tenant_id, (
            "tenant GUC lost after mid-request commit + catalog interleave "
            "-- request session is not pinned to its connection"
        )
        # And it must still be usable for real scoped work, not just reads.
        s1.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
    finally:
        s1.close()
        conn1.close()


def test_catalog_session_gets_its_own_connection():
    """With pinning, a catalog session opened while an authenticated
    session is mid-request must be a different DB connection -- it can
    never zero the authenticated request's GUCs."""
    req = _fake_request()
    s1, conn1 = _open_authenticated_session(req, DEFAULT_TEST_UID, DEFAULT_TEST_EMAIL)
    try:
        c, cconn = _open_catalog_session()
        try:
            pid1 = s1.execute(text("SELECT pg_backend_pid()")).scalar()
            pid2 = c.execute(text("SELECT pg_backend_pid()")).scalar()
            assert pid1 != pid2
        finally:
            c.close()
            cconn.close()
    finally:
        s1.close()
        conn1.close()
