"""Owner dev-review 2026-07-23: unit tests for the Vault-matching file
order (services/set_order.py) shared by the inventory export (§7.1) and the
catalog reference (§6). Pure function -- no DB, runs anywhere."""

from app.services.set_order import CURATED_EXPORT_SET_ORDER, export_sort_key


def _sort(rows):
    return sorted(rows, key=lambda r: export_sort_key(*r))


class TestSetGroupOrder:
    def test_base_sets_lead_in_release_order_with_ts26_last_among_them(self):
        codes = ["TS26", "IBH", "SEC", "SOR"]
        rows = [(c, "1", "Standard") for c in codes]
        assert [r[0] for r in _sort(rows)] == ["SOR", "SEC", "IBH", "TS26"]

    def test_weekly_play_follows_base_sets_in_base_set_order(self):
        rows = [(c, "1", "Standard") for c in ("ASHP", "SORP", "TS26", "IBH")]
        assert [r[0] for r in _sort(rows)] == ["IBH", "TS26", "SORP", "ASHP"]

    def test_long_tail_containers_follow_weekly_play(self):
        rows = [(c, "1", "Standard") for c in ("J24", "MV26", "ASHP", "GG", "P25")]
        assert [r[0] for r in _sort(rows)] == ["ASHP", "J24", "P25", "GG", "MV26"]

    def test_unknown_sets_sort_last_alphabetically(self):
        rows = [(c, "1", "Standard") for c in ("ZZZ", "MV26", "AAA")]
        assert [r[0] for r in _sort(rows)] == ["MV26", "AAA", "ZZZ"]

    def test_curated_list_is_collision_free(self):
        assert len(set(CURATED_EXPORT_SET_ORDER)) == len(CURATED_EXPORT_SET_ORDER)


class TestWithinSetOrder:
    def test_card_number_compares_numerically_not_lexicographically(self):
        rows = [("SOR", n, "Standard") for n in ("10", "2", "100", "1")]
        assert [r[1] for r in _sort(rows)] == ["1", "2", "10", "100"]

    def test_non_numeric_card_numbers_sort_after_numeric_then_lexicographic(self):
        rows = [("SOR", n, "Standard") for n in ("T2", "10", "T1")]
        assert [r[1] for r in _sort(rows)] == ["10", "T1", "T2"]

    def test_variant_type_is_the_final_tiebreaker(self):
        rows = [("SOR", "1", "Standard Foil"), ("SOR", "1", "Standard")]
        assert [r[2] for r in _sort(rows)] == ["Standard", "Standard Foil"]

    def test_none_fields_do_not_crash(self):
        rows = [(None, None, None), ("SOR", "1", "Standard")]
        assert _sort(rows)[0] == ("SOR", "1", "Standard")
