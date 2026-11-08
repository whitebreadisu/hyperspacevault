"""Stash return / restore: move copies between a stash and the Vault.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_stashes_move.py -v
"""

import os
import threading

import pytest
from sqlalchemy import create_engine, text

from app.db_url import sa_url
from app.tests.conftest import delete_provisioned_identity

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

UID = "bl344-move-a"
EMAIL = "bl344-move-a@example.com"
OTHER_UID = "bl344-move-b"
OTHER_EMAIL = "bl344-move-b@example.com"


def _variant(db, swuapi_id):
    return db.execute(
        text("SELECT id FROM card_variants WHERE swuapi_id = :s"), {"s": swuapi_id}
    ).scalar_one()


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
    return _variant(db, "test-v0004")


@pytest.fixture
def v2(db):
    return _variant(db, "test-v0005")


@pytest.fixture
def admin_engine():
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


def _stash(client, name="Binder"):
    resp = client.post("/api/stashes", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _split(client, variant_id, allocations):
    resp = client.put(
        f"/api/stashes/variants/{variant_id}",
        json={"allocations": [{"stash_id": s, "quantity": q} for s, q in allocations]},
    )
    assert resp.status_code == 200, resp.text


def _move(client, verb, stash_id, items):
    return client.post(
        f"/api/stashes/{stash_id}/{verb}",
        json={"items": [{"variant_id": v, "quantity": q} for v, q in items]},
    )


def _items(client):
    return {
        (i["stash_id"], i["variant_id"]): i["quantity"]
        for i in client.get("/api/stashes/items").json()
    }


def _owned(client):
    return {
        r["variant_id"]: r["quantity"]
        for r in client.get("/api/inventory/quantities").json()
    }


class TestReturn:
    def test_one_item_partial(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 5)
        s = _stash(tc)
        _split(tc, v1, [(s["id"], 4)])
        resp = _move(tc, "return", s["id"], [(v1, 1)])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "stash_id": s["id"],
            "copies": 3,
            "items": [{"variant_id": v1, "quantity": 3}],
        }
        assert _items(tc) == {(s["id"], v1): 3}
        assert _owned(tc)[v1] == 5

    def test_many_items_and_zero_removes_row(self, tc, db, tenant_id, v1, v2):
        _own(db, tenant_id, v1, 2)
        _own(db, tenant_id, v2, 3)
        s = _stash(tc)
        _split(tc, v1, [(s["id"], 2)])
        _split(tc, v2, [(s["id"], 3)])
        resp = _move(tc, "return", s["id"], [(v2, 1), (v1, 2)])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["copies"] == 2
        assert {i["variant_id"]: i["quantity"] for i in body["items"]} == {
            v1: 0,
            v2: 2,
        }
        assert _items(tc) == {(s["id"], v2): 2}
        assert _owned(tc) == {v1: 2, v2: 3}

    def test_exceeds_stash_writes_nothing(self, tc, db, tenant_id, v1, v2):
        _own(db, tenant_id, v1, 3)
        _own(db, tenant_id, v2, 3)
        s = _stash(tc)
        _split(tc, v1, [(s["id"], 3)])
        _split(tc, v2, [(s["id"], 1)])
        resp = _move(tc, "return", s["id"], [(v1, 2), (v2, 2)])
        assert resp.status_code == 409
        assert resp.json()["detail"] == "exceeds_stash"
        assert _items(tc) == {(s["id"], v1): 3, (s["id"], v2): 1}

    def test_printing_not_in_stash_is_exceeds_stash(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 2)
        s = _stash(tc)
        assert _move(tc, "return", s["id"], [(v1, 1)]).status_code == 409

    def test_other_tenants_stash_404(self, tc, db, tenant_id, v1, make_client):
        _own(db, tenant_id, v1, 2)
        mine = _stash(tc)
        _split(tc, v1, [(mine["id"], 2)])
        other = make_client(OTHER_UID, OTHER_EMAIL)
        try:
            assert _move(other, "return", mine["id"], [(v1, 1)]).status_code == 404
            assert _move(other, "restore", mine["id"], [(v1, 1)]).status_code == 404
        finally:
            delete_provisioned_identity(db, OTHER_UID)
        # make_client swaps the app-wide identity, so read back via SQL.
        rows = db.execute(
            text("SELECT quantity FROM stash_items WHERE stash_id = :s"),
            {"s": mine["id"]},
        ).all()
        assert [r.quantity for r in rows] == [2]

    def test_missing_stash_404(self, tc, v1):
        assert _move(tc, "return", 99999999, [(v1, 1)]).status_code == 404

    def test_validation_422(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 3)
        s = _stash(tc)
        _split(tc, v1, [(s["id"], 3)])
        assert _move(tc, "return", s["id"], []).status_code == 422
        assert _move(tc, "return", s["id"], [(v1, 1), (v1, 1)]).status_code == 422
        assert _move(tc, "return", s["id"], [(v1, 0)]).status_code == 422
        assert _move(tc, "restore", s["id"], [(v1, 1), (v1, 1)]).status_code == 422
        assert _items(tc) == {(s["id"], v1): 3}


class TestRestore:
    def test_undo_of_a_return(self, tc, db, tenant_id, v1, v2):
        _own(db, tenant_id, v1, 2)
        _own(db, tenant_id, v2, 3)
        s = _stash(tc)
        _split(tc, v1, [(s["id"], 2)])
        _split(tc, v2, [(s["id"], 3)])
        sent = [(v1, 2), (v2, 1)]
        assert _move(tc, "return", s["id"], sent).status_code == 200
        resp = _move(tc, "restore", s["id"], sent)
        assert resp.status_code == 200, resp.text
        assert resp.json()["copies"] == 5
        assert {i["variant_id"]: i["quantity"] for i in resp.json()["items"]} == {
            v1: 2,
            v2: 3,
        }
        assert _items(tc) == {(s["id"], v1): 2, (s["id"], v2): 3}
        assert _owned(tc) == {v1: 2, v2: 3}

    def test_exceeds_owned_writes_nothing(self, tc, db, tenant_id, v1, v2):
        _own(db, tenant_id, v1, 3)
        _own(db, tenant_id, v2, 3)
        s = _stash(tc)
        _split(tc, v1, [(s["id"], 3)])
        _split(tc, v2, [(s["id"], 3)])
        assert _move(tc, "return", s["id"], [(v1, 3), (v2, 3)]).status_code == 200
        _own(db, tenant_id, v2, 1)  # owned lowered after the return
        resp = _move(tc, "restore", s["id"], [(v1, 3), (v2, 2)])
        assert resp.status_code == 409
        assert resp.json()["detail"] == "exceeds_owned"
        assert _items(tc) == {}

    def test_other_stashes_count_against_owned(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 3)
        a, b = _stash(tc, "A"), _stash(tc, "B")
        _split(tc, v1, [(a["id"], 2), (b["id"], 1)])
        assert _move(tc, "return", a["id"], [(v1, 2)]).status_code == 200
        _split(tc, v1, [(b["id"], 3)])
        resp = _move(tc, "restore", a["id"], [(v1, 1)])
        assert resp.status_code == 409
        assert resp.json()["detail"] == "exceeds_owned"

    def test_unowned_printing_is_exceeds_owned(self, tc, v2):
        s = _stash(tc)
        assert _move(tc, "restore", s["id"], [(v2, 1)]).status_code == 409


def test_return_waits_for_concurrent_put_on_the_same_printing(
    tc, db, tenant_id, v1, admin_engine
):
    """Return takes the inventory row lock first, like the PUT, so a PUT
    holding the row finishes first and the return sees its result."""
    _own(db, tenant_id, v1, 3)
    s = _stash(tc)
    _split(tc, v1, [(s["id"], 3)])
    conn = admin_engine.connect()
    conn.execute(
        text("SELECT 1 FROM inventory WHERE tenant_id=:t AND variant_id=:v FOR UPDATE"),
        {"t": tenant_id, "v": v1},
    )
    # The in-flight PUT (not yet committed) shrinks the stash to 1.
    conn.execute(
        text("UPDATE stash_items SET quantity = 1 WHERE stash_id = :s"),
        {"s": s["id"]},
    )
    box = {}

    def call():
        box["r"] = _move(tc, "return", s["id"], [(v1, 2)])

    t = threading.Thread(target=call)
    t.start()
    try:
        t.join(timeout=0.6)
        assert t.is_alive(), "return should wait on the inventory row lock"
        conn.commit()
        t.join(timeout=10)
        assert not t.is_alive()
    finally:
        conn.close()
    assert box["r"].status_code == 409
    assert box["r"].json()["detail"] == "exceeds_stash"
    assert _items(tc) == {(s["id"], v1): 1}


def _db_state(db, stash_id):
    db.expire_all()
    rows = db.execute(
        text(
            "SELECT variant_id, quantity FROM stash_items "
            "WHERE stash_id = :s ORDER BY variant_id"
        ),
        {"s": stash_id},
    ).all()
    return {r.variant_id: r.quantity for r in rows}


@pytest.mark.parametrize("verb", ["return", "restore"])
def test_response_matches_database_state(tc, db, tenant_id, v1, v2, verb):
    _own(db, tenant_id, v1, 4)
    _own(db, tenant_id, v2, 4)
    s = _stash(tc)
    other = _stash(tc, "Other")
    _split(tc, v1, [(s["id"], 3), (other["id"], 1)])
    _split(tc, v2, [(s["id"], 2)])
    if verb == "restore":
        assert _move(tc, "return", s["id"], [(v1, 2), (v2, 2)]).status_code == 200
    resp = _move(tc, verb, s["id"], [(v1, 2), (v2, 2)])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    state = _db_state(db, s["id"])
    assert body["copies"] == sum(state.values())
    assert {i["variant_id"]: i["quantity"] for i in body["items"]} == {
        v1: state.get(v1, 0),
        v2: state.get(v2, 0),
    }


def test_restore_waits_for_concurrent_owned_decrease(
    tc, db, tenant_id, v1, admin_engine
):
    """An owned decrease holding the inventory row lock commits first; the
    restore then sees the lower owned count and writes nothing."""
    _own(db, tenant_id, v1, 3)
    s = _stash(tc)
    _split(tc, v1, [(s["id"], 3)])
    assert _move(tc, "return", s["id"], [(v1, 3)]).status_code == 200
    conn = admin_engine.connect()
    conn.execute(
        text(
            "UPDATE inventory SET quantity = 1 WHERE tenant_id = :t AND variant_id = :v"
        ),
        {"t": tenant_id, "v": v1},
    )
    box = {}

    def call():
        box["r"] = _move(tc, "restore", s["id"], [(v1, 2)])

    t = threading.Thread(target=call)
    t.start()
    try:
        t.join(timeout=0.6)
        assert t.is_alive(), "restore should wait on the inventory row lock"
        conn.commit()
        t.join(timeout=10)
        assert not t.is_alive()
    finally:
        conn.close()
    assert box["r"].status_code == 409
    assert box["r"].json()["detail"] == "exceeds_owned"
    assert _db_state(db, s["id"]) == {}


# ---------------------------------------------------------------------------
# Stash row lock: a DELETE of the stash vs a move
# ---------------------------------------------------------------------------


@pytest.fixture
def pause(monkeypatch):
    """Pause the next move right after it took its locks (it is about to
    read the stash quantities) until the test releases it. Returns
    (reached, release, armed); a test arms it once its setup is done."""
    from app.repositories import stashes as repo

    reached, release, armed = (threading.Event() for _ in range(3))
    real = repo.stash_quantities

    def wrapper(*args, **kwargs):
        if armed.is_set() and not reached.is_set():
            reached.set()
            assert release.wait(15)
        return real(*args, **kwargs)

    monkeypatch.setattr(repo, "stash_quantities", wrapper)
    return reached, release, armed


def _run(fn):
    box = {}

    def go():
        box["r"] = fn()

    t = threading.Thread(target=go)
    t.start()
    return t, box


def _assert_blocked_thread(thread, seconds=0.6):
    thread.join(timeout=seconds)
    assert thread.is_alive(), "expected the call to be waiting on a lock"


def _prepare(tc, db, tenant_id, v1, verb, pause=None):
    """Owned 3, all stashed; for restore, 2 copies are already returned.
    Arms the pause hook after the setup return has passed through it."""
    _own(db, tenant_id, v1, 3)
    s = _stash(tc)
    _split(tc, v1, [(s["id"], 3)])
    if verb == "restore":
        assert _move(tc, "return", s["id"], [(v1, 2)]).status_code == 200
    if pause is not None:
        pause[2].set()
    return s


@pytest.mark.parametrize("verb", ["return", "restore"])
def test_delete_waits_for_a_move_that_holds_the_stash_lock(
    tc, db, tenant_id, v1, admin_engine, pause, verb
):
    reached, release, armed = pause
    s = _prepare(tc, db, tenant_id, v1, verb, pause)
    mover, box = _run(lambda: _move(tc, verb, s["id"], [(v1, 1)]))
    assert reached.wait(10), "the move never reached its locked section"
    conn = admin_engine.connect()

    def delete():
        conn.execute(text("DELETE FROM stashes WHERE id = :s"), {"s": s["id"]})
        conn.commit()

    deleter, _ = _run(delete)
    try:
        _assert_blocked_thread(deleter)
        release.set()
        mover.join(timeout=10)
        deleter.join(timeout=10)
        assert not mover.is_alive() and not deleter.is_alive()
    finally:
        release.set()
        conn.close()
    assert box["r"].status_code == 200, box["r"].text
    assert box["r"].json()["stash_id"] == s["id"]
    # The delete ran after the move committed, and cascaded its rows.
    gone = db.execute(
        text("SELECT count(*) FROM stashes WHERE id = :s"), {"s": s["id"]}
    ).scalar_one()
    assert gone == 0
    assert _db_state(db, s["id"]) == {}


@pytest.mark.parametrize("verb", ["return", "restore"])
def test_move_after_a_delete_holding_the_stash_lock_is_404(
    tc, db, tenant_id, v1, admin_engine, monkeypatch, verb
):
    """The delete holds the stash row first; the move waits on the stash
    lock, then answers 404 without reading or writing any quantity."""
    from app.repositories import stashes as repo

    s = _prepare(tc, db, tenant_id, v1, verb)
    calls = []
    real = repo.stash_quantities

    def spy(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(repo, "stash_quantities", spy)
    conn = admin_engine.connect()
    conn.execute(text("DELETE FROM stashes WHERE id = :s"), {"s": s["id"]})
    mover, box = _run(lambda: _move(tc, verb, s["id"], [(v1, 1)]))
    try:
        _assert_blocked_thread(mover)
        conn.commit()
        mover.join(timeout=10)
        assert not mover.is_alive()
    finally:
        conn.close()
    assert box["r"].status_code == 404
    assert calls == []
    assert _db_state(db, s["id"]) == {}
    owned = db.execute(
        text("SELECT quantity FROM inventory WHERE tenant_id=:t AND variant_id=:v"),
        {"t": tenant_id, "v": v1},
    ).scalar_one()
    assert owned == 3


@pytest.mark.parametrize("verb", ["return", "restore"])
def test_response_is_the_state_at_the_moves_commit(tc, db, tenant_id, v1, pause, verb):
    """A PUT on the same printing is blocked behind the move's locks and
    commits right after it; the move's response must be the state at the
    move's own commit, not the PUT's."""
    reached, release, armed = pause
    _own(db, tenant_id, v1, 4)
    s, other = _stash(tc), _stash(tc, "Other")
    _split(tc, v1, [(s["id"], 3), (other["id"], 1)])
    if verb == "restore":
        assert _move(tc, "return", s["id"], [(v1, 2)]).status_code == 200
    armed.set()
    mover, box = _run(lambda: _move(tc, verb, s["id"], [(v1, 1)]))
    assert reached.wait(10)
    putter, pbox = _run(
        lambda: tc.put(
            f"/api/stashes/variants/{v1}",
            json={"allocations": [{"stash_id": other["id"], "quantity": 1}]},
        )
    )
    try:
        _assert_blocked_thread(putter)
        release.set()
        mover.join(timeout=10)
        putter.join(timeout=10)
        assert not mover.is_alive() and not putter.is_alive()
    finally:
        release.set()
    assert pbox["r"].status_code == 200, pbox["r"].text
    # return: 3 - 1 = 2; restore: (3 - 2) + 1 = 2.
    body = box["r"].json()
    assert body["copies"] == 2
    assert body["items"] == [{"variant_id": v1, "quantity": 2}]
    # The PUT ran afterwards and replaced the printing's whole split.
    assert _db_state(db, s["id"]) == {}
