"""Unit tests for the sets service layer. No database required."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.sets import get_all_sets, get_set_by_code


def _make_set(
    code="SOR", name="Spark of Rebellion", is_base_set=True, release_date=None
):
    return SimpleNamespace(
        id=1, code=code, name=name, is_base_set=is_base_set, release_date=release_date
    )


class TestGetSetByCode:
    def test_uppercases_code_before_repo_call(self):
        mock_db = MagicMock()
        with patch(
            "app.services.sets.set_repo.get_set_by_code", return_value=_make_set()
        ) as mock_repo:
            get_set_by_code(mock_db, "sor")
            mock_repo.assert_called_once_with(mock_db, "SOR")

    def test_returns_none_when_not_found(self):
        mock_db = MagicMock()
        with patch("app.services.sets.set_repo.get_set_by_code", return_value=None):
            assert get_set_by_code(mock_db, "ZZZ") is None

    def test_returns_response_with_correct_fields(self):
        mock_db = MagicMock()
        with patch(
            "app.services.sets.set_repo.get_set_by_code",
            return_value=_make_set("SOR", "Spark of Rebellion", True, date(2024, 3, 8)),
        ):
            result = get_set_by_code(mock_db, "SOR")
            assert result.code == "SOR"
            assert result.name == "Spark of Rebellion"
            assert result.is_base_set is True
            assert result.release_date == date(2024, 3, 8)


class TestGetAllSets:
    def test_returns_list_of_responses(self):
        mock_db = MagicMock()
        mock_sets = [
            _make_set("SOR", release_date=date(2024, 3, 8)),
            _make_set("SHD", "Shadows of the Galaxy", release_date=date(2024, 8, 2)),
        ]
        with patch("app.services.sets.set_repo.get_all_sets", return_value=mock_sets):
            result = get_all_sets(mock_db)
            assert len(result) == 2
            assert result[0].code == "SOR"
            assert result[1].code == "SHD"

    def test_response_includes_release_date(self):
        mock_db = MagicMock()
        mock_sets = [_make_set("SOR", release_date=date(2024, 3, 8))]
        with patch("app.services.sets.set_repo.get_all_sets", return_value=mock_sets):
            result = get_all_sets(mock_db)
            assert result[0].release_date == date(2024, 3, 8)

    def test_returns_empty_list_when_no_sets(self):
        mock_db = MagicMock()
        with patch("app.services.sets.set_repo.get_all_sets", return_value=[]):
            assert get_all_sets(mock_db) == []
