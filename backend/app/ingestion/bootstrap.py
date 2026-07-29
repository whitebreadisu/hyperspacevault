"""Catalog bootstrap (ADR-0004): on startup, populate the catalog from the
committed swuapi export when it is empty. Idempotent -- a no-op once `base_cards`
is populated, so warm databases and production (already ingested) pay nothing.
Replaces the retired CSV-era `apply_seed` / `catalog_seed.sql` path.

The catalog's source of truth is swuapi; the export in `app/ingestion/data/`
is a point-in-time capture. BL-170 moves the capture out of git and into the
per-env `repo-assets` GCS bucket: CI's build-and-push fetches
`exports/swuapi_export_current.json` into `data/` before the Docker build, so
the image still ships a capture; local dev fetches the same object via
`scripts/fetch_bootstrap_export.sh` (or sets SWUAPI_EXPORT_PATH). Resolution
order at call time: SWUAPI_EXPORT_PATH env var -> `data/swuapi_export_current.json`
-> newest dated `data/swuapi_export_*.json` -> warn and leave the catalog
empty (fresh clones without credentials get an empty-but-working app). Real
freshness is manual runbook execution (`SWU_SWUAPI_Content_Runbook.md`;
BL-36/BL-37 automation deliberately not built -- owner decision 2026-07-14,
issue #261).
"""

import logging
import os
from pathlib import Path

from sqlalchemy import text

from app.database import SessionLocal
from app.ingestion.run_swuapi_ingestion import load_export_from_file, run_ingestion

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent / "data"
_CURRENT_EXPORT = _DATA_DIR / "swuapi_export_current.json"


def resolve_export_path() -> Path:
    """Resolution order: SWUAPI_EXPORT_PATH env var, the fetched
    `swuapi_export_current.json`, newest dated capture on disk. Returns the
    (possibly nonexistent) current-export path when nothing is present so the
    caller's existing warn-and-skip branch reports a stable, documented
    location."""
    env = os.environ.get("SWUAPI_EXPORT_PATH")
    if env:
        return Path(env)
    if _CURRENT_EXPORT.exists():
        return _CURRENT_EXPORT
    dated = sorted(
        p for p in _DATA_DIR.glob("swuapi_export_*.json") if p != _CURRENT_EXPORT
    )
    if dated:
        return dated[-1]
    return _CURRENT_EXPORT


def bootstrap_catalog(export_path: Path | None = None) -> None:
    """Ingest the swuapi export into an empty catalog. No-op if `base_cards`
    is already populated. Called from the FastAPI lifespan on startup
    (replacing the retired `apply_seed`)."""
    if export_path is None:
        export_path = resolve_export_path()
    db = SessionLocal()
    try:
        count = db.execute(text("SELECT COUNT(*) FROM base_cards")).scalar()
    finally:
        db.close()

    if count and count > 0:
        logger.info(
            "Catalog already populated (%d base_cards). Skipping bootstrap.", count
        )
        print(f"Catalog already populated ({count} base_cards). Skipping bootstrap.")
        return

    if not export_path.exists():
        logger.warning(
            "swuapi export not found at %s. Catalog will be empty.", export_path
        )
        print(
            f"WARNING: swuapi export not found at {export_path}. Catalog will be empty."
        )
        return

    logger.info("Bootstrapping catalog from %s ...", export_path)
    print(f"Bootstrapping catalog from {export_path} ...")
    export = load_export_from_file(export_path)
    result = run_ingestion(export)
    logger.info(
        "Catalog bootstrapped: %d sets, %d base_cards, %d card_variants.",
        len(result.sets),
        len(result.base_cards),
        len(result.card_variants),
    )
    print(
        f"Catalog bootstrapped: {len(result.sets)} sets, "
        f"{len(result.base_cards)} base_cards, {len(result.card_variants)} card_variants."
    )
