"""Formula-injection guard shared by every CSV the backend writes
(App Spec §17.1): the inventory export (inventory_io) and the catalog
reference sheet (catalog)."""

# Leading characters spreadsheet apps (Excel/Sheets/LO Calc) treat as the
# start of a formula: '=', '+', '-', '@' are the OWASP CSV-injection set;
# tab/CR are included because some parsers strip leading whitespace before
# that check, letting "\t=cmd(...)" slip past a naive "starts with one of
# these four chars" guard.
CSV_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@", "\t", "\r")


def escape_csv_formula(value: str) -> str:
    """Prefix a single quote when `value` starts with a formula-trigger
    character, forcing spreadsheet apps to treat the reopened cell as text
    instead of evaluating it. Apply to free-text cells only (name,
    subtitle), never to numeric or identity cells.

    Import-safe: name/subtitle are cosmetic-only on import (inventory_io
    module docstring) -- never consulted for identity resolution or
    merge/cap math -- so a re-imported quoted value changes only what's
    cosmetically displayed, never a quantity or which variant a row
    resolves to."""
    if value and value[0] in CSV_FORMULA_TRIGGER_CHARS:
        return "'" + value
    return value
