"""BL-322: every CSV the backend writes formula-escapes its free-text
cells (App Spec §17.1). DB-free: the catalog repo read is stubbed."""

from types import SimpleNamespace

import pytest

from app.services import catalog
from app.services.csv_safety import escape_csv_formula
from app.services.inventory_io import InventoryRow, serialize_csv


@pytest.mark.parametrize("lead", ["=", "+", "-", "@", "\t", "\r"])
def test_escape_prefixes_every_trigger_char(lead):
    assert escape_csv_formula(f"{lead}cmd") == f"'{lead}cmd"


def test_escape_leaves_safe_values_alone():
    assert escape_csv_formula("") == ""
    assert escape_csv_formula("Luke Skywalker") == "Luke Skywalker"
    assert escape_csv_formula("a=b") == "a=b"


def test_catalog_reference_csv_escapes_name_and_subtitle(monkeypatch):
    rows = [
        SimpleNamespace(
            swuapi_id="u-1",
            source_set_code="SOR",
            card_number="001",
            variant_type="Standard",
            name='=HYPERLINK("http://x")',
            subtitle="@evil",
        ),
        SimpleNamespace(
            swuapi_id="u-2",
            source_set_code="SOR",
            card_number="002",
            variant_type="Standard",
            name="Plain Name",
            subtitle=None,
        ),
    ]
    monkeypatch.setattr(
        catalog.card_repo, "get_catalog_reference_rows", lambda db: rows
    )
    content, _ = catalog.get_reference_csv(None)
    assert '"\'=HYPERLINK(""http://x"")"' in content
    assert "'@evil" in content
    assert "Plain Name," in content
    # Identity cells are never prefixed.
    assert "u-1,SOR,001,Standard,0," in content


def test_inventory_export_still_escapes():
    row = InventoryRow(
        swuapi_uuid="u",
        set_code="SOR",
        card_number="001",
        variant_type="Standard",
        quantity=1,
        name="+SUM(1)",
        subtitle="-x",
    )
    out = serialize_csv([row])
    assert "'+SUM(1),'-x" in out
