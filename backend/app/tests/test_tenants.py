"""
P4 Stage 1: tenants table and inventory.tenant_id backfill.

Integration tests — require DATABASE_URL (standard inside the backend container).
"""

import os

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL — run inside the backend container",
)


def test_tenant_one_exists(db):
    row = db.execute(text("SELECT id, name FROM tenants WHERE id = 1")).first()
    assert row is not None, "Tenant #1 not found"
    assert row[1] == "Default Tenant"


def test_all_inventory_rows_belong_to_tenant_one(db):
    other_tenants = db.execute(
        text("SELECT COUNT(*) FROM inventory WHERE tenant_id != 1")
    ).scalar()
    assert other_tenants == 0, "Found inventory rows not backfilled to tenant #1"


def test_inventory_tenant_id_not_null(db):
    null_count = db.execute(
        text("SELECT COUNT(*) FROM inventory WHERE tenant_id IS NULL")
    ).scalar()
    assert null_count == 0
