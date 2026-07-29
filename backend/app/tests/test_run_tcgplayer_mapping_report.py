"""BL-149: unit tests for write_exceptions_report()'s unwritable-path
handling. No DB/network dependency (unlike test_run_tcgplayer_mapping.py's
integration tests) -- these exercise the plain file-write behavior directly,
so they run in every environment without a DATABASE_URL skip.

Regression coverage for the report-path bug: `docker run -v
<repo>/backend:/app ... python -m app.ingestion.run_tcgplayer_mapping`
mounts only backend/, so the old repo-relative EXCEPTIONS_REPORT_PATH
resolved outside the container filesystem and crashed main() AFTER the DB
commit -- a successful mapping run looked like a hard failure, and the
report was silently skipped.
"""

from __future__ import annotations

from app.ingestion.run_tcgplayer_mapping import RunReport, write_exceptions_report


def test_write_exceptions_report_writes_to_a_valid_path(tmp_path):
    report = RunReport(results={})
    target = tmp_path / "tcgplayer_mapping_exceptions.md"

    write_exceptions_report(report, target)

    assert target.exists()
    assert "TCGplayer Pricing Mapping" in target.read_text(encoding="utf-8")


def test_write_exceptions_report_warns_instead_of_raising_on_unwritable_path(
    tmp_path, caplog
):
    """A path whose parent directory doesn't exist (the container-mount
    case: EXCEPTIONS_REPORT_PATH resolves outside the mounted volume
    entirely) must log a warning, not raise -- the caller (main()) already
    committed the DB writes by the time this runs, so raising here would
    mask a successful run as a crash."""
    report = RunReport(results={})
    unwritable = tmp_path / "no-such-mounted-volume" / "tcgplayer_mapping_exceptions.md"

    with caplog.at_level("WARNING"):
        write_exceptions_report(report, unwritable)

    assert not unwritable.exists()
    assert any(
        "could not write exceptions report" in record.message
        for record in caplog.records
    )
