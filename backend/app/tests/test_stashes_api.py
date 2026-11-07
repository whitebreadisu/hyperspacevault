"""BL-344 slice 1: stashes -- named places for owned copies.

Covers the model invariant (service 409 + the Postgres trigger backstop), the
decrease clamp, CRUD, the PUT split, RLS isolation, import impacts, account
deletion and the share view. Every test runs as a throwaway tenant that
auto-provisions on first request; tenant #1's shared fixture data is never
touched.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_stashes_api.py -v
"""

import json
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

from app.db_url import sa_url
from app.main import app
from app.tests.conftest import delete_provisioned_identity

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

UID = "bl344-tenant-a"
EMAIL = "bl344-a@example.com"
OTHER_UID = "bl344-tenant-b"
OTHER_EMAIL = "bl344-b@example.com"


def _variant(db, swuapi_id: str) -> int:
    return db.execute(
        text("SELECT id FROM card_variants WHERE swuapi_id = :s"), {"s": swuapi_id}
    ).scalar_one()


@pytest.fixture
def tc(make_client, db):
    """A client for a fresh throwaway tenant, cleaned up afterwards."""
    client = make_client(UID, EMAIL)
    client.get("/api/stashes")  # provisions the tenant
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


def _own(db, tenant_id: int, variant_id: int, qty: int) -> None:
    """Set the tenant's owned quantity directly (admin connection)."""
    db.execute(
        text(
            "INSERT INTO inventory (tenant_id, variant_id, quantity) "
            "VALUES (:t, :v, :q) ON CONFLICT (tenant_id, variant_id) "
            "DO UPDATE SET quantity = :q"
        ),
        {"t": tenant_id, "v": variant_id, "q": qty},
    )
    db.commit()


def _stash(client, name="Binder", **extra) -> dict:
    resp = client.post("/api/stashes", json={"name": name, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _split(client, variant_id: int, allocations: list[tuple[int, int]]):
    return client.put(
        f"/api/stashes/variants/{variant_id}",
        json={"allocations": [{"stash_id": s, "quantity": q} for s, q in allocations]},
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


class TestCrud:
    def test_create_list_and_shape(self, tc):
        assert tc.get("/api/stashes").json() == []
        created = _stash(tc, "  Trade Binder  ", description="for the LGS")
        assert created["name"] == "Trade Binder"
        assert created["description"] == "for the LGS"
        assert created["copies"] == 0
        assert set(created) == {"id", "name", "description", "created_at", "copies"}
        second = _stash(tc, "Deck Box")
        listed = tc.get("/api/stashes").json()
        assert [s["id"] for s in listed] == [created["id"], second["id"]]

    def test_duplicate_name_is_case_insensitive(self, tc):
        _stash(tc, "Binder")
        resp = tc.post("/api/stashes", json={"name": "bInDeR"})
        assert resp.status_code == 409
        assert resp.json()["detail"] == "duplicate_name"

    @pytest.mark.parametrize(
        "payload",
        [
            {"name": ""},
            {"name": "   "},
            {"name": "x" * 41},
            {"name": "ok", "description": "d" * 281},
        ],
    )
    def test_validation_422(self, tc, payload):
        assert tc.post("/api/stashes", json=payload).status_code == 422

    def test_name_limit_40_accepted(self, tc):
        assert _stash(tc, "x" * 40)["name"] == "x" * 40

    def test_fifty_stash_limit(self, tc):
        for i in range(50):
            _stash(tc, f"Stash {i}")
        resp = tc.post("/api/stashes", json={"name": "One too many"})
        assert resp.status_code == 409
        assert resp.json()["detail"] == "stash_limit"

    def test_patch_name_and_description(self, tc):
        s = _stash(tc, "Old", description="was")
        resp = tc.patch(f"/api/stashes/{s['id']}", json={"name": "New"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "New"
        assert resp.json()["description"] == "was"  # untouched
        resp = tc.patch(f"/api/stashes/{s['id']}", json={"description": None})
        assert resp.json()["description"] is None
        assert resp.json()["name"] == "New"

    def test_patch_errors(self, tc):
        a = _stash(tc, "A")
        _stash(tc, "B")
        assert (
            tc.patch(f"/api/stashes/{a['id']}", json={"name": "b"}).status_code == 409
        )
        # Renaming to its own name differently cased is allowed.
        assert (
            tc.patch(f"/api/stashes/{a['id']}", json={"name": "a"}).status_code == 200
        )
        assert tc.patch(f"/api/stashes/{a['id']}", json={"name": ""}).status_code == 422
        assert (
            tc.patch(f"/api/stashes/{a['id']}", json={"name": None}).status_code == 422
        )
        assert tc.patch("/api/stashes/99999999", json={"name": "z"}).status_code == 404

    def test_delete_returns_copies_to_vault(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 3)
        s = _stash(tc)
        assert _split(tc, v1, [(s["id"], 2)]).status_code == 200
        assert tc.get("/api/stashes").json()[0]["copies"] == 2
        assert tc.delete(f"/api/stashes/{s['id']}").status_code == 204
        assert tc.get("/api/stashes").json() == []
        assert tc.get("/api/stashes/items").json() == []
        owned = {
            r["variant_id"]: r["quantity"]
            for r in tc.get("/api/inventory/quantities").json()
        }
        assert owned[v1] == 3  # owned unchanged
        assert tc.delete(f"/api/stashes/{s['id']}").status_code == 404

    def test_unverified_email_cannot_write_but_can_read(self, make_client, db):
        client = make_client(UID, EMAIL, email_verified=False)
        try:
            assert client.get("/api/stashes").status_code == 200
            assert client.get("/api/stashes/items").status_code == 200
            assert client.post("/api/stashes", json={"name": "x"}).status_code == 403
            assert client.patch("/api/stashes/1", json={"name": "x"}).status_code == 403
            assert client.delete("/api/stashes/1").status_code == 403
            assert _split(client, 1, []).status_code == 403
        finally:
            delete_provisioned_identity(db, UID)

    def test_requires_auth(self):
        anon = TestClient(app)
        # No identity override is installed here (no make_client fixture), so
        # the dependency rejects the headerless call.
        assert anon.get("/api/stashes").status_code == 401
        assert anon.get("/api/stashes/items").status_code == 401


# ---------------------------------------------------------------------------
# PUT split
# ---------------------------------------------------------------------------


class TestSplit:
    def test_replace_semantics_and_zero_rows_removed(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 5)
        a, b = _stash(tc, "A"), _stash(tc, "B")
        resp = _split(tc, v1, [(a["id"], 2), (b["id"], 3)])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "variant_id": v1,
            "owned": 5,
            "allocations": [
                {"stash_id": a["id"], "quantity": 2},
                {"stash_id": b["id"], "quantity": 3},
            ],
        }
        # Omitted stash = 0; explicit zero stores no row.
        resp = _split(tc, v1, [(b["id"], 1), (a["id"], 0)])
        assert resp.json()["allocations"] == [{"stash_id": b["id"], "quantity": 1}]
        items = tc.get("/api/stashes/items").json()
        assert items == [{"stash_id": b["id"], "variant_id": v1, "quantity": 1}]
        # Empty allocations clears the printing entirely.
        assert _split(tc, v1, []).json()["allocations"] == []
        assert tc.get("/api/stashes/items").json() == []

    def test_other_printings_untouched(self, tc, db, tenant_id, v1, v2):
        _own(db, tenant_id, v1, 2)
        _own(db, tenant_id, v2, 2)
        s = _stash(tc)
        _split(tc, v1, [(s["id"], 2)])
        _split(tc, v2, [(s["id"], 1)])
        _split(tc, v1, [])
        assert tc.get("/api/stashes/items").json() == [
            {"stash_id": s["id"], "variant_id": v2, "quantity": 1}
        ]

    def test_exceeds_owned_409(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 2)
        a, b = _stash(tc, "A"), _stash(tc, "B")
        resp = _split(tc, v1, [(a["id"], 2), (b["id"], 1)])
        assert resp.status_code == 409
        assert resp.json()["detail"] == "exceeds_owned"
        assert tc.get("/api/stashes/items").json() == []

    def test_unowned_printing_cannot_be_stashed(self, tc, v2):
        s = _stash(tc)
        assert _split(tc, v2, [(s["id"], 1)]).json()["detail"] == "exceeds_owned"

    def test_unknown_variant_and_stash_404(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 1)
        s = _stash(tc)
        assert _split(tc, 99999999, [(s["id"], 1)]).status_code == 404
        assert _split(tc, v1, [(99999999, 1)]).status_code == 404

    def test_negative_and_duplicate_422(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 3)
        s = _stash(tc)
        assert _split(tc, v1, [(s["id"], -1)]).status_code == 422
        assert _split(tc, v1, [(s["id"], 1), (s["id"], 1)]).status_code == 422

    def test_other_tenants_stash_is_404_and_invisible(
        self, tc, make_client, db, tenant_id, v1
    ):
        _own(db, tenant_id, v1, 2)
        mine = _stash(tc, "Mine")
        _split(tc, v1, [(mine["id"], 1)])
        other = make_client(OTHER_UID, OTHER_EMAIL)
        try:
            assert other.get("/api/stashes").json() == []
            assert other.get("/api/stashes/items").json() == []
            other_tenant = db.execute(
                text("SELECT tenant_id FROM users WHERE firebase_uid = :u"),
                {"u": OTHER_UID},
            ).scalar_one()
            _own(db, other_tenant, v1, 5)
            # Their stash id, my printing -> 404 (not 409, not a leak).
            assert _split(other, v1, [(mine["id"], 1)]).status_code == 404
            assert (
                other.patch(
                    f"/api/stashes/{mine['id']}", json={"name": "x"}
                ).status_code
                == 404
            )
            assert other.delete(f"/api/stashes/{mine['id']}").status_code == 404
            # Same name is fine across tenants.
            assert other.post("/api/stashes", json={"name": "Mine"}).status_code == 201
        finally:
            delete_provisioned_identity(db, OTHER_UID)


# ---------------------------------------------------------------------------
# The invariant: service-level and Postgres backstop
# ---------------------------------------------------------------------------


class TestInvariantTriggers:
    def test_direct_over_allocation_insert_is_rejected(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 2)
        s = _stash(tc)
        db.execute(
            text(
                "INSERT INTO stash_items (stash_id, tenant_id, variant_id, quantity) "
                "VALUES (:s, :t, :v, 3)"
            ),
            {"s": s["id"], "t": tenant_id, "v": v1},
        )
        with pytest.raises(DBAPIError, match="stash_invariant"):
            db.commit()
        db.rollback()

    def test_direct_update_over_allocation_is_rejected(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 2)
        s = _stash(tc)
        assert _split(tc, v1, [(s["id"], 2)]).status_code == 200
        db.execute(
            text("UPDATE stash_items SET quantity = 3 WHERE stash_id = :s"),
            {"s": s["id"]},
        )
        with pytest.raises(DBAPIError, match="stash_invariant"):
            db.commit()
        db.rollback()

    def test_inventory_update_below_stashed_is_rejected(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 3)
        s = _stash(tc)
        assert _split(tc, v1, [(s["id"], 2)]).status_code == 200
        db.execute(
            text(
                "UPDATE inventory SET quantity = 1 WHERE tenant_id = :t AND variant_id = :v"
            ),
            {"t": tenant_id, "v": v1},
        )
        with pytest.raises(DBAPIError, match="stash_invariant"):
            db.commit()
        db.rollback()

    def test_inventory_delete_below_stashed_is_rejected(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 3)
        s = _stash(tc)
        assert _split(tc, v1, [(s["id"], 1)]).status_code == 200
        db.execute(
            text("DELETE FROM inventory WHERE tenant_id = :t AND variant_id = :v"),
            {"t": tenant_id, "v": v1},
        )
        with pytest.raises(DBAPIError, match="stash_invariant"):
            db.commit()
        db.rollback()

    def test_lowering_to_exactly_stashed_and_same_txn_fixups_pass(
        self, tc, db, tenant_id, v1
    ):
        _own(db, tenant_id, v1, 3)
        s = _stash(tc)
        assert _split(tc, v1, [(s["id"], 2)]).status_code == 200
        _own(db, tenant_id, v1, 2)  # exactly the stashed total: fine
        # Deferred: stash and inventory may both shrink inside one transaction.
        db.execute(
            text(
                "UPDATE inventory SET quantity = 0 WHERE tenant_id = :t AND variant_id = :v"
            ),
            {"t": tenant_id, "v": v1},
        )
        db.execute(text("DELETE FROM stash_items WHERE stash_id = :s"), {"s": s["id"]})
        db.commit()


# ---------------------------------------------------------------------------
# Decrease clamp
# ---------------------------------------------------------------------------


class TestDecreaseClamp:
    def _setup(self, tc, db, tenant_id, v1, owned=3, stashed=2):
        _own(db, tenant_id, v1, owned)
        s = _stash(tc)
        assert _split(tc, v1, [(s["id"], stashed)]).status_code == 200
        return s

    def test_decrement_stops_at_stashed_total(self, tc, db, tenant_id, v1):
        self._setup(tc, db, tenant_id, v1)
        assert tc.post(f"/api/inventory/{v1}/decrement").json()["quantity"] == 2
        # Already at the floor: stays, and reports the stored quantity.
        assert tc.post(f"/api/inventory/{v1}/decrement").json()["quantity"] == 2
        stored = db.execute(
            text(
                "SELECT quantity FROM inventory WHERE tenant_id = :t AND variant_id = :v"
            ),
            {"t": tenant_id, "v": v1},
        ).scalar_one()
        assert stored == 2

    def test_adjust_clamps_and_reports_stored_quantity(self, tc, db, tenant_id, v1):
        self._setup(tc, db, tenant_id, v1)
        resp = tc.post(f"/api/inventory/{v1}/adjust", json={"delta": -5})
        assert resp.status_code == 200
        body = resp.json()
        assert body["quantity"] == 2
        assert body["applied"] == -1
        assert body["requested"] == -5
        # At the floor: a further decrease is a no-op.
        body = tc.post(f"/api/inventory/{v1}/adjust", json={"delta": -1}).json()
        assert body["quantity"] == 2 and body["applied"] == 0

    def test_increase_unaffected_and_unstashed_still_reaches_zero(
        self, tc, db, tenant_id, v1, v2
    ):
        self._setup(tc, db, tenant_id, v1, owned=2, stashed=2)
        assert (
            tc.post(f"/api/inventory/{v1}/adjust", json={"delta": 1}).json()["quantity"]
            == 3
        )
        _own(db, tenant_id, v2, 1)
        assert tc.post(f"/api/inventory/{v2}/decrement").json()["quantity"] == 0

    def test_freeing_copies_lowers_the_floor(self, tc, db, tenant_id, v1):
        s = self._setup(tc, db, tenant_id, v1)
        assert _split(tc, v1, [(s["id"], 0)]).status_code == 200
        assert (
            tc.post(f"/api/inventory/{v1}/adjust", json={"delta": -3}).json()[
                "quantity"
            ]
            == 0
        )


# ---------------------------------------------------------------------------
# Import impacts
# ---------------------------------------------------------------------------


_AUTO = object()


def _import(client, cards, *, mode, stage, cap_handling="add_above", token=_AUTO):
    """POST an import. A commit carries the preview's stash_impacts_token:
    by default this helper previews first and passes it back (pass
    token=None to omit it, or a string to send a specific one)."""
    if stage == "commit" and token is _AUTO:
        token = _import(
            client, cards, mode=mode, stage="dry_run", cap_handling=cap_handling
        ).json()["stash_impacts_token"]
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
    return client.post(
        "/api/inventory/import",
        files={"file": ("inv.json", doc.encode())},
        data={
            "mode": mode,
            "cap_handling": cap_handling,
            "stage": stage,
            **({"stash_impacts_token": token} if token is not None else {}),
        },
    )


class TestImport:
    def _two_stashes(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 5)
        old, new = _stash(tc, "Old"), _stash(tc, "New")
        assert _split(tc, v1, [(old["id"], 2), (new["id"], 2)]).status_code == 200
        return old, new

    def test_no_stashes_means_empty_impacts(self, tc, db, tenant_id, v1):
        _own(db, tenant_id, v1, 5)
        resp = _import(
            tc,
            [{"swuapi_uuid": "test-v0004", "quantity": 1}],
            mode="replace",
            stage="dry_run",
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["stash_impacts"] == []

    def test_replace_preview_lists_newest_first_and_commit_applies_exactly(
        self, tc, db, tenant_id, v1
    ):
        old, new = self._two_stashes(tc, db, tenant_id, v1)
        cards = [{"swuapi_uuid": "test-v0004", "quantity": 3}]
        preview = _import(tc, cards, mode="replace", stage="dry_run").json()
        # Owned 5 -> 3 with 4 stashed: take 1, from the newest stash.
        assert preview["stash_impacts"] == [
            {
                "stash_id": new["id"],
                "stash_name": "New",
                "variant_id": v1,
                "card_name": "Test Trooper Beta",
                "printing_label": "Standard · SOR 9004",
                "before": 2,
                "after": 1,
            }
        ]
        # The preview wrote nothing.
        assert {
            i["stash_id"]: i["quantity"] for i in tc.get("/api/stashes/items").json()
        } == {
            old["id"]: 2,
            new["id"]: 2,
        }
        committed = _import(tc, cards, mode="replace", stage="commit")
        assert committed.status_code == 200, committed.text
        assert committed.json()["stash_impacts"] == preview["stash_impacts"]
        assert {
            i["stash_id"]: i["quantity"] for i in tc.get("/api/stashes/items").json()
        } == {
            old["id"]: 2,
            new["id"]: 1,
        }
        owned = {
            r["variant_id"]: r["quantity"]
            for r in tc.get("/api/inventory/quantities").json()
        }
        assert owned[v1] == 3

    def test_deep_cut_spills_to_older_stash_and_drops_empty_rows(
        self, tc, db, tenant_id, v1
    ):
        old, new = self._two_stashes(tc, db, tenant_id, v1)
        cards = [{"swuapi_uuid": "test-v0004", "quantity": 1}]
        impacts = _import(tc, cards, mode="replace", stage="commit").json()[
            "stash_impacts"
        ]
        assert [(i["stash_name"], i["before"], i["after"]) for i in impacts] == [
            ("New", 2, 0),
            ("Old", 2, 1),
        ]
        items = tc.get("/api/stashes/items").json()
        assert items == [{"stash_id": old["id"], "variant_id": v1, "quantity": 1}]

    def test_replace_all_removal_cuts_every_stash_of_the_printing(
        self, tc, db, tenant_id, v1, v2
    ):
        old, new = self._two_stashes(tc, db, tenant_id, v1)
        _own(db, tenant_id, v2, 1)
        cards = [{"swuapi_uuid": "test-v0005", "quantity": 1}]
        preview = _import(tc, cards, mode="replace_all", stage="dry_run").json()
        assert [(i["stash_name"], i["after"]) for i in preview["stash_impacts"]] == [
            ("New", 0),
            ("Old", 0),
        ]
        assert _import(tc, cards, mode="replace_all", stage="commit").status_code == 200
        assert tc.get("/api/stashes/items").json() == []
        assert len(tc.get("/api/stashes").json()) == 2  # stashes themselves stay

    def test_merge_add_and_covered_replace_never_cut(self, tc, db, tenant_id, v1):
        old, new = self._two_stashes(tc, db, tenant_id, v1)
        cards = [{"swuapi_uuid": "test-v0004", "quantity": 9}]
        assert (
            _import(tc, cards, mode="merge_add", stage="dry_run").json()[
                "stash_impacts"
            ]
            == []
        )
        # replace to a quantity that still covers the stashed total.
        cards = [{"swuapi_uuid": "test-v0004", "quantity": 4}]
        assert (
            _import(tc, cards, mode="replace", stage="commit").json()["stash_impacts"]
            == []
        )
        assert len(tc.get("/api/stashes/items").json()) == 2


# ---------------------------------------------------------------------------
# Account deletion and the share view
# ---------------------------------------------------------------------------


def test_account_deletion_removes_stash_rows(db, make_client, v1):
    from app.auth import require_recent_auth

    uid, email = "bl344-doomed-uid", "bl344-doomed@example.com"
    doomed = make_client(uid, email)
    app.dependency_overrides[require_recent_auth] = lambda: None
    try:
        doomed.get("/api/stashes")
        tenant = db.execute(
            text("SELECT tenant_id FROM users WHERE firebase_uid = :u"), {"u": uid}
        ).scalar_one()
        _own(db, tenant, v1, 2)
        s = _stash(doomed, "Doomed")
        assert _split(doomed, v1, [(s["id"], 2)]).status_code == 200
        assert doomed.delete("/api/account").status_code == 204
        for table in ("stashes", "stash_items"):
            assert (
                db.execute(
                    text(f"SELECT count(*) FROM {table} WHERE tenant_id = :t"),
                    {"t": tenant},
                ).scalar_one()
                == 0
            )
    finally:
        app.dependency_overrides.pop(require_recent_auth, None)
        delete_provisioned_identity(db, uid)


def test_share_view_returns_no_stash_data(tc, db, tenant_id, v1):
    _own(db, tenant_id, v1, 3)
    s = _stash(tc, "Secret Binder")
    assert _split(tc, v1, [(s["id"], 2)]).status_code == 200
    share = tc.post("/api/shares", json={"name": "Trade stock"}).json()
    anon = TestClient(app)
    token = share["token"]
    seen = []
    for suffix in ("", "/quantities", "/limits"):
        resp = anon.get(f"/api/shared/{token}{suffix}")
        assert resp.status_code == 200, resp.text
        seen.append(resp.text)
    blob = " ".join(seen).lower()
    assert "stash" not in blob
    assert "secret binder" not in blob
    # Owned is shown as owned (stashed copies are still the owner's).
    quantities = {r["variant_id"]: r["quantity"] for r in json.loads(seen[1])}
    assert quantities[v1] == 3
    # No stash route exists under the share prefix.
    assert anon.get(f"/api/shared/{token}/stashes").status_code in (404, 405)


# ---------------------------------------------------------------------------
# RLS at the database
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def app_db():
    engine = create_engine(sa_url(os.environ["APP_DATABASE_URL"]))
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def test_rls_enabled_and_policies(db):
    for table in ("stashes", "stash_items"):
        row = db.execute(
            text(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relname = :t"
            ),
            {"t": table},
        ).first()
        assert row == (True, True), table
        assert (
            db.execute(
                text(
                    "SELECT count(*) FROM pg_policies "
                    "WHERE tablename = :t AND policyname = 'tenant_isolation'"
                ),
                {"t": table},
            ).scalar_one()
            == 1
        )


def test_swu_app_sees_only_its_own_tenants_rows(tc, db, app_db, tenant_id, v1):
    _own(db, tenant_id, v1, 2)
    s = _stash(tc, "Mine")
    assert _split(tc, v1, [(s["id"], 1)]).status_code == 200

    def counts(tenant: str):
        app_db.rollback()
        app_db.execute(
            text("SELECT set_config('app.current_tenant_id', :t, false)"), {"t": tenant}
        )
        out = tuple(
            app_db.execute(text(f"SELECT count(*) FROM {t}")).scalar_one()
            for t in ("stashes", "stash_items")
        )
        app_db.rollback()
        return out

    assert counts("") == (0, 0)  # no tenant: nothing
    assert counts(str(tenant_id)) == (1, 1)
    assert counts("999999999") == (0, 0)  # another tenant: nothing
