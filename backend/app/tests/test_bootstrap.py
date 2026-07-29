"""bootstrap_catalog (ADR-0004): the startup catalog bootstrap is idempotent --
a no-op once base_cards is populated. The full ingest-from-export path is
covered by test_swuapi_ingestion_db; this guards the common case (every warm
start skips) and that the wiring is sound.
"""

from sqlalchemy import text

from app.ingestion.bootstrap import bootstrap_catalog


def test_bootstrap_skips_when_catalog_populated(db):
    """seed_minimal_catalog populates base_cards, so bootstrap must be a no-op:
    it returns at the skip guard without raising and without changing the
    catalog row count (and without touching the export file)."""
    before = db.execute(text("SELECT COUNT(*) FROM base_cards")).scalar()
    assert before > 0  # precondition: seed_minimal_catalog ran

    bootstrap_catalog()

    after = db.execute(text("SELECT COUNT(*) FROM base_cards")).scalar()
    assert after == before
