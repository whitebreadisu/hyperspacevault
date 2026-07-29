# Catalog export data (fetched, not tracked)

swuapi export captures live in the private per-env `repo-assets` GCS bucket
(BL-170) — `*.json` here is gitignored. This README keeps the directory
present in fresh checkouts so fetch destinations always exist.

- **CI**: `build-and-push` fetches `exports/swuapi_export_current.json` from
  `gs://swu-prod-repo-assets` into this directory before the Docker build.
- **Local dev**: `./scripts/fetch_bootstrap_export.sh` (authenticated gcloud
  required). Without a fetched export, the app runs with an empty catalog
  (`bootstrap.py` warns and skips).
- **Real-data test tier**: `pytest -m realdata` needs the frozen 2026-06-21
  capture — fetch `fixtures/swuapi_export_2026-06-21.json` from the bucket to
  this directory or point `SWUAPI_FIXTURE_PATH` at it (see the content
  runbook's verification pass).
- **New captures**: the content runbook uploads dated exports + refreshes
  `swuapi_export_current.json` in BOTH env buckets — never commits them here.
