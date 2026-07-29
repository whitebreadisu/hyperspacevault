"""
P5 Stage 1: users table.

Integration tests -- require DATABASE_URL (standard inside the backend container).
"""

import os

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .conftest import DEFAULT_TEST_UID

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)


def test_users_table_has_seeded_default_test_identity(db):
    """P5 Stage 2: conftest's seed_default_test_user fixture maps
    DEFAULT_TEST_UID to tenant #1, so the default `client` fixture acts as a
    tenant #1 user."""
    row = db.execute(
        text("SELECT tenant_id FROM users WHERE firebase_uid = :uid"),
        {"uid": DEFAULT_TEST_UID},
    ).first()
    assert row is not None
    assert row.tenant_id == 1


def test_users_firebase_uid_unique_constraint(db):
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES ('test-uid-1', 1, 'a@example.com')"
        )
    )
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO users (firebase_uid, tenant_id, email) "
                "VALUES ('test-uid-1', 1, 'b@example.com')"
            )
        )
    db.rollback()


def test_users_tenant_id_foreign_key_enforced(db):
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO users (firebase_uid, tenant_id, email) "
                "VALUES ('test-uid-2', 999, 'c@example.com')"
            )
        )
    db.rollback()
