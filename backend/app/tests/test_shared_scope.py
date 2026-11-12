"""Stash sharing (App Spec §19.1): each stash's own secret link, and the
scope gates that keep a share token inside its scope.

get_shared_db scopes a token's session to the owner's WHOLE tenant (RLS
isolates tenants, not stashes), so every scope rule here is app code. Each
negative test names the guard it covers; removing that guard fails it:

- G1 get_shared_inventory_db: the vault routes refuse a non-inventory token.
- G2 get_shared_stash scope check: the stash route refuses a non-stash token.
- G3 get_shared_stash existence check: a share whose stash is gone is a 404.
- G4 the stash id comes from the share row only (the gate), and the stash
  read filters on it.
- G5 tenant RLS under the share session (migration 0032 / 0030).
- G6 delete_stash revokes the stash's share in the same transaction.
- G7 create_share's ownership check (lock_stash under the caller's RLS).
- G8 the partial unique index + create pre-check (one active link a stash).
- G9 rename_share's stash-scope refusal.
- G10 the vault routes' response shapes (no stash fields).
- G11 the shared-read rate limiter in get_shared_db, which both gates wrap.
- G12 every /api/shared route declares exactly one scope gate.
- G13 rotate replaces the token.

Every test runs as throwaway tenants; tenant #1's fixture data is untouched.
make_client swaps the app-global identity, so each block re-selects the
tenant it acts as (`_as`).

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_shared_scope.py -v
"""

import json
import os

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import rate_limit
from app.main import app
from app.tests.conftest import delete_provisioned_identity

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

A = ("bl209-tenant-a", "bl209-a@example.com")
B = ("bl209-tenant-b", "bl209-b@example.com")
VAULT_ROUTES = ("", "/quantities", "/limits")
NOT_FOUND = {"detail": "Not found"}


def _variant(db, swuapi_id: str) -> int:
    return db.execute(
        text("SELECT id FROM card_variants WHERE swuapi_id = :s"), {"s": swuapi_id}
    ).scalar_one()


def _tenant(db, uid: str) -> int:
    return db.execute(
        text("SELECT tenant_id FROM users WHERE firebase_uid = :u"), {"u": uid}
    ).scalar_one()


def _own(db, tenant_id: int, variant_id: int, qty: int) -> None:
    db.execute(
        text(
            "INSERT INTO inventory (tenant_id, variant_id, quantity) "
            "VALUES (:t, :v, :q) ON CONFLICT (tenant_id, variant_id) "
            "DO UPDATE SET quantity = :q"
        ),
        {"t": tenant_id, "v": variant_id, "q": qty},
    )
    db.commit()


@pytest.fixture
def world(make_client, db):
    """Tenant A with two stashes (Trade: 2 x v4 + 1 x v5; Keep: 3 x v1) and
    tenant B with one stash (B Binder: 1 x v4). Returns a dict of ids and a
    `_as(who)` client switcher."""
    v1, v4, v5 = (_variant(db, f"test-v000{n}") for n in (1, 4, 5))
    clients = {}

    def _as(who):
        clients[who] = make_client(*(A if who == "a" else B))
        return clients[who]

    try:
        a = _as("a")
        a.get("/api/stashes")
        ta = _tenant(db, A[0])
        for v, q in ((v1, 3), (v4, 2), (v5, 1)):
            _own(db, ta, v, q)
        trade = a.post(
            "/api/stashes", json={"name": "Trade", "description": "For the LGS"}
        ).json()
        keep = a.post(
            "/api/stashes", json={"name": "Keep", "description": "Never trade"}
        ).json()
        for v, sid, q in ((v4, trade["id"], 2), (v5, trade["id"], 1)):
            r = a.put(
                f"/api/stashes/variants/{v}",
                json={"allocations": [{"stash_id": sid, "quantity": q}]},
            )
            assert r.status_code == 200, r.text
        r = a.put(
            f"/api/stashes/variants/{v1}",
            json={"allocations": [{"stash_id": keep["id"], "quantity": 3}]},
        )
        assert r.status_code == 200, r.text

        b = _as("b")
        b.get("/api/stashes")
        tb = _tenant(db, B[0])
        _own(db, tb, v4, 1)
        b_binder = b.post("/api/stashes", json={"name": "B Binder"}).json()
        assert (
            b.put(
                f"/api/stashes/variants/{v4}",
                json={"allocations": [{"stash_id": b_binder["id"], "quantity": 1}]},
            ).status_code
            == 200
        )
        yield {
            "as": _as,
            "v1": v1,
            "v4": v4,
            "v5": v5,
            "trade": trade,
            "keep": keep,
            "b_binder": b_binder,
            "ta": ta,
            "tb": tb,
        }
    finally:
        delete_provisioned_identity(db, A[0])
        delete_provisioned_identity(db, B[0])


@pytest.fixture
def anon():
    return TestClient(app)


def _share(client, name="Jeremy", stash_id=None):
    body = {"name": name}
    if stash_id is not None:
        body["stash_id"] = stash_id
    resp = client.post("/api/shares", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _stash_view(anon, token):
    return anon.get(f"/api/shared/{token}/stash")


# ---------------------------------------------------------------------------
# The viewer read
# ---------------------------------------------------------------------------


def test_stash_view_shape_and_rows(world, anon):
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["trade"]["id"])
    assert share["scope"] == "stash"
    assert share["target_id"] == world["trade"]["id"]
    assert share["stash_name"] == "Trade"

    resp = _stash_view(anon, share["token"])
    assert resp.status_code == 200, resp.text
    assert resp.headers["cache-control"] == "private, max-age=30"
    body = resp.json()
    assert set(body) == {"share_name", "stash", "rows", "totals"}
    assert body["share_name"] == "Jeremy"
    assert body["stash"] == {"name": "Trade", "description": "For the LGS"}
    assert [(r["variant_id"], r["quantity"]) for r in body["rows"]] == sorted(
        [(world["v4"], 2), (world["v5"], 1)]
    )
    assert set(body["rows"][0]) == {
        "variant_id",
        "quantity",
        "stashed_at",
        "market",
        "low",
    }
    assert body["totals"]["printings"] == 2
    assert body["totals"]["copies"] == 3


def test_stash_view_prices_follow_the_stash_value_rule(world, anon, db):
    """Own price, else the card's Standard printing's (v5 Foil has none, so
    it takes v4 Standard's); the low-outlier rule applies."""
    v4, v5 = world["v4"], world["v5"]
    db.execute(
        text(
            "INSERT INTO variant_latest_prices (variant_id, market, low, as_of) "
            "VALUES (:v, 2.00, 1.50, CURRENT_DATE)"
        ),
        {"v": v4},
    )
    db.commit()
    try:
        a = world["as"]("a")
        share = _share(a, "Jeremy", world["trade"]["id"])
        body = _stash_view(anon, share["token"]).json()
        rows = {r["variant_id"]: r for r in body["rows"]}
        assert (rows[v4]["market"], rows[v4]["low"]) == (2.0, 1.5)
        assert (rows[v5]["market"], rows[v5]["low"]) == (2.0, 1.5)
        assert body["totals"]["value_market"] == 6.0
        assert body["totals"]["value_low"] == 4.5
    finally:
        db.rollback()
        db.execute(
            text("DELETE FROM variant_latest_prices WHERE variant_id = :v"), {"v": v4}
        )
        db.commit()


def test_empty_stash_and_no_description(world, anon):
    a = world["as"]("a")
    empty = a.post("/api/stashes", json={"name": "Spare box"}).json()
    share = _share(a, "Jeremy", empty["id"])
    body = _stash_view(anon, share["token"]).json()
    assert body["stash"] == {"name": "Spare box", "description": None}
    assert body["rows"] == []
    assert body["totals"] == {
        "printings": 0,
        "copies": 0,
        "value_market": 0.0,
        "value_low": 0.0,
    }


def test_stash_view_is_live(world, anon):
    """Renaming the stash and changing its counts show on the next read."""
    a = world["as"]("a")
    sid = world["trade"]["id"]
    share = _share(a, "Jeremy", sid)
    assert (
        a.patch(
            f"/api/stashes/{sid}", json={"name": "Trade binder", "description": None}
        ).status_code
        == 200
    )
    assert (
        a.post(
            f"/api/stashes/{sid}/return",
            json={"items": [{"variant_id": world["v4"], "quantity": 1}]},
        ).status_code
        == 200
    )
    body = _stash_view(anon, share["token"]).json()
    assert body["stash"] == {"name": "Trade binder", "description": None}
    assert {r["variant_id"]: r["quantity"] for r in body["rows"]}[world["v4"]] == 1
    assert body["share_name"] == "Jeremy"  # the share name does not follow


# ---------------------------------------------------------------------------
# Scope gates
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("suffix", VAULT_ROUTES)
def test_stash_token_on_vault_routes_is_404(world, anon, suffix):
    """G1: without get_shared_inventory_db a stash token reads the whole
    vault (its session is the owner's whole tenant)."""
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["trade"]["id"])
    resp = anon.get(f"/api/shared/{share['token']}{suffix}")
    assert resp.status_code == 404
    assert resp.json() == NOT_FOUND


def test_vault_token_on_stash_route_is_404(world, anon):
    """G2: a vault token must not reach the stash route."""
    a = world["as"]("a")
    vault = _share(a, "Jeremy")
    resp = _stash_view(anon, vault["token"])
    assert resp.status_code == 404
    assert resp.json() == NOT_FOUND


@pytest.mark.parametrize("suffix", (*VAULT_ROUTES, "/stash"))
def test_reserved_scope_token_with_a_target_is_404_everywhere(world, anon, db, suffix):
    """G2 (and G1 for the vault routes): a 'list'-scope row, the reserved
    binder scope, that names a real stash in target_id must not read it
    through the stash route, nor the vault. Only the scope check stops it:
    target_id is set and the stash exists."""
    db.execute(
        text(
            "INSERT INTO shares (tenant_id, token, scope, target_id, name) "
            "VALUES (:t, 'bl209-list-scope-token', 'list', :s, 'x')"
        ),
        {"t": world["ta"], "s": world["trade"]["id"]},
    )
    db.commit()
    resp = anon.get(f"/api/shared/bl209-list-scope-token{suffix}")
    assert resp.status_code == 404
    assert resp.json() == NOT_FOUND


def test_stash_token_reads_only_its_own_stash(world, anon):
    """G4 + G5: the Trade token never returns Keep's rows (same tenant) or
    tenant B's, whatever the query string says."""
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["trade"]["id"])
    for query in (
        "",
        f"?stash_id={world['keep']['id']}",
        f"?target_id={world['b_binder']['id']}",
    ):
        body = anon.get(f"/api/shared/{share['token']}/stash{query}").json()
        assert body["stash"]["name"] == "Trade"
        assert {r["variant_id"] for r in body["rows"]} == {world["v4"], world["v5"]}
        blob = json.dumps(body)
        assert "Keep" not in blob and "Never trade" not in blob
        assert "B Binder" not in blob

    b = world["as"]("b")
    b_share = _share(b, "Bee", world["b_binder"]["id"])
    b_body = _stash_view(anon, b_share["token"]).json()
    assert b_body["stash"]["name"] == "B Binder"
    assert [(r["variant_id"], r["quantity"]) for r in b_body["rows"]] == [
        (world["v4"], 1)
    ]


def test_stash_view_carries_no_owner_or_stash_ids(world, anon):
    """Decision 4: no owner id, no stash id, nothing beyond the stash."""
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["trade"]["id"])
    body = _stash_view(anon, share["token"]).json()
    assert set(body["stash"]) == {"name", "description"}
    blob = json.dumps(body)
    for leak in ("tenant", "owner", "stash_id", "target_id", "email", "token"):
        assert leak not in blob
    assert share["token"] not in blob


def test_dead_links_are_indistinguishable(world, anon, db):
    """Decision 6: revoked, unknown and deleted-stash tokens give the same
    404 status and body. Covers G6 (the share row is revoked by the delete)
    alongside the end-to-end 404."""
    a = world["as"]("a")
    revoked = _share(a, "Jeremy", world["trade"]["id"])
    assert a.delete(f"/api/shares/{revoked['id']}").status_code == 204
    doomed = _share(a, "Jeremy", world["keep"]["id"])
    assert a.delete(f"/api/stashes/{world['keep']['id']}").status_code == 204

    revoked_at = db.execute(
        text("SELECT revoked_at FROM shares WHERE id = :id"), {"id": doomed["id"]}
    ).scalar_one()
    assert revoked_at is not None  # G6: revoked in the delete's transaction

    answers = [
        _stash_view(anon, revoked["token"]),
        _stash_view(anon, "no-such-token-at-all"),
        _stash_view(anon, doomed["token"]),
    ]
    assert {r.status_code for r in answers} == {404}
    assert {r.text for r in answers} == {json.dumps(NOT_FOUND, separators=(",", ":"))}


def test_share_outliving_its_stash_is_404(world, anon, db):
    """G3: a stash share left active (bypassing the delete's revoke, as a
    bug or a partial restore could) whose stash is gone still reads as a
    dead link, with the same body."""
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["keep"]["id"])
    assert a.delete(f"/api/stashes/{world['keep']['id']}").status_code == 204
    db.execute(
        text("UPDATE shares SET revoked_at = NULL WHERE id = :id"), {"id": share["id"]}
    )
    db.commit()
    resp = _stash_view(anon, share["token"])
    assert resp.status_code == 404
    assert resp.json() == NOT_FOUND
    # ... and the owner's list leaves it out (not a live link).
    assert share["id"] not in [s["id"] for s in a.get("/api/shares").json()]


def test_rotate_kills_the_old_stash_token(world, anon):
    """G13: the old token 404s at once; name and stash survive."""
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["trade"]["id"])
    rotated = a.post(f"/api/shares/{share['id']}/rotate").json()
    assert rotated["token"] != share["token"]
    assert (rotated["name"], rotated["target_id"], rotated["stash_name"]) == (
        "Jeremy",
        world["trade"]["id"],
        "Trade",
    )
    assert _stash_view(anon, share["token"]).status_code == 404
    assert _stash_view(anon, rotated["token"]).status_code == 200


# ---------------------------------------------------------------------------
# Owner side
# ---------------------------------------------------------------------------


def test_one_active_link_per_stash(world):
    """G8: a second create for the same stash is 409 (as the vault's); the
    vault link and another stash's link are separate targets."""
    a = world["as"]("a")
    _share(a, "Jeremy", world["trade"]["id"])
    dup = a.post(
        "/api/shares", json={"name": "Again", "stash_id": world["trade"]["id"]}
    )
    assert dup.status_code == 409
    _share(a, "Jeremy")  # the vault link is its own target
    _share(a, "Jeremy", world["keep"]["id"])  # so is another stash


def test_unique_index_backs_the_stash_precheck(world, db):
    """G8 at the database: a second active stash row for the same stash
    breaks uq_shares_one_active_per_target even without the pre-check."""
    a = world["as"]("a")
    _share(a, "Jeremy", world["trade"]["id"])
    with pytest.raises(Exception, match="uq_shares_one_active_per_target"):
        db.execute(
            text(
                "INSERT INTO shares (tenant_id, token, scope, target_id, name) "
                "VALUES (:t, 'bl209-dup-token', 'stash', :s, 'x')"
            ),
            {"t": world["ta"], "s": world["trade"]["id"]},
        )
    db.rollback()


def test_revoke_then_recreate_stash_link(world, anon):
    a = world["as"]("a")
    first = _share(a, "Jeremy", world["trade"]["id"])
    assert a.delete(f"/api/shares/{first['id']}").status_code == 204
    second = _share(a, "Jay", world["trade"]["id"])
    assert second["token"] != first["token"]
    assert _stash_view(anon, second["token"]).json()["share_name"] == "Jay"


def test_create_on_another_tenants_stash_is_404(world, db):
    """G7: tenant A naming tenant B's stash id gets 404 and no row."""
    a = world["as"]("a")
    resp = a.post(
        "/api/shares", json={"name": "Thief", "stash_id": world["b_binder"]["id"]}
    )
    assert resp.status_code == 404
    assert (
        db.execute(
            text("SELECT count(*) FROM shares WHERE tenant_id = :t"),
            {"t": world["ta"]},
        ).scalar_one()
        == 0
    )
    missing = a.post("/api/shares", json={"name": "x", "stash_id": 2_000_000_000})
    assert missing.status_code == 404


def test_create_validates_the_share_name(world):
    a = world["as"]("a")
    sid = world["trade"]["id"]
    for bad in ("", "   ", "x" * 31, "a\x00b"):
        resp = a.post("/api/shares", json={"name": bad, "stash_id": sid})
        assert resp.status_code == 422, bad


def test_rename_on_a_stash_share_is_refused(world, anon):
    """G9: the stash link's share name is fixed at creation."""
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["trade"]["id"])
    resp = a.patch(f"/api/shares/{share['id']}", json={"name": "Other"})
    assert resp.status_code == 409
    assert resp.json() == {"detail": "share_name_fixed"}
    assert _stash_view(anon, share["token"]).json()["share_name"] == "Jeremy"
    # The vault share keeps its rename.
    vault = _share(a, "Jeremy")
    assert (
        a.patch(f"/api/shares/{vault['id']}", json={"name": "J"}).json()["name"] == "J"
    )


def test_owner_list_vault_first_then_stashes_in_creation_order(world):
    a = world["as"]("a")
    keep_share = _share(a, "Jeremy", world["keep"]["id"])
    trade_share = _share(a, "Jeremy", world["trade"]["id"])
    vault = _share(a, "Jeremy")
    listed = a.get("/api/shares").json()
    assert [s["id"] for s in listed] == [
        vault["id"],
        trade_share["id"],
        keep_share["id"],
    ]
    assert [(s["scope"], s["target_id"], s["stash_name"]) for s in listed] == [
        ("inventory", None, None),
        ("stash", world["trade"]["id"], "Trade"),
        ("stash", world["keep"]["id"], "Keep"),
    ]
    assert set(listed[0]) == {
        "id",
        "name",
        "scope",
        "token",
        "created_at",
        "revoked",
        "target_id",
        "stash_name",
    }
    # Revoked links leave the list; tenant B sees none of A's.
    a.delete(f"/api/shares/{keep_share['id']}")
    assert keep_share["id"] not in [s["id"] for s in a.get("/api/shares").json()]
    b = world["as"]("b")
    assert b.get("/api/shares").json() == []


# ---------------------------------------------------------------------------
# The vault link stays stash-free
# ---------------------------------------------------------------------------


def test_vault_share_responses_carry_no_stash_fields(world, anon):
    """G10 + decision 5: with stashes, descriptions and a live stash link
    present, no vault-share response names a stash, its id, its description
    or an in-stash count."""
    a = world["as"]("a")
    _share(a, "Jeremy", world["trade"]["id"])
    vault = _share(a, "Jeremy")
    token = vault["token"]

    resolved = anon.get(f"/api/shared/{token}")
    assert resolved.status_code == 200
    assert resolved.json() == {"name": "Jeremy", "scope": "inventory"}

    quantities = anon.get(f"/api/shared/{token}/quantities")
    assert quantities.status_code == 200
    for row in quantities.json():
        assert set(row) == {"variant_id", "quantity"}
    # Owned stays owned: stashed copies are counted, never split out.
    by_variant = {r["variant_id"]: r["quantity"] for r in quantities.json()}
    assert by_variant == {world["v1"]: 3, world["v4"]: 2, world["v5"]: 1}

    limits = anon.get(f"/api/shared/{token}/limits")
    assert limits.status_code == 200
    assert limits.json() == a.get("/api/settings/limits").json()

    blob = " ".join(r.text for r in (resolved, quantities, limits)).lower()
    for leak in ("stash", "trade", "keep", "for the lgs", "never trade", "target"):
        assert leak not in blob


# ---------------------------------------------------------------------------
# Rate limit and the choke point
# ---------------------------------------------------------------------------


def test_stash_reads_share_the_vault_read_rate_limit(world, anon):
    """G11: the real limiter, not a stub -- a client that spent its 300
    shared reads (on any share) gets 429 on the stash route too, with
    Retry-After; the budget is the one vault reads use."""
    a = world["as"]("a")
    share = _share(a, "Jeremy", world["trade"]["id"])
    key = rate_limit.client_ip_key("testclient")
    for _ in range(300):
        assert (
            rate_limit.check_tenant_rate_limit(
                "shared_read", key, max_calls=300, window_seconds=3600
            )
            is None
        )
    limited = _stash_view(anon, share["token"])
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0


def _shared_routes():
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/shared/"):
            yield route
        elif hasattr(route, "effective_route_contexts"):
            for ctx in route.effective_route_contexts():
                if ctx.path.startswith("/api/shared/"):
                    yield ctx


def test_every_shared_route_declares_exactly_one_scope_gate():
    """G12: the choke point holds structurally. A new /api/shared route on
    get_shared_db directly (no scope gate) would read the owner's whole
    tenant for any token; this fails it."""
    gates = {"get_shared_inventory_db", "get_shared_stash"}
    routes = list(_shared_routes())
    assert len(routes) == 4
    for route in routes:
        direct = {
            getattr(d.call, "__name__", repr(d.call))
            for d in route.dependant.dependencies
        }
        assert len(direct & gates) == 1, (route.path, direct)
        assert "get_shared_db" not in direct, route.path
