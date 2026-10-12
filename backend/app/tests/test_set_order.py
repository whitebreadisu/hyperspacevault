"""Owner dev-review 2026-07-23: unit tests for the Vault-matching file
order (services/set_order.py) shared by the inventory export (§7.1) and the
catalog reference (§6). Pure function -- no DB, runs anywhere."""

from app.services.set_order import CURATED_EXPORT_SET_ORDER, export_sort_key


def _sort(rows):
    return sorted(rows, key=lambda r: export_sort_key(*r))


class TestSetGroupOrder:
    def test_base_sets_lead_newest_first_with_ibh_ts26_after_the_main_block(self):
        # PORT (BL-258): same intent, main block now newest first.
        codes = ["TS26", "IBH", "SEC", "SOR"]
        rows = [(c, "1", "Standard") for c in codes]
        assert [r[0] for r in _sort(rows)] == ["SEC", "SOR", "IBH", "TS26"]

    def test_weekly_play_follows_base_sets_mirroring_the_base_block(self):
        # PORT (BL-258): Weekly Play mirrors the newest-first base block.
        rows = [(c, "1", "Standard") for c in ("SORP", "ASHP", "TS26", "IBH")]
        assert [r[0] for r in _sort(rows)] == ["IBH", "TS26", "ASHP", "SORP"]

    def test_long_tail_containers_follow_weekly_play(self):
        rows = [(c, "1", "Standard") for c in ("J24", "MV26", "ASHP", "GG", "P25")]
        assert [r[0] for r in _sort(rows)] == ["ASHP", "J24", "P25", "GG", "MV26"]

    def test_unknown_sets_sort_last_alphabetically(self):
        rows = [(c, "1", "Standard") for c in ("ZZZ", "MV26", "AAA")]
        assert [r[0] for r in _sort(rows)] == ["MV26", "AAA", "ZZZ"]

    def test_curated_list_is_collision_free(self):
        assert len(set(CURATED_EXPORT_SET_ORDER)) == len(CURATED_EXPORT_SET_ORDER)


class TestFr2SetOrderNewestFirst:
    def test_fr2_08_literal_base_and_weekly_play_blocks(self):
        order = CURATED_EXPORT_SET_ORDER
        assert order[:11] == [
            "HMW", "ASH", "LAW", "SEC", "LOF", "JTL", "TWI", "SHD", "SOR", "IBH", "TS26",
        ]  # fmt: skip
        assert order[11:20] == [
            "HMWP", "ASHP", "LAWP", "SECP", "LOFP", "JTLP", "TWIP", "SHDP", "SORP",
        ]  # fmt: skip
        assert order[20:] == [
            "J24", "J25", "P25", "P26", "C24", "C25", "C26", "G25", "GG", "MV26", "CST",
        ]  # fmt: skip

    def test_fr2_08_card_number_still_ascending_within_a_set(self):
        rows = [(c, n, "Standard") for c in ("SOR", "HMW") for n in ("10", "2", "1")]
        assert [(r[0], r[1]) for r in _sort(rows)] == [
            ("HMW", "1"), ("HMW", "2"), ("HMW", "10"),
            ("SOR", "1"), ("SOR", "2"), ("SOR", "10"),
        ]  # fmt: skip


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
