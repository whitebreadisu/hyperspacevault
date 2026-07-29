"""
P5 Stage 2: identity-based tenant resolution.

Integration tests -- require DATABASE_URL and APP_DATABASE_URL (standard
inside the backend container).
"""

import os
import threading

import pytest
from fastapi import Request
from sqlalchemy import event, text

from app.database import app_engine, get_db

from .conftest import DEFAULT_TEST_EMAIL, DEFAULT_TEST_UID, delete_provisioned_identity

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


def _make_request() -> Request:
    """A bare Request for driving get_db() directly -- only its .state is
    used (P6 stage 1: get_db() stashes tenant_id there for the request
    logging middleware)."""
    return Request(scope={"type": "http", "headers": []})


def _current_tenant_setting(identity: tuple[str, str, bool]) -> str | None:
    """Drive get_db() directly with an explicit identity and read back
    app.current_tenant_id from the session it produced."""
    gen = get_db(request=_make_request(), identity=identity)
    db = next(gen)
    try:
        return db.execute(
            text("SELECT current_setting('app.current_tenant_id', true)")
        ).scalar()
    finally:
        gen.close()


def test_get_db_sets_session_variable_for_known_identity():
    identity = (DEFAULT_TEST_UID, DEFAULT_TEST_EMAIL, True)
    assert _current_tenant_setting(identity) == "1"


def test_session_variable_survives_commit():
    """set_config(..., false) is session-scoped, unlike SET LOCAL -- it must
    still be set after a commit() so upsert_increment/upsert_decrement's
    commit() + refresh() pattern sees the right tenant on the refresh."""
    gen = get_db(
        request=_make_request(),
        identity=(DEFAULT_TEST_UID, DEFAULT_TEST_EMAIL, True),
    )
    db = next(gen)
    try:
        db.commit()
        value = db.execute(
            text("SELECT current_setting('app.current_tenant_id', true)")
        ).scalar()
        assert value == "1"
    finally:
        gen.close()


def test_new_identity_auto_provisions_tenant(db):
    """A firebase_uid seen for the first time gets its own brand-new tenant,
    named after its email -- the "one user, one tenant" model."""
    uid, email = "test-new-identity-1", "newuser1@example.com"
    gen = get_db(request=_make_request(), identity=(uid, email, True))
    app_db = next(gen)
    try:
        tenant_id = app_db.execute(
            text("SELECT current_setting('app.current_tenant_id', true)")
        ).scalar()
        assert tenant_id != "1"

        tenant_name = db.execute(
            text("SELECT name FROM tenants WHERE id = :id"), {"id": int(tenant_id)}
        ).scalar()
        assert tenant_name == f"{email}'s Tenant"
    finally:
        gen.close()
        delete_provisioned_identity(db, uid)


def test_lost_race_does_not_orphan_tenant_row(db):
    """BL-135: two concurrent first requests for a brand-new firebase_uid
    can each pass _open_authenticated_session's "no users row yet" check
    before either commits -- the second to attempt the users INSERT loses
    the unique-constraint race (ON CONFLICT DO NOTHING returns no row) and,
    pre-fix, permanently orphaned the tenant row it had already inserted for
    itself (this fired in prod: tenants 10 and 13).

    Forces that exact interleaving deterministically instead of hoping for
    it: a SQLAlchemy after_cursor_execute hook pauses the "loser" thread the
    instant its initial SELECT (finding no users row yet) completes, lets
    the "winner" finish its own provisioning and commit, then releases the
    loser to run its INSERT INTO tenants / INSERT INTO users ON CONFLICT DO
    NOTHING -- which now genuinely loses, since the winner's row is already
    committed. Asserts exactly one tenant row survives for this identity
    (the fix's DELETE FROM tenants in the lost-race branch).
    """
    from app.database import _open_authenticated_session

    uid, email = "test-race-uid-1", "race1@example.com"

    loser_thread_id: dict[str, int] = {}
    loser_paused = threading.Event()
    winner_committed = threading.Event()
    results: dict[str, int] = {}

    def pause_loser_after_initial_select(
        conn, cursor, statement, parameters, context, executemany
    ):
        if (
            not loser_paused.is_set()
            and threading.get_ident() == loser_thread_id.get("id")
            and "SELECT tenant_id FROM users WHERE firebase_uid" in statement
        ):
            loser_paused.set()
            assert winner_committed.wait(timeout=5), "winner never committed"

    event.listen(app_engine, "after_cursor_execute", pause_loser_after_initial_select)

    def run_loser():
        loser_thread_id["id"] = threading.get_ident()
        request = _make_request()
        db_loser, conn_loser = _open_authenticated_session(request, uid, email)
        try:
            results["loser_tenant_id"] = request.state.tenant_id
        finally:
            db_loser.close()
            conn_loser.close()

    loser_thread = threading.Thread(target=run_loser)
    try:
        loser_thread.start()
        assert loser_paused.wait(timeout=5), (
            "loser thread never reached its initial SELECT"
        )

        winner_request = _make_request()
        db_winner, conn_winner = _open_authenticated_session(winner_request, uid, email)
        try:
            results["winner_tenant_id"] = winner_request.state.tenant_id
        finally:
            db_winner.close()
            conn_winner.close()
        winner_committed.set()

        loser_thread.join(timeout=5)
        assert not loser_thread.is_alive(), "loser thread never finished"
    finally:
        event.remove(
            app_engine, "after_cursor_execute", pause_loser_after_initial_select
        )

    # Both requests must resolve to the same (winner's) tenant.
    assert results["loser_tenant_id"] == results["winner_tenant_id"]

    # BL-135: no orphaned tenant row -- exactly one tenant exists under this
    # identity's provisioning name, and it's the one `users` actually points at.
    tenant_ids = (
        db.execute(
            text("SELECT id FROM tenants WHERE name = :name"),
            {"name": f"{email}'s Tenant"},
        )
        .scalars()
        .all()
    )
    assert tenant_ids == [results["winner_tenant_id"]]

    delete_provisioned_identity(db, uid)


def test_new_identity_sees_zero_inventory_quantities(make_client, db):
    """A brand-new, empty tenant has no inventory rows -- since BL-101/102
    that surfaces as an empty GET /api/inventory/quantities list, which the
    merged view (conftest.merged_inventory, mirroring the frontend merge)
    renders as quantity 0 on every variant."""
    from .conftest import merged_inventory

    uid, email = "test-new-identity-2", "newuser2@example.com"
    client = make_client(uid, email)
    try:
        records = merged_inventory(client)
        assert len(records) > 0
        assert all(r["quantity"] == 0 for r in records)
    finally:
        delete_provisioned_identity(db, uid)


def test_default_tenant_has_nonzero_quantities(client):
    from .conftest import merged_inventory

    records = merged_inventory(client)
    assert any(r["quantity"] > 0 for r in records)


def test_increment_decrement_round_trip(client):
    from .conftest import merged_inventory

    records = merged_inventory(client)
    zero_card = next((r for r in records if r["quantity"] == 0), None)
    if zero_card is None:
        pytest.skip("No zero-quantity card available for this test")

    card_id = zero_card["id"]
    response = client.post(f"/api/inventory/{card_id}/increment")
    assert response.status_code == 200
    assert response.json()["quantity"] == 1

    response = client.post(f"/api/inventory/{card_id}/decrement")
    assert response.status_code == 200
    assert response.json()["quantity"] == 0
