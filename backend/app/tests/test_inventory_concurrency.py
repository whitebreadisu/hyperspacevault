"""
P7 Stage 2: concurrency-safe inventory updates.

upsert_increment/upsert_decrement (app/repositories/inventory.py) now use a
single atomic INSERT ... ON CONFLICT (tenant_id, variant_id) DO UPDATE
statement, closing the lost-update race in the old SELECT-then-mutate-then-
commit pattern: two concurrent requests for the same (tenant_id, variant_id)
could each read the same starting quantity, compute the same +1 in Python,
and have one write clobber the other.

Integration test -- requires DATABASE_URL and APP_DATABASE_URL (standard
inside the backend container).
"""

import os
import threading

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.repositories import inventory as inventory_repo

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

CONCURRENCY_TENANT_UID = "test-concurrency-tenant-user"
CONCURRENCY_TENANT_EMAIL = "concurrency-tenant@example.com"
NUM_WORKERS = 10


@pytest.fixture
def concurrency_tenant(db):
    """A brand-new tenant with zero inventory rows, isolated from other
    tests' data so concurrent increments here can't interact with fixtures
    or assertions running against tenant #1/#2."""
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES ('Concurrency Tenant') RETURNING id")
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {
            "uid": CONCURRENCY_TENANT_UID,
            "tenant_id": tenant_id,
            "email": CONCURRENCY_TENANT_EMAIL,
        },
    )
    db.commit()

    try:
        yield tenant_id
    finally:
        db.rollback()
        db.execute(
            text("DELETE FROM inventory WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
        db.execute(
            text("DELETE FROM users WHERE firebase_uid = :uid"),
            {"uid": CONCURRENCY_TENANT_UID},
        )
        db.execute(
            text("DELETE FROM tenants WHERE id = :tenant_id"), {"tenant_id": tenant_id}
        )
        db.commit()


def test_concurrent_increments_are_not_lost(concurrency_tenant, db):
    """NUM_WORKERS threads, each on its own swu_app connection, call
    upsert_increment for the same brand-new (tenant_id, card_id) at the same
    moment (synchronized via a Barrier). Every increment must land --
    final quantity == NUM_WORKERS -- which the old read-then-write pattern
    could not guarantee under this kind of overlap."""
    variant_id = db.execute(
        text("SELECT id FROM card_variants ORDER BY id LIMIT 1")
    ).scalar()

    app_engine = create_engine(os.environ["APP_DATABASE_URL"])
    AppSession = sessionmaker(bind=app_engine)

    ready = threading.Barrier(NUM_WORKERS)
    errors: list[Exception] = []

    def worker():
        session = AppSession()
        try:
            session.execute(
                text("SELECT set_config('app.current_tenant_id', :tid, false)"),
                {"tid": str(concurrency_tenant)},
            )
            ready.wait()
            inventory_repo.upsert_increment(session, variant_id)
        except Exception as exc:  # pragma: no cover - surfaced via errors list
            errors.append(exc)
        finally:
            session.close()

    threads = [threading.Thread(target=worker) for _ in range(NUM_WORKERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    app_engine.dispose()

    assert errors == []

    quantity = db.execute(
        text(
            "SELECT quantity FROM inventory WHERE tenant_id = :tid AND variant_id = :vid"
        ),
        {"tid": concurrency_tenant, "vid": variant_id},
    ).scalar()
    db.rollback()
    assert quantity == NUM_WORKERS


def test_concurrent_decrements_clamp_at_zero(concurrency_tenant, db):
    """Same setup, but starting from quantity 0 and decrementing concurrently:
    the GREATEST(quantity - 1, 0) clause must keep every concurrent decrement
    from driving the row below zero (and from violating
    ck_inventory_quantity_non_negative)."""
    variant_id = db.execute(
        text("SELECT id FROM card_variants ORDER BY id DESC LIMIT 1")
    ).scalar()

    app_engine = create_engine(os.environ["APP_DATABASE_URL"])
    AppSession = sessionmaker(bind=app_engine)

    ready = threading.Barrier(NUM_WORKERS)
    errors: list[Exception] = []

    def worker():
        session = AppSession()
        try:
            session.execute(
                text("SELECT set_config('app.current_tenant_id', :tid, false)"),
                {"tid": str(concurrency_tenant)},
            )
            ready.wait()
            inventory_repo.upsert_decrement(session, variant_id)
        except Exception as exc:  # pragma: no cover - surfaced via errors list
            errors.append(exc)
        finally:
            session.close()

    threads = [threading.Thread(target=worker) for _ in range(NUM_WORKERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    app_engine.dispose()

    assert errors == []

    quantity = db.execute(
        text(
            "SELECT quantity FROM inventory WHERE tenant_id = :tid AND variant_id = :vid"
        ),
        {"tid": concurrency_tenant, "vid": variant_id},
    ).scalar()
    db.rollback()
    assert quantity == 0
