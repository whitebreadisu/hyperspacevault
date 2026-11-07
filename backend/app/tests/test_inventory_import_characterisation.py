"""Characterisation of POST /api/inventory/import's computed outcome: the
ImportReport and the WritePlan it is applied from, in both stages, for
every mode and cap handling, on one fixture file that carries resolved,
fallback, mismatch, ambiguous, unresolved, malformed, raw-duplicate and
cross-scheme-duplicate rows, plus owned rows a `replace_all` removes.

Pins three invariants of `services/inventory_import.compute_import`:
- the dry-run report equals the commit report apart from `stage` and
  `committed` (one computation backs both stages);
- the plan holds exactly each resolved row's `resulting_quantity` plus each
  `replace_all` removal at 0, and the commit writes exactly that plan;
- the keep-limit lookup issues at most one tenant_card_limits query per
  (type_category, limit_bucket) cell, however many rows share that cell.

The WritePlan is not on the wire, so a spy wraps `compute_import` (looked up
through the service module by the router at call time) and records each
call's report and plan.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_inventory_import_characterisation.py -v
"""

import os
import uuid
from contextlib import contextmanager

import pytest
from sqlalchemy import event, text

from app.services.inventory_import import impacts_token

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

# Card numbers 9861-9872 are unused by every other test module's fixtures; a
# shared triple would make this file's resolution outcomes depend on them.
# (swuapi_id, base_card_number, name, type)
_BASE_CARDS = [
    ("charimp-bc-leader", "9861", "Charimp Leader", "Leader"),
    ("charimp-bc-unit", "9862", "Charimp Unit", "Unit"),
    ("charimp-bc-prestige", "9863", "Charimp Prestige", "Unit"),
    ("charimp-bc-unit2", "9864", "Charimp Unit Two", "Unit"),
    ("charimp-bc-removed", "9865", "Charimp Removed", "Unit"),
    ("charimp-bc-removed2", "9866", "Charimp Removed Two", "Unit"),
    ("charimp-bc-zero", "9867", "Charimp Zero", "Unit"),
]

# key -> (swuapi_id, base swuapi_id, card_number, variant_type)
_VARIANTS = {
    "leader": ("charimp-v-leader", "charimp-bc-leader", "9861", "Standard"),
    "unit_std": ("charimp-v-unit-std", "charimp-bc-unit", "9862", "Standard"),
    "unit_hyp": ("charimp-v-unit-hyp", "charimp-bc-unit", "9872", "Hyperspace"),
    "prestige_1": (
        "charimp-v-prestige-1",
        "charimp-bc-prestige",
        "9863",
        "Serialized Prestige",
    ),
    "prestige_2": (
        "charimp-v-prestige-2",
        "charimp-bc-prestige",
        "9863",
        "Serialized Prestige",
    ),
    "prestige_3": (
        "charimp-v-prestige-3",
        "charimp-bc-prestige",
        "9863",
        "Serialized Prestige",
    ),
    "unit2": ("charimp-v-unit2", "charimp-bc-unit2", "9864", "Standard"),
    "removed": ("charimp-v-removed", "charimp-bc-removed", "9865", "Standard"),
    "removed2": ("charimp-v-removed2", "charimp-bc-removed2", "9866", "Hyperspace"),
    "zero": ("charimp-v-zero", "charimp-bc-zero", "9867", "Standard"),
}

_NAMES = {swuapi_id: name for swuapi_id, _n, name, _t in _BASE_CARDS}


@pytest.fixture(scope="module")
def charimp_catalog(db):
    """variant key -> card_variants.id for the fixture catalog above."""
    sor_id = db.execute(text("SELECT id FROM sets WHERE code = 'SOR'")).scalar()
    base_ids = {}
    for swuapi_id, number, name, card_type in _BASE_CARDS:
        base_ids[swuapi_id] = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, type, rarity, swuapi_id) "
                "VALUES (:set_id, :number, :name, :type, 'Common', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id"
            ),
            {
                "set_id": sor_id,
                "number": number,
                "name": name,
                "type": card_type,
                "swuapi_id": swuapi_id,
            },
        ).scalar()
    variant_ids = {}
    for key, (
        swuapi_id,
        base_swuapi_id,
        card_number,
        variant_type,
    ) in _VARIANTS.items():
        variant_ids[key] = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, 'SOR', :card_number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_ids[base_swuapi_id],
                "variant_type": variant_type,
                "card_number": card_number,
                "swuapi_id": swuapi_id,
            },
        ).scalar()
    db.commit()
    return variant_ids


# Starting inventory for every scenario. unit_hyp has no row (current 0);
# zero has an explicit 0 row, which replace_all never lists as a removal.
# prestige_1 is owned and is a candidate of the ambiguous row: an ambiguous
# row resolves no variant, so replace_all removes prestige_1 like any other
# owned row the file did not resolve.
_SEED_QUANTITIES = {
    "leader": 1,
    "prestige_1": 1,
    "unit_std": 2,
    "unit2": 5,
    "removed": 1,
    "removed2": 2,
    "zero": 0,
}


def _set_quantity(db, tenant_id: int, variant_id: int, quantity: int) -> None:
    db.execute(
        text(
            "INSERT INTO inventory (tenant_id, variant_id, quantity) "
            "VALUES (:tenant_id, :variant_id, :quantity) "
            "ON CONFLICT (tenant_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity"
        ),
        {"tenant_id": tenant_id, "variant_id": variant_id, "quantity": quantity},
    )
    db.commit()


def _quantities(db, tenant_id: int) -> dict[int, int]:
    rows = db.execute(
        text("SELECT variant_id, quantity FROM inventory WHERE tenant_id = :t"),
        {"t": tenant_id},
    ).all()
    return {r.variant_id: r.quantity for r in rows}


@pytest.fixture
def charimp_tenant(db, make_client, charimp_catalog):
    """A throwaway tenant holding _SEED_QUANTITIES and one keep-limit
    override: (standard, Hyperspace) explicitly unlimited, so the
    Hyperspace row reaches the 999 ceiling under trim as well."""
    suffix = uuid.uuid4().hex[:12]
    uid = f"test-charimp-{suffix}"
    email = f"charimp-{suffix}@example.com"
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"),
        {"name": f"Import Characterisation Tenant {suffix}"},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {"uid": uid, "tenant_id": tenant_id, "email": email},
    )
    db.commit()
    client = make_client(uid, email, True)
    try:
        for key, quantity in _SEED_QUANTITIES.items():
            _set_quantity(db, tenant_id, charimp_catalog[key], quantity)
        put = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Hyperspace",
                        "max_quantity": None,
                    }
                ]
            },
        )
        assert put.status_code == 200
        yield client, tenant_id
    finally:
        db.rollback()
        for table in ("inventory", "tenant_card_limits", "tenant_settings"):
            db.execute(
                text(f"DELETE FROM {table} WHERE tenant_id = :t"), {"t": tenant_id}
            )
        db.execute(text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
        db.commit()


# The fixture file. After inventory_io's raw-identity merge (row 10 folds
# into row 5) and the post-resolution cross-scheme fold (row 3 folds into
# row 2), the report shows rows 1, 2, 4, 5, 6, 7, 8, 9.
_FILE_ROWS = [
    "charimp-v-leader,,,,2",  # 1 resolved by uuid
    "charimp-v-unit-std,,,,1",  # 2 resolved by uuid
    ",SOR,9862,Standard,2",  # 3 same variant as row 2, by triple
    "charimp-unknown-uuid,SOR,9872,Hyperspace,1500",  # 4 fallback to triple
    "charimp-v-unit2,SOR,9861,Standard,1",  # 5 uuid wins over a different triple
    ",SOR,9863,Serialized Prestige,1",  # 6 ambiguous triple
    ",SOR,98699,Standard,1",  # 7 unknown triple
    ",SOR,9862,,1",  # 8 incomplete identity
    "charimp-v-leader,,,,abc",  # 9 malformed quantity
    "charimp-v-unit2,,,,2",  # 10 same raw uuid as row 5
]


def _csv_content() -> bytes:
    lines = [
        "# swu-inv-export v1",
        "swuapi_uuid,set_code,card_number,variant_type,quantity",
        *_FILE_ROWS,
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _card(key: str) -> dict:
    swuapi_id, base_swuapi_id, card_number, variant_type = _VARIANTS[key]
    return {
        "swuapi_uuid": swuapi_id,
        "set_code": "SOR",
        "card_number": card_number,
        "variant_type": variant_type,
        "name": _NAMES[base_swuapi_id],
    }


def _resolved(row_number, key, file_q, current, outcome, *, fallback, mismatch):
    resulting, trim_reason, copies_not_added = outcome
    row = {
        "row_number": row_number,
        "status": "resolved",
        "matched_by_fallback": fallback,
        "uuid_triple_mismatch": mismatch,
        "card": _card(key),
        "file_quantity": file_q,
        "current_quantity": current,
        "resulting_quantity": resulting,
        "copies_not_added": copies_not_added,
    }
    if trim_reason is not None:
        row["trim_reason"] = trim_reason
    return row


# (mode, cap_handling) -> outcome (resulting, trim_reason, copies_not_added)
# per resolved report row: leader (current 1, file 2, limit 1), unit_std
# (current 2, file 1+2, limit 3), unit_hyp (current 0, file 1500, no limit),
# unit2 (current 5, file 1+2, limit 3). Ceiling is 999.
_OUTCOMES = {
    ("merge_add", "add_above"): {
        "leader": (3, None, 0),
        "unit_std": (5, None, 0),
        "unit_hyp": (999, "ceiling", 501),
        "unit2": (8, None, 0),
    },
    ("merge_add", "trim"): {
        "leader": (1, "keep_limit", 2),
        "unit_std": (3, "keep_limit", 2),
        "unit_hyp": (999, "ceiling", 501),
        "unit2": (5, "keep_limit", 3),
    },
    ("replace", "add_above"): {
        "leader": (2, None, 0),
        "unit_std": (3, None, 0),
        "unit_hyp": (999, "ceiling", 501),
        "unit2": (3, None, 0),
    },
    ("replace", "trim"): {
        "leader": (1, "keep_limit", 1),
        "unit_std": (3, None, 0),
        "unit_hyp": (999, "ceiling", 501),
        "unit2": (3, None, 0),
    },
}
_OUTCOMES[("replace_all", "add_above")] = _OUTCOMES[("replace", "add_above")]
_OUTCOMES[("replace_all", "trim")] = _OUTCOMES[("replace", "trim")]

_COMBINATIONS = sorted(_OUTCOMES)


def _expected_report(mode: str, cap_handling: str, stage: str) -> dict:
    outcome = _OUTCOMES[(mode, cap_handling)]
    rows = [
        _resolved(1, "leader", 2, 1, outcome["leader"], fallback=False, mismatch=False),
        _resolved(
            2, "unit_std", 3, 2, outcome["unit_std"], fallback=False, mismatch=False
        ),
        _resolved(
            4, "unit_hyp", 1500, 0, outcome["unit_hyp"], fallback=True, mismatch=False
        ),
        _resolved(5, "unit2", 3, 5, outcome["unit2"], fallback=False, mismatch=True),
        {
            "row_number": 6,
            "status": "ambiguous",
            "reason": "ambiguous_triple",
            "candidates": [
                _card("prestige_1"),
                _card("prestige_2"),
                _card("prestige_3"),
            ],
            "card": {
                "set_code": "SOR",
                "card_number": "9863",
                "variant_type": "Serialized Prestige",
            },
            "file_quantity": 1,
        },
        {
            "row_number": 7,
            "status": "unresolved",
            "reason": "unknown_triple",
            "card": {
                "set_code": "SOR",
                "card_number": "98699",
                "variant_type": "Standard",
            },
            "file_quantity": 1,
        },
        {
            "row_number": 8,
            "status": "unresolved",
            "reason": "incomplete_identity",
            "card": {"set_code": "SOR", "card_number": "9862"},
            "file_quantity": 1,
        },
        {
            "row_number": 9,
            "status": "unresolved",
            "reason": "malformed_row",
            "card": {"swuapi_uuid": "charimp-v-leader"},
        },
    ]
    removed = (
        [
            {"card": _card("prestige_1"), "quantity": 1},
            {"card": _card("removed"), "quantity": 1},
            {"card": _card("removed2"), "quantity": 2},
        ]
        if mode == "replace_all"
        else []
    )
    trim_reasons = [trim for _r, trim, _c in outcome.values()]
    return {
        "stage": stage,
        "mode": mode,
        "cap_handling": cap_handling,
        "committed": stage == "commit",
        "totals": {
            "rows": 8,
            "resolved": 4,
            "matched_by_fallback": 1,
            "unresolved": 3,
            "ambiguous": 1,
            "trimmed": trim_reasons.count("keep_limit"),
            "ceiling_clamped": trim_reasons.count("ceiling"),
            "duplicate_rows_merged": 2,
            "unrecognized_columns": [],
            "removed_by_replace_all": len(removed),
        },
        "rows": rows,
        "removed": removed,
        # BL-344: PORTED -- the report gained stash_impacts; this tenant has
        # no stashes, so the characterised behaviour is the empty list.
        "stash_impacts": [],
        "stash_impacts_token": impacts_token([]),
    }


def _expected_plan(mode: str, cap_handling: str, ids: dict) -> dict[int, int]:
    plan = {
        ids[key]: resulting
        for key, (resulting, _t, _c) in _OUTCOMES[(mode, cap_handling)].items()
    }
    if mode == "replace_all":
        plan[ids["prestige_1"]] = 0
        plan[ids["removed"]] = 0
        plan[ids["removed2"]] = 0
    return plan


@pytest.fixture
def compute_spy(monkeypatch):
    """Records (report dump, plan updates) for every compute_import call.
    The dump is taken before the router sets `committed` on a commit."""
    from app.services import inventory_import as service

    calls: list[tuple[dict, dict[int, int]]] = []
    original = service.compute_import

    def _spy(*args, **kwargs):
        report, plan = original(*args, **kwargs)
        calls.append((report.model_dump(), dict(plan.updates)))
        return report, plan

    monkeypatch.setattr(service, "compute_import", _spy)
    return calls


@contextmanager
def _count_limit_queries():
    """Counts statements against tenant_card_limits on the app engine (the
    engine every get_db request session is bound to). Yields a one-item
    list holding the running count."""
    from app.database import app_engine

    counter = [0]

    def _count(_conn, _cursor, statement, *_args):
        if "tenant_card_limits" in statement:
            counter[0] += 1

    event.listen(app_engine, "before_cursor_execute", _count)
    try:
        yield counter
    finally:
        event.remove(app_engine, "before_cursor_execute", _count)


def _post(client, mode, cap_handling, stage):
    return client.post(
        "/api/inventory/import",
        files={"file": ("upload.csv", _csv_content())},
        data={"mode": mode, "cap_handling": cap_handling, "stage": stage},
    )


# Distinct (type_category, limit_bucket) cells among the resolved rows:
# (singleton, Standard), (standard, Standard) shared by unit_std and unit2,
# and (standard, Hyperspace).
_DISTINCT_LIMIT_CELLS = 3


@pytest.mark.parametrize(("mode", "cap_handling"), _COMBINATIONS)
class TestImportReportAndPlan:
    def test_report_and_plan_in_both_stages(
        self, db, charimp_tenant, charimp_catalog, compute_spy, mode, cap_handling
    ):
        client, tenant_id = charimp_tenant
        before = _quantities(db, tenant_id)

        with _count_limit_queries() as dry_limits:
            dry = _post(client, mode, cap_handling, "dry_run")
        assert dry.status_code == 200
        assert dry.json() == _expected_report(mode, cap_handling, "dry_run")
        assert _quantities(db, tenant_id) == before

        with _count_limit_queries() as commit_limits:
            commit = _post(client, mode, cap_handling, "commit")
        assert commit.status_code == 200
        assert commit.json() == _expected_report(mode, cap_handling, "commit")

        expected_plan = _expected_plan(mode, cap_handling, charimp_catalog)
        (dry_report, dry_plan), (commit_report, commit_plan) = compute_spy
        assert dry_plan == expected_plan
        assert commit_plan == expected_plan

        # One computation backs both stages: the reports differ only in the
        # stage label (`committed` is set by the router after the call).
        assert dry_report["stage"] == "dry_run"
        assert commit_report["stage"] == "commit"
        assert dry_report["committed"] is commit_report["committed"] is False
        assert {**dry_report, "stage": None} == {**commit_report, "stage": None}
        dry_wire = {**dry.json(), "stage": None, "committed": None}
        commit_wire = {**commit.json(), "stage": None, "committed": None}
        assert dry_wire == commit_wire

        # The plan is exactly the report's resolved outcomes plus removals at 0.
        id_by_uuid = {_VARIANTS[k][0]: v for k, v in charimp_catalog.items()}
        from_report = {
            id_by_uuid[r["card"]["swuapi_uuid"]]: r["resulting_quantity"]
            for r in commit_report["rows"]
            if r["status"] == "resolved"
        }
        for removed in commit_report["removed"]:
            from_report[id_by_uuid[removed["card"]["swuapi_uuid"]]] = 0
        assert commit_plan == from_report

        # The commit writes exactly the plan and nothing else.
        after = _quantities(db, tenant_id)
        assert after == {**before, **expected_plan}
        assert after[charimp_catalog["zero"]] == 0
        # The owned ambiguous candidate is removed only by replace_all.
        assert after[charimp_catalog["prestige_1"]] == (
            0 if mode == "replace_all" else 1
        )

        # The keep-limit lookup is cached per (type_category, limit_bucket).
        assert dry_limits[0] == _DISTINCT_LIMIT_CELLS
        assert commit_limits[0] == _DISTINCT_LIMIT_CELLS
