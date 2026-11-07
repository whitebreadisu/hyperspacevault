"""DB-free unit tests for the planning pieces of services/inventory_import:
`_plan_rows` (per-row merge/cap and report row), `_replace_all_removals`,
`_cached_limit` (the per-(type_category, limit_bucket) keep-limit cache),
`_totals`, and `compute_import`'s wiring of them over a faked repository.

The end-to-end report and plan, through the endpoint and a real database,
are pinned in test_inventory_import_characterisation.py.

Runs anywhere, no database needed:
    pytest --noconftest app/tests/test_inventory_import_plan.py
"""

from types import SimpleNamespace

import pytest

from app.schemas.inventory_import_schema import ImportRowCard
from app.services import inventory_import as svc
from app.services.inventory_io import ParsedRow, ParseNotes


def _match(
    variant_id,
    *,
    uuid=None,
    number="1",
    variant_type="Standard",
    set_code="SOR",
    name="Card",
    subtitle=None,
    base_type="Unit",
):
    variant = SimpleNamespace(
        id=variant_id,
        swuapi_id=uuid or f"uuid-{variant_id}",
        source_set_code=set_code,
        card_number=number,
        variant_type=variant_type,
    )
    return (variant, name, subtitle, base_type)


def _row(row_number, quantity=1, **identity):
    return ParsedRow(
        row_number=row_number,
        swuapi_uuid=identity.get("uuid"),
        set_code=identity.get("set_code"),
        card_number=identity.get("card_number"),
        variant_type=identity.get("variant_type"),
        quantity=quantity,
        malformed_quantity=quantity is None,
    )


def _resolved(row, match, *, fallback=False, mismatch=False):
    return svc._Resolution(row, "resolved", None, fallback, mismatch, [], match)


class _Limits:
    """A limit_for stand-in: a fixed limit per base_card_type, recording
    every call."""

    def __init__(self, by_type):
        self.by_type = by_type
        self.calls = []

    def __call__(self, base_card_type, variant_type, set_code):
        self.calls.append((base_card_type, variant_type, set_code))
        return self.by_type.get(base_card_type)


class TestPlanRows:
    def test_resolved_row_merge_add_uses_current_and_limit(self):
        match = _match(7, base_type="Unit", variant_type="Hyperspace", set_code="SHD")
        limits = _Limits({"Unit": 3})
        reports, updates = svc._plan_rows(
            [_resolved(_row(1, 2), match, fallback=True)],
            {7: 2},
            limits,
            "merge_add",
            "trim",
        )
        assert limits.calls == [("Unit", "Hyperspace", "SHD")]
        assert updates == {7: 3}
        (report,) = reports
        assert report.status == "resolved"
        assert report.matched_by_fallback is True
        assert report.uuid_triple_mismatch is False
        assert report.file_quantity == 2
        assert report.current_quantity == 2
        assert report.resulting_quantity == 3
        assert report.copies_not_added == 1
        assert report.trim_reason == "keep_limit"
        assert report.card == ImportRowCard(
            swuapi_uuid="uuid-7",
            set_code="SHD",
            card_number="1",
            variant_type="Hyperspace",
            name="Card",
        )

    def test_absent_current_quantity_is_zero(self):
        reports, updates = svc._plan_rows(
            [_resolved(_row(1, 4), _match(9))],
            {},
            _Limits({}),
            "merge_add",
            "add_above",
        )
        assert reports[0].current_quantity == 0
        assert updates == {9: 4}

    @pytest.mark.parametrize(
        ("mode", "cap_handling", "expected"),
        [
            ("merge_add", "add_above", (6, None, 0)),
            ("merge_add", "trim", (5, "keep_limit", 1)),
            ("replace", "add_above", (1, None, 0)),
            ("replace", "trim", (1, None, 0)),
            ("replace_all", "trim", (1, None, 0)),
        ],
    )
    def test_each_mode_and_cap_handling(self, mode, cap_handling, expected):
        """current 5 is above limit 3: merge_add + trim keeps owned stock."""
        reports, updates = svc._plan_rows(
            [_resolved(_row(1, 1), _match(3))],
            {3: 5},
            _Limits({"Unit": 3}),
            mode,
            cap_handling,
        )
        report = reports[0]
        assert (
            report.resulting_quantity,
            report.trim_reason,
            report.copies_not_added,
        ) == expected
        assert updates == {3: expected[0]}

    def test_ceiling_applies_with_no_limit(self):
        reports, updates = svc._plan_rows(
            [_resolved(_row(1, 1500), _match(3))],
            {},
            _Limits({"Unit": None}),
            "merge_add",
            "trim",
        )
        assert updates == {3: 999}
        assert reports[0].trim_reason == "ceiling"
        assert reports[0].copies_not_added == 501

    def test_ambiguous_and_unresolved_rows_are_reported_not_planned(self):
        candidates = [
            _match(11, uuid="c-1", number="5", variant_type="Serialized Prestige"),
            _match(12, uuid="c-2", number="5", variant_type="Serialized Prestige"),
        ]
        ambiguous_row = _row(
            2, 1, set_code="SOR", card_number="5", variant_type="Serialized Prestige"
        )
        unknown_row = _row(3, 2, uuid="nope", set_code="SOR", card_number="8")
        malformed_row = _row(4, None, uuid="u")
        limits = _Limits({})
        reports, updates = svc._plan_rows(
            [
                svc._Resolution(
                    ambiguous_row,
                    "ambiguous",
                    "ambiguous_triple",
                    False,
                    False,
                    candidates,
                    None,
                ),
                svc._Resolution(
                    unknown_row,
                    "unresolved",
                    "incomplete_identity",
                    False,
                    False,
                    [],
                    None,
                ),
                svc._Resolution(
                    malformed_row, "unresolved", "malformed_row", False, False, [], None
                ),
            ],
            {},
            limits,
            "merge_add",
            "trim",
        )
        assert updates == {}
        assert limits.calls == []
        ambiguous, unknown, malformed = reports
        assert ambiguous.status == "ambiguous"
        assert ambiguous.reason == "ambiguous_triple"
        assert [c.swuapi_uuid for c in ambiguous.candidates] == ["c-1", "c-2"]
        assert ambiguous.candidates[0].name == "Card"
        assert ambiguous.card == ImportRowCard(
            set_code="SOR", card_number="5", variant_type="Serialized Prestige"
        )
        assert ambiguous.file_quantity == 1
        assert ambiguous.resulting_quantity is None
        assert unknown.status == "unresolved"
        assert unknown.reason == "incomplete_identity"
        assert unknown.card == ImportRowCard(
            swuapi_uuid="nope", set_code="SOR", card_number="8"
        )
        assert unknown.file_quantity == 2
        assert unknown.matched_by_fallback is None
        assert malformed.reason == "malformed_row"
        assert malformed.file_quantity is None

    def test_ambiguous_row_card_drops_a_file_supplied_uuid(self):
        """An unknown uuid with an ambiguous triple: the row's `card` carries
        the triple only, not the file's uuid (unresolved rows keep it)."""
        row = _row(
            1,
            1,
            uuid="unknown-uuid",
            set_code="SOR",
            card_number="5",
            variant_type="Serialized Prestige",
        )
        reports, _ = svc._plan_rows(
            [
                svc._Resolution(
                    row,
                    "ambiguous",
                    "ambiguous_triple",
                    False,
                    False,
                    [_match(11, uuid="c-1"), _match(12, uuid="c-2")],
                    None,
                )
            ],
            {},
            _Limits({}),
            "merge_add",
            "add_above",
        )
        assert reports[0].card == ImportRowCard(
            set_code="SOR", card_number="5", variant_type="Serialized Prestige"
        )
        assert reports[0].card.swuapi_uuid is None

    def test_report_rows_keep_resolution_order(self):
        resolutions = [
            _resolved(_row(1, 1), _match(1)),
            svc._Resolution(
                _row(2, 1), "unresolved", "unknown_triple", False, False, [], None
            ),
            _resolved(_row(3, 1), _match(2), mismatch=True),
        ]
        reports, updates = svc._plan_rows(
            resolutions, {}, _Limits({}), "replace", "add_above"
        )
        assert [r.row_number for r in reports] == [1, 2, 3]
        assert reports[2].uuid_triple_mismatch is True
        assert list(updates) == [1, 2]


class TestReplaceAllRemovals:
    def test_no_owned_rows(self):
        assert svc._replace_all_removals([]) == ([], {})

    def test_each_owned_row_is_itemized_and_zeroed(self):
        owned = [
            (5, 2, "u-5", "SOR", "10", "Standard", "Alpha", None),
            (6, 1, "u-6", "SHD", "11", "Hyperspace", "Beta", "Sub"),
        ]
        removed, updates = svc._replace_all_removals(owned)
        assert updates == {5: 0, 6: 0}
        assert [(r.card.swuapi_uuid, r.quantity) for r in removed] == [
            ("u-5", 2),
            ("u-6", 1),
        ]
        assert removed[1].card == ImportRowCard(
            swuapi_uuid="u-6",
            set_code="SHD",
            card_number="11",
            variant_type="Hyperspace",
            name="Beta",
            subtitle="Sub",
        )


class TestCachedLimit:
    @pytest.fixture
    def lookups(self, monkeypatch):
        calls = []
        values = {("standard", "Standard"): 3, ("standard", "Hyperspace"): None}

        def _effective_limit(db, category, bucket):
            calls.append((db, category, bucket))
            return values.get((category, bucket), 1)

        monkeypatch.setattr(svc, "effective_limit", _effective_limit)
        return calls

    def test_one_lookup_per_cell(self, lookups):
        db = object()
        cache = {}
        assert svc._cached_limit(db, cache, "Unit", "Standard", "SOR") == 3
        assert svc._cached_limit(db, cache, "Event", "Standard", "SHD") == 3
        assert svc._cached_limit(db, cache, "Unit", "Hyperspace", "SOR") is None
        assert svc._cached_limit(db, cache, "Unit", "Hyperspace", "SOR") is None
        assert svc._cached_limit(db, cache, "Leader", "Standard", "SOR") == 1
        assert lookups == [
            (db, "standard", "Standard"),
            (db, "standard", "Hyperspace"),
            (db, "singleton", "Standard"),
        ]
        assert cache == {
            ("standard", "Standard"): 3,
            ("standard", "Hyperspace"): None,
            ("singleton", "Standard"): 1,
        }

    def test_cache_is_the_callers(self, lookups):
        svc._cached_limit(None, {}, "Unit", "Standard", "SOR")
        svc._cached_limit(None, {}, "Unit", "Standard", "SOR")
        assert len(lookups) == 2


class TestTotals:
    def test_counts_come_from_the_report_rows(self):
        reports, _ = svc._plan_rows(
            [
                _resolved(_row(1, 5), _match(1), fallback=True),
                _resolved(_row(2, 1500), _match(2, base_type="Base")),
                _resolved(_row(3, 1), _match(3)),
                svc._Resolution(
                    _row(4, 1), "unresolved", "unknown_triple", False, False, [], None
                ),
                svc._Resolution(
                    _row(5, 1),
                    "ambiguous",
                    "ambiguous_triple",
                    False,
                    False,
                    [_match(8), _match(9)],
                    None,
                ),
            ],
            {},
            _Limits({"Unit": 3, "Base": None}),
            "merge_add",
            "trim",
        )
        removed, _ = svc._replace_all_removals(
            [(7, 1, "u", "SOR", "1", "Standard", "N", None)]
        )
        notes = ParseNotes(unrecognized_columns=["extra"], duplicate_rows_merged=2)
        totals = svc._totals(5, reports, removed, notes, 1)
        assert totals.model_dump() == {
            "rows": 5,
            "resolved": 3,
            "matched_by_fallback": 1,
            "unresolved": 1,
            "ambiguous": 1,
            "trimmed": 1,
            "ceiling_clamped": 1,
            "duplicate_rows_merged": 3,
            "unrecognized_columns": ["extra"],
            "removed_by_replace_all": 1,
        }


class TestComputeImportWiring:
    """compute_import over a faked repository: removals join the plan, the
    owned-row query excludes exactly the resolved variants, and both stages
    compute the same report and plan."""

    @pytest.fixture
    def repo(self, monkeypatch):
        state = SimpleNamespace(excluded=None, limit_calls=0)
        a = _match(1, uuid="u-a", number="1")
        b = _match(2, uuid="u-b", number="2")
        repo = svc.inventory_import_repo

        def _owned(_db, excluded):
            state.excluded = set(excluded)
            return [(9, 4, "u-gone", "SOR", "9", "Standard", "Gone", None)]

        def _limit(_db, _category, _bucket):
            state.limit_calls += 1
            return 3

        monkeypatch.setattr(
            repo,
            "get_variants_by_uuids",
            lambda _db, uuids: {
                m[0].swuapi_id: m for m in (a, b) if m[0].swuapi_id in uuids
            },
        )
        monkeypatch.setattr(
            repo,
            "get_variants_by_triples",
            lambda _db, triples: {("SOR", "2", "Standard"): [b]},
        )
        monkeypatch.setattr(
            repo, "get_current_quantities", lambda _db, ids: {1: 1, 2: 2}
        )
        monkeypatch.setattr(repo, "get_owned_rows_excluding", _owned)
        monkeypatch.setattr(svc, "effective_limit", _limit)
        # BL-344: PORTED -- compute_import now reads the tenant's stash rows;
        # this DB-free wiring fixture has none.
        monkeypatch.setattr(svc.stash_repo, "stash_rows_for_import", lambda _db: [])
        return state

    def _rows(self):
        return [
            _row(1, 2, uuid="u-a"),
            _row(2, 1, uuid="u-b"),
            _row(3, 1, set_code="SOR", card_number="2", variant_type="Standard"),
            _row(4, 1, set_code="SOR", card_number="404", variant_type="Standard"),
        ]

    def test_replace_all_plan_and_report(self, repo):
        report, plan = svc.compute_import(
            None,
            self._rows(),
            ParseNotes(),
            mode="replace_all",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert repo.excluded == {1, 2}
        assert plan.updates == {1: 2, 2: 2, 9: 0}
        assert [r.row_number for r in report.rows] == [1, 2, 4]
        assert report.totals.rows == 3
        assert report.totals.duplicate_rows_merged == 1
        assert report.totals.removed_by_replace_all == 1
        assert report.removed[0].card.swuapi_uuid == "u-gone"
        assert repo.limit_calls == 1  # both rows share (standard, Standard)

    def test_other_modes_query_no_owned_rows(self, repo):
        _report, plan = svc.compute_import(
            None,
            self._rows(),
            ParseNotes(),
            mode="replace",
            cap_handling="trim",
            stage="dry_run",
        )
        assert repo.excluded is None
        assert plan.updates == {1: 2, 2: 2}

    def test_both_stages_compute_the_same_report_and_plan(self, repo):
        results = {
            stage: svc.compute_import(
                None,
                self._rows(),
                ParseNotes(),
                mode="merge_add",
                cap_handling="trim",
                stage=stage,
            )
            for stage in ("dry_run", "commit")
        }
        (dry, dry_plan), (commit, commit_plan) = results.values()
        assert dry_plan == commit_plan
        assert dry.model_dump(exclude={"stage"}) == commit.model_dump(exclude={"stage"})
