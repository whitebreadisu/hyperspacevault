"""BL-344 fold-in round 1: concurrency, import token, error mapping.

Two-connection tests hold a real row lock on one connection while the API
call runs on another, so they exercise the lock order, not just the SQL.
"""

import json
import os
import threading

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import sessionmaker  # noqa: F401

from app.db_url import sa_url
from app.tests.conftest import delete_provisioned_identity

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

UID = "bl344-conc-tenant"
EMAIL = "bl344-conc@example.com"


@pytest.fixture
def tc(make_client, db):
    client = make_client(UID, EMAIL)
    client.get("/api/stashes")
    try:
        yield client
    finally:
        delete_provisioned_identity(db, UID)


@pytest.fixture
def tenant_id(tc, db):
    return db.execute(
        text("SELECT tenant_id FROM users WHERE firebase_uid = :u"), {"u": UID}
    ).scalar_one()


@pytest.fixture
def v1(db):
    return db.execute(
        text("SELECT id FROM card_variants WHERE swuapi_id = 'test-v0004'")
    ).scalar_one()


@pytest.fixture
def admin_engine():
    """A private admin (swu_user) engine so tests can hold several
    connections without exhausting app.database's 1+1 pool."""
    engine = create_engine(sa_url(os.environ["DATABASE_URL"]))
    yield engine
    engine.dispose()


def _own(db, tenant_id, variant_id, qty):
    db.execute(
        text(
            "INSERT INTO inventory (tenant_id, variant_id, quantity) "
            "VALUES (:t, :v, :q) ON CONFLICT (tenant_id, variant_id) "
            "DO UPDATE SET quantity = :q"
        ),
        {"t": tenant_id, "v": variant_id, "q": qty},
    )
    db.commit()


def _stash(client, name):
    resp = client.post("/api/stashes", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _split(client, variant_id, allocations):
    return client.put(
        f"/api/stashes/variants/{variant_id}",
        json={"allocations": [{"stash_id": s, "quantity": q} for s, q in allocations]},
    )


def _in_thread(fn):
    box: dict = {}

    def run():
        try:
            box["r"] = fn()
        except BaseException as exc:  # noqa: BLE001
            box["e"] = exc

    t = threading.Thread(target=run)
    t.start()
    return t, box


def _assert_blocked(thread, seconds=0.6):
    thread.join(timeout=seconds)
    assert thread.is_alive(), "expected the call to be waiting on a row lock"


def _row_lock(conn, tenant_id, variant_id):
    conn.execute(
        text("SELECT 1 FROM inventory WHERE tenant_id=:t AND variant_id=:v FOR UPDATE"),
        {"t": tenant_id, "v": variant_id},
    )


# ---------------------------------------------------------------------------
# B1: write skew in the trigger
# ---------------------------------------------------------------------------


def test_concurrent_inserts_into_different_stashes_cannot_both_win(
    tc, db, tenant_id, v1, admin_engine
):
    """The trigger locks the inventory row before summing, so the second
    transaction waits for the first and then sees its rows. SET CONSTRAINTS
    IMMEDIATE makes both triggers fire at INSERT time -- the interleaving
    that produced write skew."""
    _own(db, tenant_id, v1, 2)
    a, b = _stash(tc, "A"), _stash(tc, "B")
    s1, s2 = admin_engine.connect(), admin_engine.connect()
    insert = text(
        "INSERT INTO stash_items (stash_id, tenant_id, variant_id, quantity) "
        "VALUES (:s, :t, :v, 2)"
    )
    try:
        s1.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        s2.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        s1.execute(insert, {"s": a["id"], "t": tenant_id, "v": v1})
        t, box = _in_thread(
            lambda: s2.execute(insert, {"s": b["id"], "t": tenant_id, "v": v1})
        )
        _assert_blocked(t)
        s1.commit()
        t.join(timeout=10)
        assert not t.is_alive()
        assert isinstance(box.get("e"), DBAPIError), box
        assert "stash_invariant" in str(box["e"])
    finally:
        s2.rollback()
        s1.close()
        s2.close()
    total = db.execute(
        text(
            "SELECT COALESCE(SUM(quantity),0) FROM stash_items "
            "WHERE variant_id=:v AND tenant_id=:t"
        ),
        {"v": v1, "t": tenant_id},
    ).scalar_one()
    assert total == 2


# ---------------------------------------------------------------------------
# B2: decrease vs split
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("route", ["decrement", "adjust"])
def test_decrease_waits_for_the_split_then_clamps(
    tc, db, tenant_id, v1, admin_engine, route
):
    """The decrease locks the row before reading the floor, so it sees the
    committed stash and stops at it (no 500 from the trigger)."""
    _own(db, tenant_id, v1, 3)
    s = _stash(tc, "Held")
    conn = admin_engine.connect()
    _row_lock(conn, tenant_id, v1)
    conn.execute(
        text(
            "INSERT INTO stash_items (stash_id, tenant_id, variant_id, quantity) "
            "VALUES (:s, :t, :v, 3)"
        ),
        {"s": s["id"], "t": tenant_id, "v": v1},
    )
    try:
        if route == "decrement":

            def call():
                return tc.post(f"/api/inventory/{v1}/decrement")
        else:

            def call():
                return tc.post(f"/api/inventory/{v1}/adjust", json={"delta": -2})

        t, box = _in_thread(call)
        _assert_blocked(t)
        conn.commit()
        t.join(timeout=10)
        assert not t.is_alive()
        resp = box["r"]
        assert resp.status_code == 200, resp.text
        assert resp.json()["quantity"] == 3
    finally:
        conn.close()
    stored = db.execute(
        text("SELECT quantity FROM inventory WHERE tenant_id=:t AND variant_id=:v"),
        {"t": tenant_id, "v": v1},
    ).scalar_one()
    assert stored == 3


def test_put_waits_for_an_in_flight_decrease(tc, db, tenant_id, v1, admin_engine):
    """The PUT reads owned under the row lock: a decrease in flight is seen
    and the oversized split is refused with 409, not 500."""
    _own(db, tenant_id, v1, 3)
    s = _stash(tc, "Held")
    conn = admin_engine.connect()
    conn.execute(
        text("UPDATE inventory SET quantity = 1 WHERE tenant_id=:t AND variant_id=:v"),
        {"t": tenant_id, "v": v1},
    )
    try:
        t, box = _in_thread(lambda: _split(tc, v1, [(s["id"], 3)]))
        _assert_blocked(t)
        conn.commit()
        t.join(timeout=10)
        assert box["r"].status_code == 409
        assert box["r"].json()["detail"] == "exceeds_owned"
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# B3: import commit
# ---------------------------------------------------------------------------

_AUTO = object()


def _cards(qty):
    return [{"swuapi_uuid": "test-v0004", "quantity": qty}]


def _import(client, cards, *, mode, stage, token=_AUTO):
    if stage == "commit" and token is _AUTO:
        token = _import(client, cards, mode=mode, stage="dry_run").json()[
            "stash_impacts_token"
        ]
    if token is _AUTO:
        token = None
    doc = json.dumps(
        {
            "format_version": "swu-inv/1",
            "exported_at": "2026-11-07T00:00:00Z",
            "source": "test",
            "cards": cards,
        }
    )
    data = {"mode": mode, "cap_handling": "add_above", "stage": stage}
    if token is not None:
        data["stash_impacts_token"] = token
    return client.post(
        "/api/inventory/import", files={"file": ("inv.json", doc.encode())}, data=data
    )


def _import_setup(tc, db, tenant_id, v1):
    _own(db, tenant_id, v1, 5)
    old, new = _stash(tc, "Old"), _stash(tc, "New")
    assert _split(tc, v1, [(old["id"], 2), (new["id"], 2)]).status_code == 200
    return old, new


def _owned(tc):
    return {
        r["variant_id"]: r["quantity"]
        for r in tc.get("/api/inventory/quantities").json()
    }


def test_preview_returns_a_token_even_when_empty(tc, db, tenant_id, v1):
    _own(db, tenant_id, v1, 5)
    body = _import(tc, _cards(1), mode="replace", stage="dry_run").json()
    assert body["stash_impacts"] == []
    assert isinstance(body["stash_impacts_token"], str) and body["stash_impacts_token"]


def test_token_changes_with_the_impacts(tc, db, tenant_id, v1):
    _import_setup(tc, db, tenant_id, v1)
    tokens = {
        _import(tc, _cards(q), mode="replace", stage="dry_run").json()[
            "stash_impacts_token"
        ]
        for q in (3, 1, 5)
    }
    assert len(tokens) == 3


def test_stale_token_is_409_and_writes_nothing(tc, db, tenant_id, v1):
    old, _new = _import_setup(tc, db, tenant_id, v1)
    token = _import(tc, _cards(3), mode="replace", stage="dry_run").json()[
        "stash_impacts_token"
    ]
    # Between preview and commit the user frees copies: the impacts differ.
    assert _split(tc, v1, [(old["id"], 2)]).status_code == 200
    resp = _import(tc, _cards(3), mode="replace", stage="commit", token=token)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "stash_impacts_changed"
    assert _owned(tc)[v1] == 5
    assert tc.get("/api/stashes/items").json() == [
        {"stash_id": old["id"], "variant_id": v1, "quantity": 2}
    ]


def test_missing_token_with_impacts_is_409(tc, db, tenant_id, v1):
    _import_setup(tc, db, tenant_id, v1)
    resp = _import(tc, _cards(3), mode="replace", stage="commit", token=None)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "stash_impacts_changed"
    assert _owned(tc)[v1] == 5


def test_missing_token_without_impacts_commits(tc, db, tenant_id, v1):
    _import_setup(tc, db, tenant_id, v1)
    resp = _import(tc, _cards(5), mode="replace", stage="commit", token=None)
    assert resp.status_code == 200, resp.text


def test_matching_token_commits_and_cuts(tc, db, tenant_id, v1):
    _import_setup(tc, db, tenant_id, v1)
    resp = _import(tc, _cards(3), mode="replace", stage="commit")
    assert resp.status_code == 200, resp.text
    assert _owned(tc)[v1] == 3


def test_commit_waits_for_row_locks_then_recomputes_impacts(
    tc, db, tenant_id, v1, admin_engine
):
    """The commit locks inventory first, so a concurrent change that lands
    before the lock is released is seen by the recomputation (and trips the
    token) instead of being overwritten."""
    _import_setup(tc, db, tenant_id, v1)
    token = _import(tc, _cards(3), mode="replace", stage="dry_run").json()[
        "stash_impacts_token"
    ]
    conn = admin_engine.connect()
    _row_lock(conn, tenant_id, v1)
    try:
        t, box = _in_thread(
            lambda: _import(tc, _cards(3), mode="replace", stage="commit", token=token)
        )
        _assert_blocked(t)
        conn.execute(
            text("DELETE FROM stash_items WHERE tenant_id=:t"), {"t": tenant_id}
        )
        conn.commit()
        t.join(timeout=10)
        assert box["r"].status_code == 409
        assert box["r"].json()["detail"] == "stash_impacts_changed"
    finally:
        conn.close()


def test_invariant_violation_at_commit_is_409_exceeds_owned(
    tc, db, tenant_id, v1, monkeypatch
):
    """If the cuts somehow do not cover the drop, the trigger rejects the
    commit and the API answers 409, not 500."""
    from app.repositories import stashes as stash_repo

    _import_setup(tc, db, tenant_id, v1)
    monkeypatch.setattr(stash_repo, "apply_stash_cuts", lambda *a, **k: None)
    resp = _import(tc, _cards(3), mode="replace", stage="commit")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "exceeds_owned"
    assert _owned(tc)[v1] == 5


# ---------------------------------------------------------------------------
# B4: create hardening, deleted-mid-PUT
# ---------------------------------------------------------------------------


def test_concurrent_creates_respect_the_cap_of_50(tc):
    for i in range(49):
        _stash(tc, f"S{i}")
    results = []

    def create(n):
        results.append(tc.post("/api/stashes", json={"name": f"Race {n}"}))

    threads = [threading.Thread(target=create, args=(n,)) for n in range(4)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=20)
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert {r.json()["detail"] for r in results if r.status_code == 409} == {
        "stash_limit"
    }
    assert len(tc.get("/api/stashes").json()) == 50


def test_concurrent_same_name_creates_have_one_winner(tc):
    results = []

    def create():
        results.append(tc.post("/api/stashes", json={"name": "Same"}))

    threads = [threading.Thread(target=create) for _ in range(3)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=20)
    assert sorted(r.status_code for r in results) == [201, 409, 409]
    assert {r.json()["detail"] for r in results if r.status_code == 409} == {
        "duplicate_name"
    }


def test_other_integrity_errors_are_not_reported_as_duplicate_name(monkeypatch):
    from unittest.mock import MagicMock

    from app.repositories import stashes as stash_repo
    from app.services import stashes as stash_service

    monkeypatch.setattr(stash_repo, "lock_tenant_stash_creation", lambda db: None)
    monkeypatch.setattr(stash_repo, "name_taken", lambda db, n, **k: False)
    monkeypatch.setattr(stash_repo, "count_stashes", lambda db: 0)

    def boom(db, name, description):
        raise IntegrityError("INSERT", {}, Exception("some other constraint"))

    monkeypatch.setattr(stash_repo, "add_stash", boom)
    with pytest.raises(IntegrityError):
        stash_service.create_stash(MagicMock(), "X", None)


def test_stash_deleted_mid_put_is_404(tc, db, tenant_id, v1, monkeypatch):
    """The existence check passes (stale) but the stash is gone by insert
    time: the composite FK trips and the API answers 404, not 500."""
    from app.repositories import stashes as stash_repo

    _own(db, tenant_id, v1, 2)
    s = _stash(tc, "Gone")
    assert tc.delete(f"/api/stashes/{s['id']}").status_code == 204
    monkeypatch.setattr(stash_repo, "existing_stash_ids", lambda db, ids: set(ids))
    assert _split(tc, v1, [(s["id"], 1)]).status_code == 404


# ---------------------------------------------------------------------------
# B6: composite FK
# ---------------------------------------------------------------------------


def test_stash_item_cannot_point_at_another_tenants_stash(tc, db, tenant_id, v1):
    _own(db, tenant_id, v1, 2)
    s = _stash(tc, "Mine")
    other = db.execute(
        text("INSERT INTO tenants (name) VALUES ('bl344 fk tenant') RETURNING id")
    ).scalar_one()
    db.commit()
    try:
        _own(db, other, v1, 2)
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO stash_items (stash_id, tenant_id, variant_id, quantity) "
                    "VALUES (:s, :t, :v, 1)"
                ),
                {"s": s["id"], "t": other, "v": v1},
            )
        db.rollback()
    finally:
        db.rollback()
        db.execute(text("DELETE FROM inventory WHERE tenant_id=:t"), {"t": other})
        db.execute(text("DELETE FROM tenants WHERE id=:t"), {"t": other})
        db.commit()
