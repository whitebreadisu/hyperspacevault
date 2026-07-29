#!/usr/bin/env bash
# BL-170: fetch the swuapi bootstrap export from the private repo-assets
# bucket into the location bootstrap.py resolves first. Local-dev helper --
# CI has its own inline fetch step (build-and-push in ci.yml). Requires an
# authenticated gcloud (owner/operator credentials); fresh clones without
# credentials simply run with an empty catalog.
#
# Usage: ./scripts/fetch_bootstrap_export.sh [bucket]
#   bucket defaults to the dev bucket; pass swu-prod-repo-assets to pull
#   prod's copy (contents are runbook-synced, so they normally match).
set -euo pipefail

BUCKET="${1:-swu-dev-jbapps-repo-assets}"
DEST="$(dirname "$0")/../backend/app/ingestion/data/swuapi_export_current.json"

gcloud storage cp "gs://${BUCKET}/exports/swuapi_export_current.json" "$DEST"
test -s "$DEST"
echo "Fetched exports/swuapi_export_current.json from ${BUCKET} -> ${DEST}"
